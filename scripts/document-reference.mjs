import { readFile, readdir, realpath } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { migrateLegacyAudioPlan } from './audio-plan-contract.mjs'
import { selectedSpeechTiming } from './speech-timing.mjs'

async function json(path) { return JSON.parse(await readFile(path, 'utf8')) }

export function validDocumentReferenceShape(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !/^ep-\d{3}$/.test(value.episode_key) || !/^v\d{3}$/.test(value.version_id)) return false
  if (value.kind === 'audio-plan') return ((Number.isInteger(value.line_index) && value.line_index > 0) || (typeof value.track_key === 'string' && value.track_key.length > 0)) && Object.keys(value).length === 4
  if (value.kind === 'storyboard') return Number.isInteger(value.shot_number) && value.shot_number > 0 && Object.keys(value).length === 4
  if (value.kind === 'continuity-plan') return Number.isInteger(value.shot_number) && value.shot_number > 0 && Object.keys(value).length === 4
  if (value.kind === 'asset-plan') return typeof value.asset_key === 'string' && value.asset_key.length > 0 && Object.keys(value).length === 4
  return value.kind === undefined && Number.isInteger(value.shot_number) && value.shot_number > 0 && Object.keys(value).length === 3
}

async function referencedDocument(root, reference, requireSelected) {
  const directory = resolve(root, 'episodes', reference.episode_key, reference.kind)
  if (requireSelected) {
    const marker = await json(resolve(directory, 'selected.json'))
    if (marker.versionId !== reference.version_id || resolve(root, marker.path) !== resolve(directory, `${reference.version_id}.json`)) throw new Error(`${reference.kind} 必须引用当前 selected 版本`)
  }
  const document = await json(resolve(directory, `${reference.version_id}.json`))
  return reference.kind === 'audio-plan' ? migrateLegacyAudioPlan(document).document : document
}

async function requireImagePromptRun(root, target, prompt, requireCurrent) {
  const expectedSkills = target.startsWith('char-') ? ['generate-character-images', 'transform-drama-media'] : target.startsWith('scene-') ? ['generate-scene-assets', 'transform-drama-media'] : target.startsWith('prop-') ? ['generate-prop-assets', 'transform-drama-media'] : ['generate-storyboard-images', 'transform-drama-media']
  const state = await json(resolve(root, '.short-drama/state.json'))
  const stage = target.startsWith('board-') ? 'media-production' : 'asset-generation'
  const cutoff = state.invalidatedAt?.[stage]
  const rootReal = await realpath(root)
  const candidates = []
  for (const file of await readdir(resolve(root, '.short-drama/prompt-runs'))) {
    if (!/^prompt-[0-9a-f-]+\.json$/.test(file)) continue
    const record = await json(resolve(root, '.short-drama/prompt-runs', file))
    if (!expectedSkills.includes(record.skill) || (requireCurrent && cutoff && Date.parse(record.createdAt) < Date.parse(cutoff))) continue
    candidates.push(record)
    let matchesPrompt = record.executionMode === 'provider-prompt' && record.resolvedContractOrPrompt === prompt
    if (record.executionMode === 'codex-contract' && record.prompt === 'image_prompt_modify') {
      try { matchesPrompt = JSON.parse(record.codexOutput).image_prompt === prompt } catch {}
    }
    if (!matchesPrompt) continue
    const output = await realpath(resolve(root, record.outputPath))
    if (output !== rootReal && !output.startsWith(`${rootReal}${sep}`)) continue
    const actual = await readFile(output, 'utf8')
    if ((record.executionMode === 'provider-prompt' && actual === prompt) || (record.executionMode === 'codex-contract' && actual === record.codexOutput)) return
  }
  const recentCandidates = candidates.filter((record) => record.executionMode === 'provider-prompt' || record.executionMode === 'codex-contract')
  const recent = recentCandidates.at(-1)
  const recentText = String(recent?.resolvedContractOrPrompt || '')
  let difference = 0
  while (difference < prompt.length && difference < recentText.length && prompt[difference] === recentText[difference]) difference += 1
  const detail = recent
    ? `；已扫描 ${recentCandidates.length} 条候选，期望长度 ${prompt.length}，最近记录长度 ${recentText.length}，首个差异位置 ${difference}，期望片段 ${JSON.stringify(prompt.slice(difference, difference + 24))}，记录片段 ${JSON.stringify(recentText.slice(difference, difference + 24))}`
    : '；未找到可用提示词记录'
  throw new Error(`图片生成缺少当前阶段、对应 Skill 且正文一致的 Provider 提示词记录${detail}`)
}

