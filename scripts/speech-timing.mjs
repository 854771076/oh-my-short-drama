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
  exactKeys(line, expected, label)
  if (!Number.isInteger(line.line_index) || line.line_index <= 0 || !Number.isInteger(line.start_ms) || !Number.isInteger(line.end_ms) || line.start_ms < 0 || line.end_ms <= line.start_ms) throw new Error(`${label} 时间区间无效`)
  if (previousEnd !== null && line.start_ms < previousEnd) throw new Error(`${label} 与前一行重叠`)
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

function assertCorrectionEvidence(candidate, reviewed) {
  if (!sameSourceAsset(candidate.source_asset, reviewed.source_asset) || candidate.method !== reviewed.method) throw new Error('人工复核不得更换来源资产或对齐方法')
  if (candidate.method !== 'asr-forced-alignment') return
  const lowConfidenceLines = candidate.lines
    .map((line, lineIndex) => ({ line, lineIndex }))
    .filter(({ line }) => line.confidence < ASR_LINE_AUTOMATIC_CONFIDENCE)
  for (const { line, lineIndex } of lowConfidenceLines) {
    const reviewedLine = reviewed.lines[lineIndex]
    if (!reviewedLine || reviewedLine.confidence_source === line.confidence_source) throw new Error('低置信 ASR 必须保留对应人工校正证据')
  }
  const lowConfidenceWords = candidate.lines.flatMap((line, lineIndex) => line.words
    .map((word, wordIndex) => ({ word, lineIndex, wordIndex }))
    .filter(({ word }) => word.confidence < ASR_WORD_AUTOMATIC_CONFIDENCE))
  for (const { word, lineIndex, wordIndex } of lowConfidenceWords) {
    const reviewedWord = reviewed.lines[lineIndex]?.words[wordIndex]
    if (!reviewedWord || reviewedWord.confidence_source === word.confidence_source) throw new Error('低置信 ASR 必须保留对应人工校正证据')
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
      await writeJsonAtomically(resolve(directory, 'selected.json'), {
        versionId: next,
        path: relative(root, target),
        source_asset_sha256: checked.source_asset.sha256,
        reviewed_by: reviewedBy,
      }, { overwrite: true })
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
