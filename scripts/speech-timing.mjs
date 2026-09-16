import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, relative, resolve } from 'node:path'
import { withFileLock } from './file-lock.mjs'

const METHODS = new Set(['asr-forced-alignment', 'manual-direction'])
const ASR_LINE_AUTOMATIC_CONFIDENCE = 0.9
const ASR_WORD_AUTOMATIC_CONFIDENCE = 0.8
const VERSION = /^v\d{3}$/

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) throw new Error(`${label} 字段无效`)
}

function episodeKey(value) {
  if (typeof value !== 'string' || !/^ep-\d{3}$/.test(value)) throw new Error('speech-timing.episode_key 无效')
  return value
}

function versionId(value) {
  if (typeof value !== 'string' || !VERSION.test(value)) throw new Error('speech-timing version_id 必须为 v001 格式')
  return value
}

function speechTimingDirectory(rootArg, episode) {
  return resolve(rootArg, 'episodes', episodeKey(episode), 'speech-timing')
}

function sourceSelectionPath(rootArg, episode, sourceAsset) {
  validateSourceAsset(sourceAsset)
  return resolve(speechTimingDirectory(rootArg, episode), 'selected-sources', sourceAsset.asset_key, sourceAsset.version_id, 'selected.json')
}

function validateSourceAsset(value) {
  exactKeys(value, ['asset_key', 'version_id', 'sha256'], 'speech-timing.source_asset')
  if (typeof value.asset_key !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.asset_key) || !VERSION.test(value.version_id) || typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256)) throw new Error('speech-timing.source_asset 无效')
}

function validateWordTiming(word, line, lineIndex, wordIndex) {
  const label = `speech-timing lines[${lineIndex}].words[${wordIndex}]`
  if (typeof word.text !== 'string' || !word.text.trim() || !Number.isInteger(word.start_ms) || !Number.isInteger(word.end_ms) || word.start_ms < line.start_ms || word.end_ms > line.end_ms || word.end_ms <= word.start_ms) throw new Error(`${label} 必须按序位于行区间`)
  return label
}

function validateWord(word, line, lineIndex, wordIndex, reviewed) {
  const label = `speech-timing lines[${lineIndex}].words[${wordIndex}]`
  exactKeys(word, ['text', 'start_ms', 'end_ms', 'confidence', 'confidence_source'], label)
  validateWordTiming(word, line, lineIndex, wordIndex)
  if (typeof word.confidence !== 'number' || !Number.isFinite(word.confidence) || word.confidence < 0 || word.confidence > 1 || typeof word.confidence_source !== 'string' || !word.confidence_source.trim()) throw new Error(`${label} 置信度无效`)
  if (reviewed && word.confidence < ASR_WORD_AUTOMATIC_CONFIDENCE) throw new Error(`${label} 词级置信度低于 0.80，必须人工校正`)
}

function validateManualWord(word, line, lineIndex, wordIndex) {
  const label = `speech-timing lines[${lineIndex}].words[${wordIndex}]`
  exactKeys(word, ['text', 'start_ms', 'end_ms'], label)
  validateWordTiming(word, line, lineIndex, wordIndex)
}

function validateLine(line, index, method, reviewed, previousEnd) {
  const label = `speech-timing lines[${index}]`
  const expected = method === 'manual-direction'
    ? ['line_index', 'start_ms', 'end_ms', 'words', 'evidence']
    : ['line_index', 'start_ms', 'end_ms', 'confidence', 'confidence_source', 'words']
  if (line?.timeline_mapping !== undefined) expected.push('timeline_mapping')
  exactKeys(line, expected, label)
  if (!Number.isInteger(line.line_index) || line.line_index <= 0 || !Number.isInteger(line.start_ms) || !Number.isInteger(line.end_ms) || line.start_ms < 0 || line.end_ms <= line.start_ms) throw new Error(`${label} 时间区间无效`)
  if (previousEnd !== null && line.start_ms < previousEnd) throw new Error(`${label} 与前一行重叠`)
  if (line.timeline_mapping !== undefined) {
    exactKeys(line.timeline_mapping, ['source_in_ms', 'timeline_at_ms'], `${label}.timeline_mapping`)
    if (!Number.isInteger(line.timeline_mapping.source_in_ms) || line.timeline_mapping.source_in_ms < 0 || line.timeline_mapping.source_in_ms > line.end_ms || !Number.isInteger(line.timeline_mapping.timeline_at_ms) || line.timeline_mapping.timeline_at_ms < 0) throw new Error(`${label} 时间域转换无效`)
  }
  if (!Array.isArray(line.words)) throw new Error(`${label}.words 必须是数组`)
  if (method === 'manual-direction') {
    if (typeof line.evidence !== 'string' || !line.evidence.trim()) throw new Error(`${label} manual-direction evidence 无效`)
    let previousWordEnd = line.start_ms
    for (const [wordIndex, word] of line.words.entries()) {
      validateManualWord(word, line, index, wordIndex)
      if (word.start_ms < previousWordEnd) throw new Error(`speech-timing lines[${index}] 词时间未按序`)
      previousWordEnd = word.end_ms
    }
    return line.end_ms
  }
  if (typeof line.confidence !== 'number' || !Number.isFinite(line.confidence) || line.confidence < 0 || line.confidence > 1 || typeof line.confidence_source !== 'string' || !line.confidence_source.trim()) throw new Error(`${label} 行级置信度无效`)
  if (reviewed && line.confidence < ASR_LINE_AUTOMATIC_CONFIDENCE) throw new Error(`${label} 行级置信度低于 0.90，必须人工校正`)
  let previousWordEnd = line.start_ms
  for (const [wordIndex, word] of line.words.entries()) {
    validateWord(word, line, index, wordIndex, reviewed)
    if (word.start_ms < previousWordEnd) throw new Error(`speech-timing lines[${index}] 词时间未按序`)
    previousWordEnd = word.end_ms
  }
  return line.end_ms
}