export async function validateGenerationDocumentReference(root, type, target, reference, args, provider, model, requireCurrent = true) {
  if (type === 'video') return
  if (type === 'image' && target.startsWith('other-') && reference === null) return
  if (!validDocumentReferenceShape(reference)) throw new Error(`${type} 生成必须引用有效的当前制作文档`)
  if (type === 'audio') {
    if (reference.kind !== 'audio-plan' || !target.startsWith(`audio-${reference.episode_key.replace('-', '')}-`)) throw new Error('音频 target 与 audio-plan 引用不一致')
    const document = await referencedDocument(root, reference, requireCurrent)
    if (reference.track_key) {
      const track = document.approved === true && !document.unresolved?.length && document.music_tracks?.find((item) => item.key === reference.track_key)
      if (!track) throw new Error('audio-plan 音乐曲目不存在、未批准或仍有未决项')
      if (track.source_mode !== 'generated') throw new Error('catalog 授权曲目不得调用 generate_music 重复生成')
      for (const [field, actual] of Object.entries({ prompt: args.prompt, title: args.title, tags: args.tags, lyrics: args.lyrics || '', make_instrumental: args.make_instrumental === true, provider, model })) {
        if ((track[field] ?? '') !== actual) throw new Error(`音乐参数与 audio-plan ${field} 不一致`)
      }
      return { document, track }
    }
    const line = document.approved === true && !document.unresolved?.length && document.lines?.find((item) => item.line_index === reference.line_index)
    if (!line) throw new Error('audio-plan 台词不存在、未批准或仍有未决项')
    const timing = await selectedSpeechTiming(root, reference.episode_key)
    const timingSource = line.dubbing_contract?.timing_source
    if (!timingSource || timingSource.version_id !== timing.version_id || timingSource.line_index !== line.line_index || timingSource.source_asset.sha256 !== timing.document.source_asset.sha256) throw new Error('音频生成必须绑定当前 selected speech-timing 与来源 SHA')
    const allowedTexts = line.dubbing_contract?.mode === 'generated'
      ? new Set([line.content, line.dubbing_contract.original_text, line.dubbing_contract.adapted_text])
      : new Set([line.content])
    if (typeof args.input === 'string' && !allowedTexts.has(args.input)) throw new Error('音频 input 与 audio-plan 台词不一致')
    const binding = document.voice_bindings?.find((item) => item.speaker === line.speaker && item.provider === provider && item.model === model)
    if (!binding || (args.voice && binding.voice_id !== args.voice)) throw new Error('音频 Provider、模型或 voice 与 audio-plan 绑定不一致')
    return { document, line, binding }
  }
  if (target.startsWith('board-')) {
    if (reference.kind !== 'storyboard') throw new Error('分镜图必须引用 storyboard 文档')
    const expected = `board-${reference.episode_key.replace('-', '')}-${String(reference.shot_number).padStart(3, '0')}`
    if (target !== expected || !(await referencedDocument(root, reference, requireCurrent)).panels?.some((item) => item.shot_number === reference.shot_number)) throw new Error('分镜图 target 或镜号与 storyboard 不一致')
  } else {
    if (reference.kind !== 'asset-plan' || reference.asset_key !== target) throw new Error('人物、场景或道具图片必须引用匹配的 asset-plan 资产')
    const document = await referencedDocument(root, reference, requireCurrent)
    const item = [...(document.characters || []), ...(document.scenes || []), ...(document.props || [])].find((entry) => entry.key === target)
    if (!item || document.unresolved?.length || item.status === 'blocked') throw new Error('asset-plan 资产不存在或仍被阻塞')
  }
  await requireImagePromptRun(root, target, args.prompt, requireCurrent)
}
