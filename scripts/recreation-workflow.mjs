#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { validatePreparedReferenceVideo } from './reference-video.mjs'
import { assertSafeOutputPath, confinedExistingFile, fileSha256 } from './safe-files.mjs'

const HASH = /^[0-9a-f]{64}$/
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const RIGHTS_CAPABILITIES = new Set(['analysis', 'authorized-close-recreation', 'identity', 'voice', 'music', 'trademark', 'dialogue', 'visual-style'])

async function writeJson(root, path, value) {
  await assertSafeOutputPath(root, path, '复刻编译产物输出')
  await mkdir(dirname(path), { recursive: true })
  await assertSafeOutputPath(root, dirname(path), '复刻编译产物输出目录')
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
  await rename(temporary, path)
}

async function confined(root, localPath) {
  return confinedExistingFile(root, localPath, '复刻证据')
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是对象`)
  return value
}

export async function validateRecreationConsumerBinding(rootValue, kind, episodeKey, document) {
  const root = resolve(rootValue)
  const project = JSON.parse(await readFile(resolve(root, '.short-drama/project.json'), 'utf8'))
  if (project.workflow?.type !== 'viral-recreation') return null
  if (kind === 'brief') {
    const entries = await readdir(resolve(root, 'episodes'), { withFileTypes: true })
    const episodes = entries.filter((entry) => entry.isDirectory() && /^ep-\d{3}$/.test(entry.name)).map((entry) => entry.name)
    if (!episodes.length) throw new Error('viral-recreation brief 保存前必须先建立分集和 selected 复刻工作流')
    for (const episode of episodes) {
      const marker = JSON.parse(await readFile(resolve(root, 'episodes', episode, 'recreation-workflow', 'selected.json'), 'utf8'))
      if (document.recreation_workflows?.[episode] !== marker.versionId) throw new Error(`brief recreation_workflows.${episode} 必须绑定当前 selected 复刻工作流 ${marker.versionId}`)
    }
    if (Object.keys(document.recreation_workflows || {}).some((episode) => !episodes.includes(episode))) throw new Error('brief recreation_workflows 包含未知分集')
    return null
  }
  if (!/^ep-\d{3}$/.test(episodeKey || '')) throw new Error(`${kind} 缺少有效 episode key`)
  const marker = JSON.parse(await readFile(resolve(root, 'episodes', episodeKey, 'recreation-workflow', 'selected.json'), 'utf8'))
  const actual = kind === 'script'
    ? document.recreationWorkflowVersion
    : kind === 'director-book'
      ? document.recreation_workflow_version
      : document.source_versions?.recreation_workflow
  const field = kind === 'script' ? 'recreationWorkflowVersion' : kind === 'director-book' ? 'recreation_workflow_version' : 'source_versions.recreation_workflow'
  if (actual !== marker.versionId) throw new Error(`${kind} ${field} 必须绑定当前 selected 复刻工作流 ${marker.versionId}`)
  return marker.versionId
}

function exact(value, keys, label) {
  object(value, label)
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} 字段必须且只能是：${keys.join(', ')}`)
}