export function validateSpeechTiming(document) {
  exactKeys(document, ['episode_key', 'source_asset', 'method', 'reviewed', 'language', 'lines'], 'speech-timing')
  episodeKey(document.episode_key)
  validateSourceAsset(document.source_asset)
  if (!METHODS.has(document.method)) throw new Error('speech-timing.method 无效')
  if (typeof document.reviewed !== 'boolean' || typeof document.language !== 'string' || !document.language.trim() || !Array.isArray(document.lines) || document.lines.length === 0) throw new Error('speech-timing reviewed/language/lines 无效')
  let previousEnd = null
  for (const [index, line] of document.lines.entries()) previousEnd = validateLine(line, index, document.method, document.reviewed, previousEnd)
  return structuredClone(document)
}

async function readVersion(rootArg, episode, version) {
  const directory = speechTimingDirectory(resolve(rootArg), episode)
  const target = resolve(directory, `${versionId(version)}.json`)
  try {
    return { version_id: version, document: validateSpeechTiming(JSON.parse(await readFile(target, 'utf8'))) }
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`speech-timing 版本不存在：${episode}@${version}`)
    throw error
  }
}

function sameSourceAsset(left, right) {
  return left.asset_key === right.asset_key && left.version_id === right.version_id && left.sha256 === right.sha256
}

export async function selectedSourceSpeechTiming(rootArg, reference) {
  if (!reference || typeof reference !== 'object') throw new Error('源 speech-timing 引用无效')
  const root = resolve(rootArg)
  const episode = episodeKey(reference.episode_key)
  const scopedPath = sourceSelectionPath(root, episode, reference.source_asset)
  let marker = await readFile(scopedPath, 'utf8').then(JSON.parse).catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error))
  if (marker === null) {
    const legacyPath = resolve(speechTimingDirectory(root, episode), 'selected.json')
    marker = await readFile(legacyPath, 'utf8').then(JSON.parse).catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error))
  }
  if (!marker || marker.versionId !== reference.version_id || marker.source_asset_sha256 !== reference.source_asset?.sha256) throw new Error('源 speech-timing 不是该来源的当前选版')
  const selected = await readVersion(root, episode, reference.version_id)
  if (selected.document.reviewed !== true || !sameSourceAsset(selected.document.source_asset, reference.source_asset)) throw new Error('源 speech-timing 必须绑定已复核版本及精确来源资产')
  if (!selected.document.lines.some((line) => line.line_index === reference.line_index)) throw new Error('源 speech-timing 行不存在')
  return selected
}

function finalAlignmentDirectory(root, audioAsset) {
  validateSourceAsset(audioAsset)
  const episode = /^audio-(ep\d{3})-/.exec(audioAsset.asset_key)?.[1]
  if (!episode) throw new Error('最终对齐必须绑定带分集身份的音频资产')
  return resolve(root, 'episodes', episode.replace('ep', 'ep-'), 'final-alignments', audioAsset.asset_key, audioAsset.version_id)
}

