#!/usr/bin/env node
import { access, readFile, readdir, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stages } from './workflow-stages.mjs'
import { validateManifest, validateReview, validateTimeline } from './editing-store.mjs'
import { readSkillRuns, requiredSkills } from './skill-runs.mjs'
import { PREVIZ_REVIEW_CRITERIA, STORYBOARD_REVIEW_CRITERIA, validPrevizScore } from './review-ledger.mjs'
import { isH3Model } from './generation/providers.mjs'
import { sameShotVersion } from './shot-fingerprint.mjs'
import { PREVIZ_REQUIRED_HARD_GATES, fileSha256, probePrevizMedia, validatePrevizContract, validatePrevizMedia } from './previz-contract.mjs'

const pluginRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const skillMap = JSON.parse(await readFile(resolve(pluginRoot, 'references/skill-map.json'), 'utf8'))
const providerPrompts = new Set(skillMap.provider_prompts || [])

async function exists(path) { try { await access(path); return true } catch { return false } }
async function json(path) { return JSON.parse(await readFile(path, 'utf8')) }
async function sha256(path) { return createHash('sha256').update(await readFile(path)).digest('hex') }

async function selectedEpisodes(root) {
  const directory = resolve(root, 'episodes')
  if (!await exists(directory)) return []
  const entries = await readdir(directory, { withFileTypes: true })
  const output = []
  for (const entry of entries.filter((item) => item.isDirectory())) {
    if (await exists(resolve(directory, entry.name, 'scripts', 'selected.json'))) output.push(entry.name)
  }
  return output.sort()
}

async function selectedDocument(root, episode, kind) {
  const marker = resolve(root, 'episodes', episode, kind, 'selected.json')
  if (!await exists(marker)) return null
  const selected = await json(marker)
  return json(resolve(root, selected.path))
}

async function selectedDocumentRecord(root, episode, kind) {
  const marker = resolve(root, 'episodes', episode, kind, 'selected.json')
  if (!await exists(marker)) return null
  const selected = await json(marker)
  return { versionId: selected.versionId, document: await json(resolve(root, selected.path)) }
}

function shotNumbers(items) {
  return [...new Set((items || []).map((item) => item.shot_number))].sort((a, b) => a - b)
}

function sameNumbers(a, b) { return JSON.stringify(shotNumbers(a)) === JSON.stringify(shotNumbers(b)) }
function sameReferences(plan, prompt) {
  // 分镜裁片和白模运动参考都在制作计划完成后产生，属于可追溯的执行期派生输入。
  const planned = (plan || []).map(({ key, version_id, role, order }) => ({ asset_key: key, version_id, role, order }))
  const prompted = (prompt || []).filter((item) => !(
    item.role === 'storyboard-frame' && item.asset_key?.startsWith('other-')
    || item.type === 'video' && item.role === 'reference_video' && /^other-previz-ep\d{3}-\d{3}$/.test(item.asset_key || '')
  )).map(({ asset_key, version_id, role, order }) => ({ asset_key, version_id, role, order }))
  return JSON.stringify(planned) === JSON.stringify(prompted)
}
function sameShotContract(plan, prompt) {
  return plan.provider === prompt.provider
    && plan.model_or_workflow === prompt.model_or_workflow
    && plan.prompt_profile === prompt.prompt_profile
    && plan.input_mode === prompt.input_mode
    && plan.duration_seconds === prompt.duration
    && sameReferences(plan.reference_assets, prompt.references)
}

export function storyboardMedium(shot) { return shot?.storyboard_strategy?.mode || 'image' }
export function previzDurationMatches(shot, version, contract) {
  return contract?.duration_seconds === shot?.duration_seconds && version?.provenance?.parameters?.duration === shot?.duration_seconds
}