function text(value, label, nullable = false) {
  if (nullable && value === null) return
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} 必须是非空字符串${nullable ? '或 null' : ''}`)
}

function stringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) throw new Error(`${label} 必须是字符串数组`)
}

function sourceRef(value, label = 'source_ref') {
  exact(value, ['key', 'version_id', 'sha256'], label)
  if (!/^src-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.key) || !/^v\d{3}$/.test(value.version_id) || !HASH.test(value.sha256)) throw new Error(`${label} 无效`)
}

export function validateReferenceVideoAnalysis(value) {
  exact(value, ['schema_version', 'source_ref', 'prepared_ref', 'rights', 'technical', 'evidence', 'structure', 'visual_grammar', 'replication', 'confidence', 'limitations', 'coverage', 'open_questions'], 'reference-video-analysis')
  if (value.schema_version !== 1) throw new Error('reference-video-analysis schema_version 必须为 1')
  sourceRef(value.source_ref)
  exact(value.prepared_ref, ['path', 'sha256'], 'prepared_ref')
  if (value.prepared_ref.path !== '.short-drama/reference-video/prepared.json' || !HASH.test(value.prepared_ref.sha256)) throw new Error('prepared_ref 无效')
  exact(value.rights, ['status', 'allowed_uses', 'restrictions', 'confirmed_at'], 'rights')
  if (!['owned', 'licensed', 'reference-only'].includes(value.rights.status)) throw new Error('rights.status 无效')
  stringArray(value.rights.allowed_uses, 'rights.allowed_uses')
  stringArray(value.rights.restrictions, 'rights.restrictions')
  if (value.rights.allowed_uses.some((item) => !RIGHTS_CAPABILITIES.has(item)) || value.rights.restrictions.some((item) => !RIGHTS_CAPABILITIES.has(item))) throw new Error('rights allowed_uses/restrictions 必须使用受控 capability')
  if (!Number.isFinite(Date.parse(value.rights.confirmed_at))) throw new Error('rights.confirmed_at 无效')
  exact(value.technical, ['duration_ms', 'width', 'height', 'fps', 'has_audio'], 'technical')
  if (![value.technical.duration_ms, value.technical.width, value.technical.height].every((item) => Number.isInteger(item) && item > 0) || typeof value.technical.fps !== 'number' || value.technical.fps <= 0 || typeof value.technical.has_audio !== 'boolean') throw new Error('technical 无效')
  if (!Array.isArray(value.evidence) || value.evidence.length === 0) throw new Error('evidence[] 必填')
  const evidenceIds = new Set()
  for (const [index, evidence] of value.evidence.entries()) {
    exact(evidence, ['id', 'start_ms', 'end_ms', 'frame_refs', 'transcript', 'on_screen_text', 'observations'], `evidence[${index}]`)
    if (!SAFE_ID.test(evidence.id) || evidenceIds.has(evidence.id)) throw new Error(`evidence[${index}].id 无效或重复`)
    evidenceIds.add(evidence.id)
    if (!Number.isInteger(evidence.start_ms) || !Number.isInteger(evidence.end_ms) || evidence.start_ms < 0 || evidence.end_ms <= evidence.start_ms || evidence.end_ms > value.technical.duration_ms) throw new Error(`evidence[${index}] 时间范围无效`)
    stringArray(evidence.frame_refs, `evidence[${index}].frame_refs`)
    if (typeof evidence.transcript !== 'string') throw new Error(`evidence[${index}].transcript 必须是字符串`)
    stringArray(evidence.on_screen_text, `evidence[${index}].on_screen_text`)
    stringArray(evidence.observations, `evidence[${index}].observations`)
  }
  exact(value.structure, ['hook', 'beats', 'turns', 'payoff', 'cta'], 'structure')
  for (const [field, refs] of Object.entries(value.structure)) {
    stringArray(refs, `structure.${field}`)
    if (refs.some((id) => !evidenceIds.has(id))) throw new Error(`structure.${field} 引用了未知 evidence`)
  }
  exact(value.visual_grammar, ['shot_scale', 'camera', 'motion', 'cut_rhythm', 'caption', 'audio'], 'visual_grammar')
  for (const field of ['shot_scale', 'camera', 'motion']) stringArray(value.visual_grammar[field], `visual_grammar.${field}`)
  for (const field of ['cut_rhythm', 'caption', 'audio']) text(value.visual_grammar[field], `visual_grammar.${field}`)
  exact(value.replication, ['preserve_mechanisms', 'transform_elements', 'forbidden_elements'], 'replication')
  if (!Array.isArray(value.replication.preserve_mechanisms)) throw new Error('replication.preserve_mechanisms 必须是数组')
  for (const [index, item] of value.replication.preserve_mechanisms.entries()) {
    exact(item, ['mechanism', 'evidence_ids'], `preserve_mechanisms[${index}]`)
    text(item.mechanism, `preserve_mechanisms[${index}].mechanism`)
    stringArray(item.evidence_ids, `preserve_mechanisms[${index}].evidence_ids`)
    if (!item.evidence_ids.length || item.evidence_ids.some((id) => !evidenceIds.has(id))) throw new Error(`preserve_mechanisms[${index}] evidence 无效`)
  }
  stringArray(value.replication.transform_elements, 'replication.transform_elements')
  stringArray(value.replication.forbidden_elements, 'replication.forbidden_elements')
  if (!['high', 'medium', 'low'].includes(value.confidence)) throw new Error('confidence 无效')
  stringArray(value.limitations, 'limitations')
  stringArray(value.open_questions, 'open_questions')
  exact(value.coverage, ['complete', 'analyzed_ms'], 'coverage')
  if (typeof value.coverage.complete !== 'boolean' || !Number.isInteger(value.coverage.analyzed_ms) || value.coverage.analyzed_ms < 0 || value.coverage.analyzed_ms > value.technical.duration_ms || (value.coverage.complete && value.coverage.analyzed_ms !== value.technical.duration_ms)) throw new Error('coverage 无效')
  if (value.coverage.complete) {
    const ranges = value.evidence.map((item) => [item.start_ms, item.end_ms]).sort((a, b) => a[0] - b[0])
    let coveredUntil = 0
    for (const [start, end] of ranges) {
      if (start > coveredUntil) throw new Error('coverage.complete 与 evidence 时间覆盖不一致')
      coveredUntil = Math.max(coveredUntil, end)
    }
    if (coveredUntil !== value.technical.duration_ms) throw new Error('coverage.complete 未覆盖完整视频时长')
  }
  return value
}

export function validateRecreationWorkflow(value, episodeKey) {
  exact(value, ['schema_version', 'episode_key', 'analysis_ref', 'source_ref', 'rights_mode', 'rights_basis', 'rights_scope', 'slots', 'script', 'media_tracks', 'captions', 'speech', 'film', 'unresolved', 'approved'], 'recreation-workflow')
  if (value.schema_version !== 1 || value.episode_key !== episodeKey) throw new Error('recreation-workflow 版本或 episode_key 无效')
  exact(value.analysis_ref, ['path', 'sha256'], 'analysis_ref')
  if (value.analysis_ref.path !== '.short-drama/reference-video-analysis.json' || !HASH.test(value.analysis_ref.sha256)) throw new Error('analysis_ref 无效')
  sourceRef(value.source_ref)
  if (!['structure-only', 'authorized-close-recreation'].includes(value.rights_mode)) throw new Error('rights_mode 无效')
  text(value.rights_basis, 'rights_basis', true)
  stringArray(value.rights_scope, 'rights_scope')
  if (value.rights_scope.some((item) => !RIGHTS_CAPABILITIES.has(item) || ['analysis', 'authorized-close-recreation'].includes(item))) throw new Error('rights_scope 必须使用可复用内容的受控 capability')
  if (value.rights_mode === 'authorized-close-recreation' && (!value.rights_basis || value.rights_scope.length === 0)) throw new Error('authorized-close-recreation 必须填写 rights_basis 和 rights_scope')
  if (!Array.isArray(value.slots)) throw new Error('slots[] 必填')
  const slotIds = new Set()
  for (const [index, slot] of value.slots.entries()) {
    exact(slot, ['id', 'type', 'required', 'default'], `slots[${index}]`)
    if (!SAFE_ID.test(slot.id) || slotIds.has(slot.id)) throw new Error(`slots[${index}].id 无效或重复`)
    slotIds.add(slot.id)
    if (!['text', 'image', 'video', 'audio', 'choice'].includes(slot.type) || typeof slot.required !== 'boolean' || (slot.default !== null && typeof slot.default !== 'string')) throw new Error(`slots[${index}] 无效`)
  }
  exact(value.script, ['segments'], 'script')
  if (!Array.isArray(value.script.segments) || value.script.segments.length === 0) throw new Error('script.segments[] 必填')
  const segments = new Map()
  for (const [index, segment] of value.script.segments.entries()) {
    exact(segment, ['id', 'speaker', 'text', 'words'], `script.segments[${index}]`)
    if (!SAFE_ID.test(segment.id) || segments.has(segment.id)) throw new Error(`script.segments[${index}].id 无效或重复`)
    text(segment.speaker, `script.segments[${index}].speaker`)
    text(segment.text, `script.segments[${index}].text`)
    if (!Array.isArray(segment.words)) throw new Error(`script.segments[${index}].words 必须是数组`)
    segments.set(segment.id, segment)
  }
  if (!Array.isArray(value.media_tracks)) throw new Error('media_tracks[] 必填')
  const trackIds = new Set()
  for (const [index, track] of value.media_tracks.entries()) {
    exact(track, ['id', 'kind', 'slot', 'trigger', 'purpose'], `media_tracks[${index}]`)
    if (!SAFE_ID.test(track.id) || trackIds.has(track.id)) throw new Error(`media_tracks[${index}].id 无效或重复`)
    trackIds.add(track.id)
    if (!['image', 'video', 'graphic', 'effect'].includes(track.kind) || !slotIds.has(track.slot)) throw new Error(`media_tracks[${index}] kind 或 slot 无效`)
    exact(track.trigger, ['segment_id', 'start_word', 'end_word'], `media_tracks[${index}].trigger`)
    const segment = segments.get(track.trigger.segment_id)
    if (!segment) throw new Error(`media_tracks[${index}].trigger segment 不存在`)
    text(track.trigger.start_word, `media_tracks[${index}].trigger.start_word`, true)
    text(track.trigger.end_word, `media_tracks[${index}].trigger.end_word`, true)
    for (const word of [track.trigger.start_word, track.trigger.end_word].filter(Boolean)) {
      if (!segment.text.includes(word)) throw new Error(`media_tracks[${index}].trigger word 不在 segment 文本中`)
      if (segment.text.indexOf(word) !== segment.text.lastIndexOf(word)) throw new Error(`media_tracks[${index}].trigger 锚点在 segment 中不唯一`)
    }
    if (track.trigger.start_word && track.trigger.end_word && segment.text.indexOf(track.trigger.start_word) > segment.text.indexOf(track.trigger.end_word)) throw new Error(`media_tracks[${index}].trigger 锚点顺序无效`)
    text(track.purpose, `media_tracks[${index}].purpose`)
  }
  exact(value.captions, ['mode', 'style', 'anchor'], 'captions')
  if (!['none', 'segment-aligned', 'word-aligned'].includes(value.captions.mode) || value.captions.anchor !== 'script') throw new Error('captions 无效')
  text(value.captions.style, 'captions.style')
  exact(value.speech, ['mode', 'alignment'], 'speech')
  if (!['native', 'post-dub', 'independent'].includes(value.speech.mode) || !['segment', 'word'].includes(value.speech.alignment)) throw new Error('speech 无效')
  exact(value.film, ['aspect_ratio', 'resolution', 'fps', 'layout'], 'film')
  if (!/^\d+:\d+$/.test(value.film.aspect_ratio) || !/^\d+x\d+$/.test(value.film.resolution) || !Number.isInteger(value.film.fps) || value.film.fps <= 0) throw new Error('film 无效')
  text(value.film.layout, 'film.layout')
  if (!Array.isArray(value.unresolved)) throw new Error('unresolved[] 必填')
  for (const [index, item] of value.unresolved.entries()) {
    exact(item, ['id', 'question', 'affects'], `unresolved[${index}]`)
    if (!SAFE_ID.test(item.id)) throw new Error(`unresolved[${index}].id 无效`)
    text(item.question, `unresolved[${index}].question`)
    stringArray(item.affects, `unresolved[${index}].affects`)
  }
  if (typeof value.approved !== 'boolean' || (value.approved && value.unresolved.length)) throw new Error('存在 unresolved 时不得 approved')
  return value
}

export async function compileRecreationWorkflow(rootValue, episodeKey, requestedSelection) {
  const root = resolve(rootValue)
  if (!/^ep-\d{3}$/.test(episodeKey || '')) throw new Error('episode key 必须为 ep-001 格式')
  const marker = requestedSelection || JSON.parse(await readFile(resolve(root, 'episodes', episodeKey, 'recreation-workflow', 'selected.json'), 'utf8'))
  if (!/^v\d{3}$/.test(marker.versionId) || marker.path !== `episodes/${episodeKey}/recreation-workflow/${marker.versionId}.json`) throw new Error(`${episodeKey} 复刻工作流 selected 标记无效`)
  const workflowPath = await confined(root, marker.path)
  const workflow = validateRecreationWorkflow(JSON.parse(await readFile(workflowPath, 'utf8')), episodeKey)
  const analysisPath = await confined(root, workflow.analysis_ref.path)
  if (await fileSha256(analysisPath) !== workflow.analysis_ref.sha256) throw new Error(`${episodeKey} 复刻工作流分析哈希不一致`)
  const analysis = validateReferenceVideoAnalysis(JSON.parse(await readFile(analysisPath, 'utf8')))
  const compiled = {
    schema_version: 1,
    episode_key: episodeKey,
    workflow_ref: { version_id: marker.versionId, path: marker.path, sha256: await fileSha256(workflowPath) },
    analysis_ref: workflow.analysis_ref,
    rights: { mode: workflow.rights_mode, scope: workflow.rights_scope },
    reference_constraints: analysis.replication,
    slots: workflow.slots,
    script: workflow.script,
    media_tracks: workflow.media_tracks,
    captions: workflow.captions,
    speech: workflow.speech,
    film: workflow.film,
  }
  // 编译产物按工作流版本不可变存放，选择事务失败时不会覆盖上一版可用产物。
  await writeJson(root, resolve(root, '.short-drama/recreation-compiled', episodeKey, `${marker.versionId}.json`), compiled)
  return compiled
}

export async function validateRecreationEvidence(rootValue) {
  const root = resolve(rootValue)
  const manifest = JSON.parse(await readFile(resolve(root, 'source/manifest.json'), 'utf8'))
  const preparedPath = resolve(root, '.short-drama/reference-video/prepared.json')
  const analysisPath = resolve(root, '.short-drama/reference-video-analysis.json')
  const prepared = JSON.parse(await readFile(preparedPath, 'utf8'))
  await validatePreparedReferenceVideo(root, prepared)
  const analysis = validateReferenceVideoAnalysis(JSON.parse(await readFile(analysisPath, 'utf8')))
  const source = manifest.sources?.[prepared.source_ref?.key]
  const version = source?.versions?.find((item) => item.id === prepared.source_ref?.version_id)
  if (!source || (source.kind || 'document') !== 'reference-video' || source.selectedVersionId !== version?.id) throw new Error('prepared 未绑定当前 selected reference-video 来源')
  const sourcePath = await confined(root, version.localPath)
  const sourceDigest = await fileSha256(sourcePath)
  if (sourceDigest !== version.sha256 || sourceDigest !== prepared.source_ref.sha256 || sourceDigest !== analysis.source_ref.sha256) throw new Error('参考视频来源哈希不一致')
  if (analysis.source_ref.key !== source.key || analysis.source_ref.version_id !== version.id) throw new Error('参考分析未绑定当前来源版本')
  if (analysis.prepared_ref.sha256 !== await fileSha256(preparedPath)) throw new Error('参考分析 prepared 哈希不一致')
  const preparedTechnical = {
    duration_ms: prepared.technical.duration_ms,
    width: prepared.technical.width,
    height: prepared.technical.height,
    fps: prepared.technical.fps,
    has_audio: prepared.technical.has_audio,
  }
  if (Object.entries(preparedTechnical).some(([field, expected]) => analysis.technical[field] !== expected)) throw new Error('参考分析 technical 与 prepared 技术信息不一致')
  const preparedFrames = new Set(prepared.shots.map((shot) => shot.keyframe.local_path))
  const preparedFrameWindows = new Map(prepared.shots.map((shot) => [shot.keyframe.local_path, [shot.start_ms, shot.end_ms]]))
  for (const evidence of analysis.evidence) {
    if (evidence.frame_refs.some((path) => !preparedFrames.has(path))) throw new Error(`${evidence.id} frame_refs 引用了准备清单之外的关键帧`)
    if (evidence.frame_refs.some((path) => { const [start, end] = preparedFrameWindows.get(path); return evidence.end_ms <= start || evidence.start_ms >= end })) throw new Error(`${evidence.id} frame_refs 与证据时间范围不重叠`)
  }

  const episodeRoot = resolve(root, 'episodes')
  const entries = await readdir(episodeRoot, { withFileTypes: true })
  const selectedEpisodes = []
  for (const entry of entries.filter((item) => item.isDirectory() && /^ep-\d{3}$/.test(item.name))) {
    const markerPath = resolve(episodeRoot, entry.name, 'recreation-workflow', 'selected.json')
    let marker
    try { marker = JSON.parse(await readFile(markerPath, 'utf8')) } catch (error) { if (error?.code === 'ENOENT') continue; throw error }
    if (!/^v\d{3}$/.test(marker.versionId) || marker.path !== `episodes/${entry.name}/recreation-workflow/${marker.versionId}.json`) throw new Error(`${entry.name} 复刻工作流 selected 标记无效`)
    const workflow = validateRecreationWorkflow(JSON.parse(await readFile(resolve(root, marker.path), 'utf8')), entry.name)
    if (workflow.analysis_ref.sha256 !== await fileSha256(analysisPath)) throw new Error(`${entry.name} 复刻工作流分析哈希不一致`)
    if (workflow.source_ref.key !== source.key || workflow.source_ref.version_id !== version.id || workflow.source_ref.sha256 !== sourceDigest) throw new Error(`${entry.name} 复刻工作流来源引用不一致`)
    if (workflow.rights_mode === 'authorized-close-recreation') {
      if (!['owned', 'licensed'].includes(analysis.rights.status)) throw new Error(`${entry.name} reference-only 权利状态不允许近似复刻`)
      if (!analysis.rights.allowed_uses.includes('authorized-close-recreation')) throw new Error(`${entry.name} 参考分析权利范围不允许近似复刻`)
      if (workflow.rights_scope.some((scope) => !analysis.rights.allowed_uses.includes(scope))) throw new Error(`${entry.name} rights_scope 超出参考分析允许范围`)
      if (workflow.rights_scope.some((scope) => analysis.rights.restrictions.includes(scope))) throw new Error(`${entry.name} rights_scope 命中参考分析限制`)
    }
    const compiledPath = resolve(root, '.short-drama/recreation-compiled', entry.name, `${marker.versionId}.json`)
    const compiled = JSON.parse(await readFile(compiledPath, 'utf8'))
    if (compiled.schema_version !== 1 || compiled.episode_key !== entry.name || compiled.workflow_ref?.version_id !== marker.versionId || compiled.workflow_ref?.path !== marker.path || compiled.workflow_ref?.sha256 !== await fileSha256(resolve(root, marker.path))) throw new Error(`${entry.name} 编译产物 workflow_ref 哈希或版本无效`)
    if (compiled.analysis_ref?.path !== workflow.analysis_ref.path || compiled.analysis_ref?.sha256 !== workflow.analysis_ref.sha256) throw new Error(`${entry.name} 编译产物 analysis_ref 无效`)
    const expectedCompiledPayload = {
      rights: { mode: workflow.rights_mode, scope: workflow.rights_scope },
      reference_constraints: analysis.replication,
      slots: workflow.slots,
      script: workflow.script,
      media_tracks: workflow.media_tracks,
      captions: workflow.captions,
      speech: workflow.speech,
      film: workflow.film,
    }
    for (const [field, expected] of Object.entries(expectedCompiledPayload)) if (JSON.stringify(compiled[field]) !== JSON.stringify(expected)) throw new Error(`${entry.name} 编译产物 ${field} 与当前工作流不一致`)
    selectedEpisodes.push(entry.name)
  }
  if (!selectedEpisodes.length) throw new Error('至少一个 selected 复刻工作流')
  return selectedEpisodes
}

async function main() {
  const [command, path, episode] = process.argv.slice(2)
  if (command === '--self-check') return console.log('ok')
  if (command === 'compile') return console.log(JSON.stringify(await compileRecreationWorkflow(path, episode), null, 2))
  const value = JSON.parse(await readFile(path, 'utf8'))
  if (command === 'validate-analysis') validateReferenceVideoAnalysis(value)
  else if (command === 'validate-workflow') validateRecreationWorkflow(value, episode)
  else throw new Error('用法：recreation-workflow.mjs validate-analysis <JSON>|validate-workflow <JSON> <ep-001>|compile <项目目录> <ep-001>|--self-check')
  console.log('ok')
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.message); process.exitCode = 1 })
