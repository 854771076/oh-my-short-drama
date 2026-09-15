#!/usr/bin/env node
import { access, mkdir, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stages } from './workflow-stages.mjs'
import { withFileLock } from './file-lock.mjs'
import { isH3Model } from './generation/providers.mjs'

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const skillMap = JSON.parse(await readFile(resolve(pluginRoot, 'references/skill-map.json'), 'utf8'))
const providerPrompts = new Set(skillMap.provider_prompts || [])
const evidencePatterns = {
  'short-drama': /episodes\/ep-\d{3}\/scripts\/v\d{3}\.(?:json|md|txt)$/,
  'generate-character-profiles': /^assets\/characters\/profiles\.json$/,
  'generate-drama-art-style': /^\.short-drama\/art-style\.json$/,
  'write-drama-episode': /episodes\/ep-\d{3}\/scripts\/v\d{3}\.(?:json|md|txt)$/,
  humanizer: /episodes\/ep-\d{3}\/scripts\/v\d{3}\.(?:json|md|txt)$/,
  'review-drama-script': /episodes\/ep-\d{3}\/script-review\/v\d{3}\.json$/,
  'write-drama-director-book': /episodes\/ep-\d{3}\/director-book\/v\d{3}\.json$/,
  'plan-drama-assets': /episodes\/ep-\d{3}\/asset-plan\/v\d{3}\.json$/,
  'build-drama-storyboard': /episodes\/ep-\d{3}\/storyboard\/v\d{3}\.json$/,
  'plan-drama-production': /episodes\/ep-\d{3}\/production-plan\/v\d{3}\.json$/,
  'write-drama-video-prompts': /episodes\/ep-\d{3}\/video-prompts\/v\d{3}\.json$/,
  'remotion-best-practices': /editing\/ep-\d{3}\/timeline\.json$/,
  'edit-drama-timeline': /editing\/ep-\d{3}\/(?:timeline|review)\.json$/,
  'edit-deliver-drama': /delivery\/ep-\d{3}\/manifest\.json$/,
  'design-drama-audio': /episodes\/ep-\d{3}\/audio-plan\/v\d{3}\.json$/,
  'direct-blender-previz': /episodes\/ep-\d{3}\/previz\/shot-\d{3}-v\d{3}\.json$/,
  'generate-blender-previz': /assets\/other\/other-previz-ep\d{3}-\d{3}\/v\d{3}\.mp4$/,
}
const episodeEvidence = {
  'short-drama': (episode) => new RegExp(`^episodes/${episode}/scripts/v\\d{3}\\.(?:json|md|txt)$`),
  'write-drama-episode': (episode) => new RegExp(`^episodes/${episode}/scripts/v\\d{3}\\.(?:json|md|txt)$`),
  humanizer: (episode) => new RegExp(`^episodes/${episode}/scripts/v\\d{3}\\.(?:json|md|txt)$`),
  'review-drama-script': (episode) => new RegExp(`^episodes/${episode}/script-review/v\\d{3}\\.json$`),
  'write-drama-director-book': (episode) => new RegExp(`^episodes/${episode}/director-book/v\\d{3}\\.json$`),
  'plan-drama-assets': (episode) => new RegExp(`^episodes/${episode}/asset-plan/v\\d{3}\\.json$`),
  'build-drama-storyboard': (episode) => new RegExp(`^episodes/${episode}/storyboard/v\\d{3}\\.json$`),
  'plan-drama-production': (episode) => new RegExp(`^episodes/${episode}/production-plan/v\\d{3}\\.json$`),
  'write-drama-video-prompts': (episode) => new RegExp(`^episodes/${episode}/video-prompts/v\\d{3}\\.json$`),
  'remotion-best-practices': (episode) => new RegExp(`^editing/${episode}/timeline\\.json$`),
  'edit-drama-timeline': (episode) => new RegExp(`^editing/${episode}/(?:timeline|review)\\.json$`),
  'edit-deliver-drama': (episode) => new RegExp(`^delivery/${episode}/manifest\\.json$`),
  'design-drama-audio': (episode) => new RegExp(`^episodes/${episode}/audio-plan/v\\d{3}\\.json$`),
}
const snapshotEvidenceSkills = new Set(['manage-drama-assets', 'drama-generation-service', 'generate-character-images', 'generate-scene-assets', 'generate-prop-assets', 'generate-storyboard-images', 'generate-drama-videos', 'review-drama-shots', 'monitor-drama-tasks'])