export async function missingStoryboardAssets(root, episode, storyboardVersion, shots, assets) {
  const missing = []
  for (const shot of shots || []) {
    if (storyboardMedium(shot) !== 'image') continue
    const key = `board-${episode.replace('-', '')}-${String(shot.shot_number).padStart(3, '0')}`
    const asset = assets.assets?.[key]
    const version = asset?.versions?.find((item) => item.id === asset.selectedVersionId)
    const source = version?.provenance?.prompt_document
    const currentSource = source?.kind === 'storyboard' && source.episode_key === episode && source.shot_number === shot.shot_number
      && await sameShotVersion(root, episode, 'storyboard', source.version_id, storyboardVersion, shot.shot_number).catch(() => false)
    if (asset?.type !== 'storyboard' || !version?.localPath || asset.staleVersionIds?.includes(version.id) || !await exists(resolve(root, version.localPath)) || !currentSource) missing.push(`${episode} 第 ${shot.shot_number} 镜 selected 分镜图`)
  }
  return missing
}

export function missingStoryboardReviews(episode, shots, assets, reviews) {
  const missing = []
  for (const shot of shots || []) {
    if (storyboardMedium(shot) !== 'image') continue
    const key = `board-${episode.replace('-', '')}-${String(shot.shot_number).padStart(3, '0')}`
    const asset = assets.assets?.[key]
    const review = reviews.reviews?.[`${key}@${asset?.selectedVersionId}`]
    if (!review?.approved || review.visual !== 'passed' || JSON.stringify(review.criteria?.map((item) => item.criterion)) !== JSON.stringify(STORYBOARD_REVIEW_CRITERIA) || review.criteria.some((item) => item.status !== 'passed' || typeof item.observation !== 'string' || !item.observation.trim())) missing.push(`${episode} 第 ${shot.shot_number} 镜分镜图八维审计`)
  }
  return missing
}

export async function missingPrevizAssets(root, episode, storyboardVersion, shots, assets, productionPlanVersion) {
  const missing = []
  for (const shot of shots || []) {
    if (shot.previz_strategy?.mode !== 'blender') continue
    const key = `other-previz-${episode.replace('-', '')}-${String(shot.shot_number).padStart(3, '0')}`
    const asset = assets.assets?.[key]
    const version = asset?.versions?.find((item) => item.id === asset.selectedVersionId)
    const source = version?.provenance?.prompt_document
    const currentSource = source?.kind === 'storyboard' && source.episode_key === episode && source.shot_number === shot.shot_number
      && await sameShotVersion(root, episode, 'storyboard', source.version_id, storyboardVersion, shot.shot_number).catch(() => false)
    const contractPath = version?.provenance?.parameters?.direction_contract
    let currentContract = false
    let currentMedia = false
    const contractPattern = new RegExp(`^episodes/${episode}/previz/shot-${String(shot.shot_number).padStart(3, '0')}-v\\d{3}\\.json$`)
    if (typeof contractPath === 'string' && contractPattern.test(contractPath)) {
      try {
        const contractFile = resolve(root, contractPath)
        const contract = await json(contractFile)
        validatePrevizContract(contract, { episode, storyboardVersion, productionPlanVersion, shotNumber: shot.shot_number })
        currentContract = previzDurationMatches(shot, version, contract)
          && version?.provenance?.parameters?.direction_contract_sha256 === await fileSha256(contractFile)
        if (currentContract && version?.localPath) {
          const mediaFile = resolve(root, version.localPath)
          const [actualFile, rootReal] = await Promise.all([realpath(mediaFile), realpath(root)])
          if (actualFile !== rootReal && !actualFile.startsWith(`${rootReal}${sep}`)) throw new Error('白模媒体路径逃逸项目目录')
          const hashMatches = version.sha256 === await fileSha256(actualFile)
          if (hashMatches) {
            validatePrevizMedia(probePrevizMedia(actualFile), contract, shot)
            currentMedia = true
          }
        }
      } catch {}
    }
    if (asset?.type !== 'other' || !version?.localPath || asset.staleVersionIds?.includes(version.id) || !await exists(resolve(root, version.localPath)) || !currentSource || !currentContract || !currentMedia) missing.push(`${episode} 第 ${shot.shot_number} 镜 selected Blender 白模分镜及导演合同（合同/媒体哈希及实际时长、帧率、帧数、分辨率必须一致）`)
  }
  return missing
}