function validateFinalAlignment(document) {
  exactKeys(document, ['episode_key', 'line_index', 'audio_asset', 'audio_plan_version', 'source_timing', 'text', 'words', 'timeline_mapping', 'timeline_fps', 'reviewed'], 'final-speech-alignment')
  episodeKey(document.episode_key)
  validateSourceAsset(document.audio_asset)
  if (!document.audio_asset.asset_key.startsWith(`audio-${document.episode_key.replace('-', '')}-`)) throw new Error('最终对齐音频资产与分集不一致')
  exactKeys(document.source_timing, ['version_id', 'line_index', 'source_asset'], 'final-speech-alignment.source_timing')
  versionId(document.audio_plan_version)
  versionId(document.source_timing.version_id)
  validateSourceAsset(document.source_timing.source_asset)
  if (!Number.isInteger(document.line_index) || document.line_index <= 0 || document.source_timing.line_index !== document.line_index) throw new Error('final-speech-alignment 行引用无效')
  if (typeof document.text !== 'string' || !document.text.trim() || !Array.isArray(document.words) || document.words.length === 0 || document.reviewed !== true) throw new Error('最终音频必须有已复核的非空词级对齐')
  exactKeys(document.timeline_mapping, ['audio_in_ms', 'timeline_at_ms'], 'final-speech-alignment.timeline_mapping')
  if (!Number.isInteger(document.timeline_mapping.audio_in_ms) || document.timeline_mapping.audio_in_ms < 0 || !Number.isInteger(document.timeline_mapping.timeline_at_ms) || document.timeline_mapping.timeline_at_ms < 0 || !Number.isInteger(document.timeline_fps) || document.timeline_fps <= 0) throw new Error('最终对齐时间域转换无效')
  let previousEnd = -1
  for (const [index, word] of document.words.entries()) {
    exactKeys(word, ['text', 'start_ms', 'end_ms'], `final-speech-alignment.words[${index}]`)
    if (typeof word.text !== 'string' || !word.text.trim() || !Number.isInteger(word.start_ms) || !Number.isInteger(word.end_ms) || word.start_ms < 0 || word.end_ms <= word.start_ms || word.start_ms < previousEnd) throw new Error('最终词级对齐必须非空、按序且边界有效')
    previousEnd = word.end_ms
  }
  return structuredClone(document)
}

function alignmentTimelineRange(document) {
  const first = document.words[0]
  const last = document.words.at(-1)
  const offset = document.timeline_mapping.timeline_at_ms - document.timeline_mapping.audio_in_ms
  return { start_ms: first.start_ms + offset, end_ms: last.end_ms + offset }
}

export async function putFinalSpeechAlignment(rootArg, document) {
  const root = resolve(rootArg)
  const checked = validateFinalAlignment(document)
  const directory = finalAlignmentDirectory(root, checked.audio_asset)
  return withFileLock(resolve(directory, 'allocation'), async () => {
    const target = resolve(directory, 'v001.json')
    const existing = await readFile(target, 'utf8').catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error))
    if (existing !== null) {
      if (JSON.stringify(JSON.parse(existing)) !== JSON.stringify(checked)) throw new Error('同一最终音频版本的词级对齐不可变')
      return { version_id: 'v001', document: checked, timeline_range: alignmentTimelineRange(checked) }
    }
    await writeJsonAtomically(target, checked)
    await writeJsonAtomically(resolve(directory, 'selected.json'), { versionId: 'v001', audio_sha256: checked.audio_asset.sha256 }, { overwrite: true })
    return { version_id: 'v001', document: checked, timeline_range: alignmentTimelineRange(checked) }
  })
}

export async function finalSpeechAlignment(rootArg, audioAsset) {
  const root = resolve(rootArg)
  const directory = finalAlignmentDirectory(root, audioAsset)
  const marker = JSON.parse(await readFile(resolve(directory, 'selected.json'), 'utf8'))
  exactKeys(marker, ['versionId', 'audio_sha256'], 'final-speech-alignment selected')
  versionId(marker.versionId)
  const document = validateFinalAlignment(JSON.parse(await readFile(resolve(directory, `${marker.versionId}.json`), 'utf8')))
  if (marker.audio_sha256 !== audioAsset.sha256 || !sameSourceAsset(document.audio_asset, audioAsset)) throw new Error('最终对齐音频 SHA 或版本不匹配')
  return { version_id: marker.versionId, document, timeline_range: alignmentTimelineRange(document) }
}

function assertCorrectionEvidence(candidate, reviewed) {
  if (!sameSourceAsset(candidate.source_asset, reviewed.source_asset) || candidate.method !== reviewed.method) throw new Error('人工复核不得更换来源资产或对齐方法')
  if (candidate.method !== 'asr-forced-alignment') return
  const lowConfidenceLines = candidate.lines
    .map((line, lineIndex) => ({ line, lineIndex }))
    .filter(({ line }) => line.confidence < ASR_LINE_AUTOMATIC_CONFIDENCE)
  for (const { line, lineIndex } of lowConfidenceLines) {
    const reviewedLine = reviewed.lines[lineIndex]
    if (!reviewedLine || (reviewedLine.start_ms === line.start_ms && reviewedLine.end_ms === line.end_ms && reviewedLine.confidence_source === line.confidence_source)) throw new Error('低置信 ASR 必须保留对应人工校正证据')
  }
  const lowConfidenceWords = candidate.lines.flatMap((line, lineIndex) => line.words
    .map((word, wordIndex) => ({ word, lineIndex, wordIndex }))
    .filter(({ word }) => word.confidence < ASR_WORD_AUTOMATIC_CONFIDENCE))
  for (const { word, lineIndex, wordIndex } of lowConfidenceWords) {
    const reviewedWord = reviewed.lines[lineIndex]?.words[wordIndex]
    if (!reviewedWord || (reviewedWord.text === word.text && reviewedWord.start_ms === word.start_ms && reviewedWord.end_ms === word.end_ms && reviewedWord.confidence_source === word.confidence_source)) throw new Error('低置信 ASR 必须保留对应人工校正证据')
  }
}