async function exists(path) { try { await access(path); return true } catch { return false } }
async function sha256(path) { return createHash('sha256').update(await readFile(path)).digest('hex') }
function promptMode(skill, stage) {
  const prompts = Object.entries(skillMap.prompts).filter(([, owner]) => owner === skill).map(([name]) => name)
  if (!prompts.length) return null
  const providers = prompts.filter((name) => providerPrompts.has(name))
  if (['asset-generation', 'media-production'].includes(stage) && providers.length) return 'provider-prompt'
  return prompts.some((name) => !providerPrompts.has(name)) ? 'codex-contract' : 'provider-prompt'
}
function acceptedPrompts(skill) {
  return new Set(skillMap.completion_prompts?.[skill] || Object.entries(skillMap.prompts).filter(([, owner]) => owner === skill).map(([name]) => name))
}
async function promptRuns(root, skill, stage, evidence) {
  const mode = promptMode(skill, stage)
  if (!mode) return []
  const directory = resolve(root, '.short-drama/prompt-runs')
  const state = JSON.parse(await readFile(resolve(root, '.short-drama/state.json'), 'utf8'))
  const cutoff = state.invalidatedAt?.[stage]
  const matches = []
  for (const file of await readdir(directory)) {
    if (!/^prompt-[0-9a-f-]+\.json$/.test(file)) continue
    const path = resolve(directory, file)
    const record = JSON.parse(await readFile(path, 'utf8'))
    if ((!cutoff || Date.parse(record.createdAt) >= Date.parse(cutoff)) && acceptedPrompts(skill).has(record.prompt) && skillMap.prompts[record.prompt] === skill && record.executionMode === mode && (mode === 'provider-prompt' || evidence.includes(record.outputPath))) matches.push({ path: relative(root, path), sha256: await sha256(path), prompt: record.prompt, executionMode: mode, outputPath: record.outputPath, createdAt: record.createdAt })
  }
  if (!matches.length) throw new Error(`${skill} 缺少 ${mode} 提示词运行记录`)
  const ordered = matches.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
  if (mode === 'provider-prompt') return ordered.slice(-1)
  const latestByOutput = new Map(ordered.map((item) => [item.outputPath, item]))
  const linked = evidence.map((path) => latestByOutput.get(path))
  if (linked.some((item) => !item)) throw new Error(`${skill} 每个证据都必须有对应的 Codex 合同运行记录`)
  return linked
}
async function selectedEpisodes(root) {
  const directory = resolve(root, 'episodes')
  if (!await exists(directory)) return []
  return (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
}
async function selectedAssetPlan(root, episode) {
  const markerPath = resolve(root, 'episodes', episode, 'asset-plan', 'selected.json')
  if (!await exists(markerPath)) return null
  const marker = JSON.parse(await readFile(markerPath, 'utf8'))
  return JSON.parse(await readFile(resolve(root, marker.path), 'utf8'))
}

export async function requiredSkills(root, stage) {
  if (!stages.includes(stage)) throw new Error(`未知阶段：${stage}`)
  const required = new Set(skillMap.stages?.[stage] || [])
  if (stage === 'asset-analysis') {
    for (const episode of await selectedEpisodes(root)) {
      const plan = await selectedAssetPlan(root, episode)
      if (plan?.characters?.length) required.add('generate-character-profiles')
    }
  }
  if (stage === 'asset-generation') {
    let ledger = { assets: {} }
    try { ledger = JSON.parse(await readFile(resolve(root, '.short-drama/assets.json'), 'utf8')) } catch (error) { if (error?.code !== 'ENOENT') throw error }
    let needsProvider = false
    for (const episode of await selectedEpisodes(root)) {
      const plan = await selectedAssetPlan(root, episode)
      for (const [group, skill] of [['characters', 'generate-character-images'], ['scenes', 'generate-scene-assets'], ['props', 'generate-prop-assets']]) {
        for (const item of plan?.[group] || []) {
          const asset = ledger.assets?.[item.key]
          const version = asset?.versions?.find((entry) => entry.id === asset.selectedVersionId)
          const reusable = version && typeof version.localPath === 'string' && !asset.staleVersionIds?.includes(version.id) && version.provenance?.created_by !== 'provider' && await exists(resolve(root, version.localPath))
          if (!reusable) { required.add(skill); needsProvider = true }
        }
      }
    }
    if (needsProvider) required.add('drama-generation-service')
  }
  if (stage === 'media-production') {
    let needsIndependentAudio = false
    for (const episode of await selectedEpisodes(root)) {
      const markerPath = resolve(root, 'episodes', episode, 'production-plan', 'selected.json')
      if (!await exists(markerPath)) continue
      const marker = JSON.parse(await readFile(markerPath, 'utf8'))
      const plan = JSON.parse(await readFile(resolve(root, marker.path), 'utf8'))
      for (const shot of plan.shots || []) {
        if ((shot.storyboard_strategy?.mode || 'image') === 'image') required.add('generate-storyboard-images')
        if (shot.previz_strategy?.mode === 'blender') {
          required.add('direct-blender-previz')
          required.add('generate-blender-previz')
        }
        const mode = typeof shot.audio_strategy === 'string' ? shot.audio_strategy : shot.audio_strategy?.mode
        if (!isH3Model(shot.provider, shot.model_or_workflow) || mode !== 'native') needsIndependentAudio = true
      }
    }
    if (needsIndependentAudio) required.add('design-drama-audio')
  }
  return [...required]
}

export async function readSkillRuns(root) {
  const path = resolve(root, '.short-drama/skill-runs.json')
  if (!await exists(path)) return { version: 1, runs: {} }
  return JSON.parse(await readFile(path, 'utf8'))
}

export async function clearSkillRunsFrom(root, stage) {
  const start = stages.indexOf(stage)
  if (start < 0) throw new Error(`未知阶段：${stage}`)
  const ledgerPath = resolve(root, '.short-drama/skill-runs.json')
  await withFileLock(ledgerPath, async () => {
    const ledger = await readSkillRuns(root)
    ledger.runs = Object.fromEntries(Object.entries(ledger.runs || {}).filter(([, run]) => stages.indexOf(run.stage) < start))
    await writeJson(ledgerPath, ledger)
  })
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
  await rename(temporary, path)
}

async function main() {
  const [command, rootArg, stage, skill, ...evidenceArgs] = process.argv.slice(2)
  const root = resolve(rootArg || '')
  if (!rootArg) throw new Error('用法：skill-runs.mjs required|record|record-stage|list <项目目录> [阶段] [skill] [证据路径...]')
  if (command === 'required') return console.log(JSON.stringify(await requiredSkills(root, stage), null, 2))
  if (command === 'list') return console.log(JSON.stringify(await readSkillRuns(root), null, 2))
  if (command === 'record-stage') {
    if (!stage) throw new Error('用法：skill-runs.mjs record-stage <项目目录> <阶段>')
    const ledger = await readSkillRuns(root)
    const skills = await requiredSkills(root, stage)
    const missing = skills.filter((name) => !ledger.runs?.[`${stage}:${name}`]?.evidence?.length)
    if (missing.length) throw new Error(`以下 Skill 没有可复用证据，请先逐项 record：${missing.join('、')}`)
    for (const name of skills) {
      const run = ledger.runs[`${stage}:${name}`]
      const evidence = run.evidence
      const expected = evidencePatterns[name]
      if (expected && !evidence.some((path) => expected.test(path))) throw new Error(`${name} 的证据类型无效`)
      const episodePattern = episodeEvidence[name]
      if (episodePattern) for (const episode of await selectedEpisodes(root)) if (!evidence.some((path) => episodePattern(episode).test(path))) throw new Error(`${name} 缺少 ${episode} 的执行证据`)
      const linkedPromptRuns = await promptRuns(root, name, stage, evidence)
      run.status = 'completed'; run.promptRuns = linkedPromptRuns; run.completedAt = new Date().toISOString()
      run.evidenceSha256 = Object.fromEntries(await Promise.all(evidence.map(async (path) => [path, await sha256(resolve(root, path))])))
    }
    await withFileLock(resolve(root, '.short-drama/skill-runs.json'), async () => writeJson(resolve(root, '.short-drama/skill-runs.json'), ledger))
    return console.log(`${stage}:${skills.join(',')}`)
  }
  if (command !== 'record' || !stage || !skill || evidenceArgs.length === 0) throw new Error('用法：skill-runs.mjs record <项目目录> <阶段> <skill> <证据路径...>')
  if (!(await requiredSkills(root, stage)).includes(skill)) throw new Error(`${skill} 不是 ${stage} 当前要求的 Skill`)
  const evidence = []
  const rootReal = await realpath(root)
  for (const value of evidenceArgs) {
    const path = resolve(root, value)
    const local = relative(root, path)
    if (!local || local === '..' || local.startsWith(`..${sep}`)) throw new Error(`证据必须位于项目内：${value}`)
    await access(path)
    const actual = await realpath(path)
    if (actual !== rootReal && !actual.startsWith(`${rootReal}${sep}`)) throw new Error(`证据真实路径必须位于项目内：${value}`)
    evidence.push(local)
  }
  const expected = evidencePatterns[skill]
  if (expected && !evidence.some((path) => expected.test(path))) throw new Error(`${skill} 的证据类型无效`)
  if (snapshotEvidenceSkills.has(skill) && !evidence.some((path) => new RegExp(`^\\.short-drama/evidence/${stage}-[0-9a-f-]+\\.json$`).test(path))) throw new Error(`${skill} 必须使用不可变阶段资产快照作为证据`)
  const episodePattern = episodeEvidence[skill]
  if (episodePattern) for (const episode of await selectedEpisodes(root)) if (!evidence.some((path) => episodePattern(episode).test(path))) throw new Error(`${skill} 缺少 ${episode} 的执行证据`)
  const linkedPromptRuns = await promptRuns(root, skill, stage, evidence)
  const ledgerPath = resolve(root, '.short-drama/skill-runs.json')
  await withFileLock(ledgerPath, async () => {
    const ledger = await readSkillRuns(root)
    const unique = [...new Set(evidence)]
    ledger.runs[`${stage}:${skill}`] = { stage, skill, status: 'completed', evidence: unique, evidenceSha256: Object.fromEntries(await Promise.all(unique.map(async (path) => [path, await sha256(resolve(root, path))]))), promptRuns: linkedPromptRuns, completedAt: new Date().toISOString() }
    await writeJson(ledgerPath, ledger)
  })
  console.log(`${stage}:${skill}`)
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.message); process.exitCode = 1 })