export function missingPrevizReviews(episode, shots, assets, reviews) {
  const missing = []
  for (const shot of shots || []) {
    if (shot.previz_strategy?.mode !== 'blender') continue
    const key = `other-previz-${episode.replace('-', '')}-${String(shot.shot_number).padStart(3, '0')}`
    const asset = assets.assets?.[key]
    const review = reviews.reviews?.[`${key}@${asset?.selectedVersionId}`]
    const watched = review?.watchedFull === true && review?.asset_sha256 === asset?.versions?.find((item) => item.id === asset?.selectedVersionId)?.sha256 && review.watch_evidence?.duration_seconds === shot.duration_seconds && ['start', 'middle', 'end'].every((field) => typeof review.watch_evidence?.[field] === 'string' && review.watch_evidence[field].trim())
    const hardGates = Array.isArray(review?.hard_gates) && PREVIZ_REQUIRED_HARD_GATES.every((gate) => review.hard_gates.some((item) => item.gate === gate && item.status === 'passed' && Number.isInteger(item.frame) && typeof item.observation === 'string' && item.observation.trim()))
    if (!review?.approved || review.visual !== 'passed' || !watched || !hardGates || !validPrevizScore(review.score) || JSON.stringify(review.criteria?.map((item) => item.criterion)) !== JSON.stringify(PREVIZ_REVIEW_CRITERIA) || review.criteria.some((item) => item.status !== 'passed' || typeof item.observation !== 'string' || !item.observation.trim())) missing.push(`${episode} 第 ${shot.shot_number} 镜 Blender 白模分镜导演验收`)
  }
  return missing
}
function promptMode(skill, stage) {
  const prompts = Object.entries(skillMap.prompts).filter(([, owner]) => owner === skill).map(([name]) => name)
  if (!prompts.length) return null
  if (['asset-generation', 'media-production'].includes(stage) && prompts.some((name) => providerPrompts.has(name))) return 'provider-prompt'
  return prompts.some((name) => !providerPrompts.has(name)) ? 'codex-contract' : 'provider-prompt'
}
function acceptsPrompt(skill, prompt) {
  return (skillMap.completion_prompts?.[skill] || Object.entries(skillMap.prompts).filter(([, owner]) => owner === skill).map(([name]) => name)).includes(prompt)
}