async function writeJsonAtomically(target, value, { overwrite = false } = {}) {
  await mkdir(dirname(target), { recursive: true })
  if (!overwrite) return writeFile(target, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  const temporary = `${target}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  await rename(temporary, target)
}

async function writeNextVersion(rootArg, document, options = {}) {
  const root = resolve(rootArg)
  const checked = validateSpeechTiming(document)
  const directory = speechTimingDirectory(root, checked.episode_key)
  const lockTarget = resolve(directory, 'version-allocation')
  return withFileLock(lockTarget, async () => {
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => error?.code === 'ENOENT' ? [] : Promise.reject(error))
    const latest = Math.max(0, ...entries.filter((entry) => entry.isFile() && /^v\d{3}\.json$/.test(entry.name)).map((entry) => Number(entry.name.slice(1, 4))))
    const next = `v${String(latest + 1).padStart(3, '0')}`
    const target = resolve(directory, `${next}.json`)
    await writeJsonAtomically(target, checked)
    if (options.select) {
      const reviewedBy = options.reviewed_by
      if (typeof reviewedBy !== 'string' || !reviewedBy.trim()) throw new Error('speech-timing.reviewed_by 必填')
      const marker = {
        versionId: next,
        path: relative(root, target),
        source_asset_sha256: checked.source_asset.sha256,
        reviewed_by: reviewedBy,
      }
      // 每个来源单独维护当前证据，避免多个镜头/音轨竞争剧集唯一 selected；全局标记仅保留旧调用兼容。
      await writeJsonAtomically(sourceSelectionPath(root, checked.episode_key, checked.source_asset), marker, { overwrite: true })
      await writeJsonAtomically(resolve(directory, 'selected.json'), marker, { overwrite: true })
    }
    return { version_id: next, document: checked }
  })
}

export async function putSpeechTimingCandidate(rootArg, document) {
  const candidate = validateSpeechTiming(document)
  if (candidate.reviewed !== false) throw new Error('speech-timing 候选只能写入 reviewed:false')
  return writeNextVersion(rootArg, candidate)
}

export async function reviewSpeechTiming(rootArg, input) {
  if (!input || typeof input !== 'object') throw new Error('speech-timing 复核输入无效')
  const episode = episodeKey(input.episode_key)
  if (typeof input.reviewed_by !== 'string' || !input.reviewed_by.trim()) throw new Error('speech-timing.reviewed_by 必填')
  const candidate = await readVersion(rootArg, episode, input.candidate_version)
  if (candidate.document.reviewed !== false) throw new Error('只能复核未复核候选')
  const reviewed = validateSpeechTiming({ ...structuredClone(input.document), reviewed: true })
  if (reviewed.episode_key !== episode) throw new Error('speech-timing 复核 episode_key 不一致')
  assertCorrectionEvidence(candidate.document, reviewed)
  return writeNextVersion(rootArg, reviewed, { select: true, reviewed_by: input.reviewed_by })
}

export async function selectedSpeechTiming(rootArg, episode) {
  const root = resolve(rootArg)
  const directory = speechTimingDirectory(root, episode)
  let marker
  try {
    marker = JSON.parse(await readFile(resolve(directory, 'selected.json'), 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`speech-timing selected 不存在：${episode}`)
    throw error
  }
  exactKeys(marker, ['versionId', 'path', 'source_asset_sha256', 'reviewed_by'], 'speech-timing selected')
  versionId(marker.versionId)
  if (typeof marker.path !== 'string' || resolve(root, marker.path) !== resolve(directory, `${marker.versionId}.json`) || typeof marker.source_asset_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(marker.source_asset_sha256) || typeof marker.reviewed_by !== 'string' || !marker.reviewed_by.trim()) throw new Error('speech-timing selected 无效')
  const selected = await readVersion(root, episode, marker.versionId)
  if (selected.document.reviewed !== true || selected.document.source_asset.sha256 !== marker.source_asset_sha256) throw new Error('speech-timing selected 必须是哈希匹配的已复核版本')
  return { ...selected, reviewed_by: marker.reviewed_by }
}