export async function inspectStage(root, stage) {
  if (!stages.includes(stage)) throw new Error(`未知阶段：${stage}`)
  const missing = []
  const requireFile = async (path, label) => { if (!await exists(resolve(root, path))) missing.push(label) }
  const episodes = await selectedEpisodes(root)
  const rootReal = await realpath(root)
  const skillRuns = await readSkillRuns(root)
  const state = await json(resolve(root, '.short-drama/state.json'))
  const cutoff = state.invalidatedAt?.[stage]
  for (const skill of await requiredSkills(root, stage)) {
    const run = skillRuns.runs?.[`${stage}:${skill}`]
    if (run?.status !== 'completed' || !Array.isArray(run.evidence) || run.evidence.length === 0 || (cutoff && Date.parse(run.completedAt) < Date.parse(cutoff))) missing.push(`Skill 未在当前阶段修订后执行：${skill}`)
    else for (const path of run.evidence) {
      const local = relative(root, resolve(root, path))
      let actual
      try { actual = await realpath(resolve(root, path)) } catch {}
      if (!local || local === '..' || local.startsWith(`..${sep}`) || !actual || (actual !== rootReal && !actual.startsWith(`${rootReal}${sep}`)) || run.evidenceSha256?.[path] !== await sha256(actual)) missing.push(`Skill 证据无效或已变化：${skill} -> ${path}`)
    }
    const mode = promptMode(skill, stage)
    if (mode) {
      if (!Array.isArray(run?.promptRuns) || run.promptRuns.length === 0) missing.push(`Skill 缺少提示词运行记录：${skill}`)
      for (const promptRun of run?.promptRuns || []) {
        let actual
        try { actual = await realpath(resolve(root, promptRun.path)) } catch {}
        if (!actual || (actual !== rootReal && !actual.startsWith(`${rootReal}${sep}`)) || promptRun.sha256 !== await sha256(actual)) { missing.push(`Skill 提示词记录无效或已变化：${skill}`); continue }
        const record = await json(actual)
        if (!acceptsPrompt(skill, record.prompt) || skillMap.prompts[record.prompt] !== skill || record.executionMode !== mode || (mode === 'codex-contract' && !run.evidence.includes(record.outputPath))) missing.push(`Skill 完成合同、提示词归属、执行模式或产物绑定错误：${skill}`)
      }
      if (mode === 'codex-contract' && run?.evidence?.some((path) => !(run.promptRuns || []).some((promptRun) => promptRun.outputPath === path))) missing.push(`Skill 存在未绑定 Codex 合同的证据：${skill}`)
    }
  }

  if (stage === 'analysis') {
    for (const name of ['source-analysis', 'brief', 'bible', 'outline']) await requireFile(`.short-drama/${name}.json`, name)
    if (missing.length === 0) {
      const sourceAnalysis = await json(resolve(root, '.short-drama', 'source-analysis.json'))
      const brief = await json(resolve(root, '.short-drama', 'brief.json'))
      const bible = await json(resolve(root, '.short-drama', 'bible.json'))
      const outline = await json(resolve(root, '.short-drama', 'outline.json'))
      if (sourceAnalysis.coverage?.complete !== true) missing.push('来源分析覆盖不完整')
      if (brief.approved !== true || brief.open_questions?.length) missing.push('创作简报尚未确认')
      if (bible.open_questions?.length) missing.push('故事圣经仍有未决项')
      if (outline.coverage_check?.complete !== true || outline.continuity_check?.valid !== true) missing.push('分集覆盖或连续性检查未通过')
    }
  }
  if (stage === 'script') {
    if (episodes.length === 0) missing.push('至少一个 selected 剧本')
    for (const episode of episodes) {
      const scriptFiles = (await readdir(resolve(root, 'episodes', episode, 'scripts'))).filter((name) => /^v\d{3}\.(?:json|md|txt)$/.test(name))
      if (scriptFiles.length < 2) missing.push(`${episode} 缺少 Humanizer 新版本`)
      const selectedScript = await json(resolve(root, 'episodes', episode, 'scripts', 'selected.json'))
      const review = await selectedDocument(root, episode, 'script-review')
      if (!review) missing.push(`${episode} selected 剧本复核`)
      else if (!review.approved || review.script_version !== selectedScript.versionId) missing.push(`${episode} 剧本复核未批准或版本不匹配`)
    }
  }
  if (stage === 'director-book') {
    if (episodes.length === 0) missing.push('至少一个 selected 剧本')
    for (const episode of episodes) {
      const director = await selectedDocument(root, episode, 'director-book')
      if (!director) missing.push(`${episode} selected 导演本`)
      else if (director.open_questions?.length) missing.push(`${episode} 导演本仍有未决项`)
    }
  }
  if (stage === 'asset-analysis') {
    await requireFile('.short-drama/art-style.json', '已确认画风决策')
    if (await exists(resolve(root, '.short-drama/art-style.json'))) {
      const [decision, project] = await Promise.all([json(resolve(root, '.short-drama/art-style.json')), json(resolve(root, '.short-drama/project.json'))])
      if (decision.approved !== true || JSON.stringify(decision.style) !== JSON.stringify(project.creative?.art_style)) missing.push('画风决策未批准或与项目配置不一致')
    }
    if (episodes.length === 0) missing.push('至少一个 selected 剧本')
    const profilePath = resolve(root, 'assets/characters/profiles.json')
    const profileNames = await exists(profilePath) ? new Set((await json(profilePath)).characters?.map((item) => item.name)) : new Set()
    for (const episode of episodes) {
      const plan = await selectedDocument(root, episode, 'asset-plan')
      if (!plan) missing.push(`${episode} selected 资产计划`)
      else if (plan.unresolved?.length || [...(plan.characters || []), ...(plan.scenes || []), ...(plan.props || [])].some((item) => item.status === 'blocked')) missing.push(`${episode} 资产计划仍有未决项`)
      for (const character of plan?.characters || []) if (!profileNames.has(character.name)) missing.push(`${episode} 人物档案缺少：${character.name}`)
    }
  }
  if (stage === 'asset-generation') {
    const ledgerPath = resolve(root, '.short-drama', 'assets.json')
    if (!await exists(ledgerPath)) missing.push('本地资产账本')
    else {
      const ledger = await json(ledgerPath)
      for (const episode of episodes) {
        const plan = await selectedDocument(root, episode, 'asset-plan')
        if (!plan) { missing.push(`${episode} selected 资产计划`); continue }
        for (const item of [...(plan?.characters || []), ...(plan?.scenes || []), ...(plan?.props || [])]) {
          const asset = ledger.assets?.[item.key]
          const version = asset?.versions?.find((entry) => entry.id === asset.selectedVersionId)
          if (!version?.localPath || asset.staleVersionIds?.includes(version.id) || !await exists(resolve(root, version.localPath))) missing.push(`${item.key} selected 且未失效的本地版本`)
        }
      }
    }
  }
  if (stage === 'production-plan') {
    if (episodes.length === 0) missing.push('至少一个 selected 剧本')
    for (const episode of episodes) {
      const plan = await selectedDocumentRecord(root, episode, 'production-plan')
      const storyboard = await selectedDocumentRecord(root, episode, 'storyboard')
      const prompts = await selectedDocumentRecord(root, episode, 'video-prompts')
      if (!storyboard) missing.push(`${episode} selected 分镜`)
      if (!plan?.document?.approved || plan.document.unresolved?.length) missing.push(`${episode} approved 且无未决项的制作计划`)
      if (!prompts?.document?.approved || prompts?.document?.unresolved?.length) missing.push(`${episode} approved 且无未决项的视频提示词`)
      if (plan && storyboard && !sameNumbers(plan.document.shots, storyboard.document.panels)) missing.push(`${episode} 制作计划与分镜镜号不一致`)
      if (plan && prompts && !sameNumbers(plan.document.shots, prompts.document.shots)) missing.push(`${episode} 制作计划与视频提示词镜号不一致`)
      if (plan && storyboard && prompts) for (const shot of prompts.document.shots || []) {
        const [planMatches, storyboardMatches] = await Promise.all([
          sameShotVersion(root, episode, 'production-plan', shot.production_plan_version, plan.versionId, shot.shot_number).catch(() => false),
          sameShotVersion(root, episode, 'storyboard', shot.storyboard_version, storyboard.versionId, shot.shot_number).catch(() => false),
        ])
        if (!planMatches || !storyboardMatches) missing.push(`${episode} 第 ${shot.shot_number} 镜视频提示词来源不是当前镜头内容`)
      }
      if (plan && prompts) for (const shot of plan.document.shots || []) {
        const prompt = prompts.document.shots?.find((item) => item.shot_number === shot.shot_number)
        if (prompt && !sameShotContract(shot, prompt)) missing.push(`${episode} 第 ${shot.shot_number} 镜制作计划与视频提示词参数或引用不一致`)
      }
    }
  }
  if (stage === 'media-production') {
    const tasks = await exists(resolve(root, '.short-drama', 'tasks.json')) ? await json(resolve(root, '.short-drama', 'tasks.json')) : { tasks: {} }
    if (Object.values(tasks.tasks || {}).some((task) => ['submitting', 'queued', 'running'].includes(task.status))) missing.push('仍有在途生成任务')
    const assets = await exists(resolve(root, '.short-drama', 'assets.json')) ? await json(resolve(root, '.short-drama', 'assets.json')) : { assets: {} }
    const reviews = await exists(resolve(root, '.short-drama', 'shot-reviews.json')) ? await json(resolve(root, '.short-drama', 'shot-reviews.json')) : { reviews: {} }
    for (const episode of episodes) {
      const plan = await selectedDocumentRecord(root, episode, 'production-plan')
      const storyboard = await selectedDocumentRecord(root, episode, 'storyboard')
      const prompts = await selectedDocumentRecord(root, episode, 'video-prompts')
      if (!plan || !storyboard || !prompts) { missing.push(`${episode} 缺少当前制作计划、分镜或视频提示词`); continue }
      missing.push(...await missingStoryboardAssets(root, episode, storyboard.versionId, plan.document.shots, assets))
      missing.push(...missingStoryboardReviews(episode, plan.document.shots, assets, reviews))
      missing.push(...await missingPrevizAssets(root, episode, storyboard.versionId, plan.document.shots, assets, plan.versionId))
      missing.push(...missingPrevizReviews(episode, plan.document.shots, assets, reviews))
      for (const shot of plan.document.shots || []) {
        let match
        for (const asset of Object.values(assets.assets || {})) {
          if (asset.type !== 'video' || !asset.selectedVersionId) continue
          const version = asset.versions?.find((item) => item.id === asset.selectedVersionId)
          if (asset.staleVersionIds?.includes(version?.id)) continue
          const source = version?.provenance?.prompt_document
          if (source?.episode_key === episode && source?.shot_number === shot.shot_number && await sameShotVersion(root, episode, 'video-prompts', source.version_id, prompts.versionId, shot.shot_number).catch(() => false)) { match = asset; break }
        }
        if (!match) missing.push(`${episode} 第 ${shot.shot_number} 镜 selected 视频`)
        else {
          const review = reviews.reviews?.[`${match.key}@${match.selectedVersionId}`]
          const criteria = review?.criteria || []
          if (!review?.approved || JSON.stringify(criteria.map((item) => item.criterion)) !== JSON.stringify(shot.review_checks) || criteria.some((item) => item.status !== 'passed' || typeof item.observation !== 'string' || !item.observation.trim())) missing.push(`${match.key} selected 版本缺少逐项可核对验收`)
          const audioMode = typeof shot.audio_strategy === 'string' ? shot.audio_strategy : shot.audio_strategy?.mode
          if (isH3Model(shot.provider, shot.model_or_workflow) && audioMode === 'native') {
            const auditPath = resolve(root, '.short-drama/audio-audits', `${match.key}@${match.selectedVersionId}.json`)
            const audit = await exists(auditPath) ? await json(auditPath) : null
            const selectedVersion = match.versions?.find((item) => item.id === match.selectedVersionId)
            if (!audit?.approved || audit.sha256 !== selectedVersion?.sha256) missing.push(`${match.key} selected 版本缺少通过且哈希匹配的原生对白 ASR 审计`)
          }
        }
      }
      const needsAudio = (plan.document.shots || []).some((shot) => {
        const mode = typeof shot.audio_strategy === 'string' ? shot.audio_strategy : shot.audio_strategy?.mode
        return !isH3Model(shot.provider, shot.model_or_workflow) || mode !== 'native'
      })
      const audioPrefix = `audio-${episode.replace('-', '')}-`
      if (needsAudio) {
        const audioPlan = await selectedDocument(root, episode, 'audio-plan')
        if (!audioPlan?.approved || audioPlan.unresolved?.length) missing.push(`${episode} approved 且无未决项的配音计划`)
      }
      if (needsAudio && !Object.values(assets.assets || {}).some((asset) => asset.type === 'audio' && asset.key.startsWith(audioPrefix) && asset.selectedVersionId)) missing.push(`${episode} selected 独立音频`)
    }
  }
  if (stage === 'editing') {
    for (const episode of episodes) {
      const timelineFile = resolve(root, 'editing', episode, 'timeline.json')
      if (!await exists(timelineFile)) missing.push(`${episode} 已校验 timeline.json`)
      else try {
        const timeline = await validateTimeline(root, await json(timelineFile))
        const [plan, ledger] = await Promise.all([selectedDocument(root, episode, 'production-plan'), json(resolve(root, '.short-drama/assets.json'))])
        const planned = (plan?.shots || []).map((shot) => shot.shot_number)
        const edited = timeline.segments.map((segment) => {
          const asset = ledger.assets?.[segment.asset_key]
          return asset?.versions?.find((version) => version.id === segment.version_id)?.provenance?.prompt_document?.shot_number
        })
        if (!plan || JSON.stringify(edited) !== JSON.stringify(planned)) missing.push(`${episode} 时间线未按制作计划完整覆盖镜头顺序`)
      } catch { missing.push(`${episode} timeline.json 校验失败`) }
      const reviewPath = resolve(root, 'editing', episode, 'review.json')
      if (!await exists(reviewPath)) missing.push(`${episode} 完整审片记录`)
      else try { if (!validateReview(await json(reviewPath), episode).approved) missing.push(`${episode} 完整审片尚未通过`) } catch { missing.push(`${episode} 完整审片记录无效`) }
    }
  }
  if (stage === 'delivery') {
    for (const episode of episodes) {
      const manifestPath = resolve(root, 'delivery', episode, 'manifest.json')
      if (!await exists(manifestPath)) missing.push(`${episode} delivery manifest`)
      else try { await validateManifest(root, await json(manifestPath), episode) } catch (error) { missing.push(`${episode} 交付 manifest 或文件哈希校验失败：${error.message}`) }
    }
  }
  return { stage, ready: missing.length === 0, missing: [...new Set(missing)] }
}

async function main() {
  if (process.argv.includes('--self-check')) {
    try { await inspectStage('.', 'bad'); throw new Error('阶段自检失败') } catch (error) { if (!String(error.message).includes('未知阶段')) throw error }
    if (!sameReferences([{ key: 'char-a', version_id: 'v001', role: 'identity', order: 1 }], [{ asset_key: 'char-a', version_id: 'v001', role: 'identity', order: 1 }, { asset_key: 'other-shot-frame', version_id: 'v001', role: 'storyboard-frame', order: 2 }])) throw new Error('派生分镜帧一致性自检失败')
    if (!sameReferences([{ key: 'char-a', version_id: 'v001', role: 'identity', order: 1 }], [{ type: 'image', asset_key: 'char-a', version_id: 'v001', role: 'identity', order: 1 }, { type: 'video', asset_key: 'other-previz-ep001-001', version_id: 'v001', role: 'reference_video', order: 1 }])) throw new Error('白模执行期派生引用一致性自检失败')
    const durationVersion = { provenance: { parameters: { duration: 8 } } }
    if (!previzDurationMatches({ duration_seconds: 8 }, durationVersion, { duration_seconds: 8 }) || previzDurationMatches({ duration_seconds: 8 }, durationVersion, { duration_seconds: 3.5 })) throw new Error('白模时长一致性自检失败')
    return console.log('ok')
  }
  const [root, stage] = process.argv.slice(2)
  if (!root || !stage) throw new Error('用法：workflow-gates.mjs <项目目录> <阶段>')
  const result = await inspectStage(resolve(root), stage)
  console.log(JSON.stringify(result, null, 2))
  if (!result.ready) process.exitCode = 2
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.message); process.exitCode = 1 })
