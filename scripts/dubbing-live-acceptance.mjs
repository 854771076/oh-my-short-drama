#!/usr/bin/env node
import { createReadStream } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { validateTimeline } from './editing-store.mjs'
import { probeMedia } from './media-tools.mjs'
import { finalSpeechAlignment, selectedSourceSpeechTiming } from './speech-timing.mjs'

function parseIdentity(value, label) {
  const match = /^([a-z0-9]+(?:-[a-z0-9]+)*)@(v\d{3})$/.exec(value || '')
  if (!match) throw new Error(`${label} 必须为 asset-key@v001`)
  return { key: match[1], version_id: match[2] }
}

async function sha256(path) { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex') }
async function json(path) { return JSON.parse(await readFile(path, 'utf8')) }

function assetVersion(root, ledger, identity, requireSelected) {
  const asset = ledger.assets?.[identity.key]
  const version = asset?.versions?.find((item) => item.id === identity.version_id)
  if (!version || asset.staleVersionIds?.includes(identity.version_id) || requireSelected && asset.selectedVersionId !== identity.version_id) throw new Error(`${identity.key}@${identity.version_id} 不存在、已失效或不是 selected`)
  const path = resolve(root, version.localPath)
  if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error('验收资产路径越界')
  return { asset, version, path }
}

export function assessWordAlignment(timingLine, alignment, toleranceMs) {
  if (!Array.isArray(alignment?.words) || !alignment.words.length) return { status: 'missing', max_error_ms: null, items: [] }
  const expected = timingLine.words || []
  const items = expected.map((word, index) => {
    const actual = alignment.words[index]
    return { index, text: word.text, actual_text: actual?.text ?? null, start_error_ms: actual ? actual.start_ms - word.start_ms : null, end_error_ms: actual ? actual.end_ms - word.end_ms : null }
  })
  const maxError = items.length ? Math.max(...items.flatMap((item) => [Math.abs(item.start_error_ms ?? Number.POSITIVE_INFINITY), Math.abs(item.end_error_ms ?? Number.POSITIVE_INFINITY)])) : null
  const sameWords = items.length === alignment.words.length && items.every((item) => item.text === item.actual_text)
  // 不同表演允许词内韵律重新分配；同步硬门禁约束整句首尾，逐词偏差仍完整保留供导演审计。
  const boundaryErrors = items.length ? [Math.abs(items[0].start_error_ms ?? Number.POSITIVE_INFINITY), Math.abs(items.at(-1).end_error_ms ?? Number.POSITIVE_INFINITY)] : []
  const boundaryMaxError = boundaryErrors.length ? Math.max(...boundaryErrors) : null
  return {
    status: !sameWords ? 'mismatch' : boundaryMaxError <= toleranceMs ? 'passed' : 'out-of-tolerance',
    max_error_ms: Number.isFinite(maxError) ? maxError : null,
    boundary_max_error_ms: Number.isFinite(boundaryMaxError) ? boundaryMaxError : null,
    items,
  }
}

export function mapSourceTimingLineToTimeline(line) {
  const mapping = line.timeline_mapping || { source_in_ms: 0, timeline_at_ms: 0 }
  const offset = mapping.timeline_at_ms - mapping.source_in_ms
  return {
    line_index: line.line_index,
    start_ms: line.start_ms + offset,
    end_ms: line.end_ms + offset,
    words: (line.words || []).map((word) => ({ ...word, start_ms: word.start_ms + offset, end_ms: word.end_ms + offset })),
  }
}

export function validateAcceptanceMedia(originalMedia, dubMedia) {
  if (!originalMedia?.has_audio || !dubMedia?.has_audio) throw new Error('真实验收资产必须包含可解码原声音轨和配音音轨')
}

export async function assessDubbingLiveAcceptance(rootArg, episodeKey, lineIndex, options) {
  const root = resolve(rootArg)
  if (!/^ep-\d{3}$/.test(episodeKey) || !Number.isInteger(lineIndex) || lineIndex <= 0) throw new Error('episode 或 line 无效')
  const originalId = parseIdentity(options.original, '--original')
  const dubId = parseIdentity(options.dub, '--dub')
  const ledger = await json(resolve(root, '.short-drama/assets.json'))
  const planMarker = await json(resolve(root, 'episodes', episodeKey, 'audio-plan', 'selected.json'))
  const plan = await json(resolve(root, planMarker.path || `episodes/${episodeKey}/audio-plan/${planMarker.versionId}.json`))
  const planLine = plan.approved === true && !plan.unresolved?.length && plan.lines?.find((line) => line.line_index === lineIndex)
  const sourceReference = planLine?.dubbing_contract?.timing_source
  if (!sourceReference) throw new Error('验收必须绑定当前已批准合同的源 timing')
  if (sourceReference.source_asset.asset_key !== originalId.key || sourceReference.source_asset.version_id !== originalId.version_id) throw new Error('--original 必须是合同 timing_source 的原声来源资产')
  const sourceTiming = await selectedSourceSpeechTiming(root, sourceReference)
  const sourceTimingLine = sourceTiming.document.lines.find((line) => line.line_index === lineIndex)
  const timelineTimingLine = mapSourceTimingLineToTimeline(sourceTimingLine)
  const original = assetVersion(root, ledger, originalId, false)
  const dub = assetVersion(root, ledger, dubId, true)
  const [originalSha, dubSha] = await Promise.all([sha256(original.path), sha256(dub.path)])
  if (originalSha !== original.version.sha256 || dubSha !== dub.version.sha256) throw new Error('原声或配音文件 SHA 与资产账本不一致')
  if (originalSha !== sourceReference.source_asset.sha256) throw new Error('--original 的 SHA 与合同 timing_source 来源不一致')
  const originalMedia = probeMedia(original.path)
  const dubMedia = probeMedia(dub.path)
  validateAcceptanceMedia(originalMedia, dubMedia)

  const reviewFile = resolve(options.review)
  if (reviewFile !== root && !reviewFile.startsWith(`${root}${sep}`)) throw new Error('审核账本必须位于项目目录内')
  const reviews = await json(reviewFile)
  const review = reviews.reviews?.[`${dubId.key}@${dubId.version_id}`]
  if (!review || review.asset_sha256 !== dubSha || review.episode_key !== episodeKey || review.line_index !== lineIndex) throw new Error('缺少与当前配音 SHA、分集和行号一致的八维审核')

  const timeline = await json(resolve(root, 'editing', episodeKey, 'timeline.json')).catch(() => null)
  const toleranceMs = Math.ceil(1000 / (timeline?.fps || 24))
  const finalAlignment = await finalSpeechAlignment(root, { asset_key: dubId.key, version_id: dubId.version_id, sha256: dubSha })
  if (review.timing_version_id !== finalAlignment.version_id) throw new Error('验收必须绑定当前最终配音词级对齐')
  const alignmentSource = finalAlignment.document.source_timing
  if (alignmentSource.version_id !== sourceReference.version_id || alignmentSource.line_index !== sourceReference.line_index || alignmentSource.source_asset.asset_key !== sourceReference.source_asset.asset_key || alignmentSource.source_asset.version_id !== sourceReference.source_asset.version_id || alignmentSource.source_asset.sha256 !== sourceReference.source_asset.sha256) throw new Error('最终配音对齐没有绑定合同的精确源 timing')
  const offset = finalAlignment.document.timeline_mapping.timeline_at_ms - finalAlignment.document.timeline_mapping.audio_in_ms
  const measuredWords = assessWordAlignment(timelineTimingLine, { words: finalAlignment.document.words.map((word) => ({ ...word, start_ms: word.start_ms + offset, end_ms: word.end_ms + offset })) }, toleranceMs)

  const subtitle = timeline?.subtitles?.find((item) => item.audio_binding?.line_index === lineIndex)
  const audioBinding = subtitle?.audio_binding
  const subtitleBound = audioBinding?.asset_key === dubId.key && audioBinding?.version_id === dubId.version_id && audioBinding?.sha256 === dubSha && audioBinding?.speech_timing_version === finalAlignment.version_id
  let timelineValid = false
  try { if (timeline) { await validateTimeline(root, timeline); timelineValid = true } } catch {}
  const contractRange = planLine.dubbing_contract.target_range
  const lipSegment = timeline?.segments?.find((segment) => {
    const asset = ledger.assets?.[segment.asset_key]
    const version = asset?.versions?.find((item) => item.id === segment.version_id)
    const parameters = version?.provenance?.parameters
    const requestBinding = parameters?.parameters?.audio_binding
    const range = parameters?.range
    return segment.dialogue_sync === 'lip-synced' && asset?.selectedVersionId === segment.version_id && !asset.staleVersionIds?.includes(segment.version_id) && requestBinding?.sha256 === dubSha && range?.start_ms === contractRange?.start_ms && range?.end_ms === contractRange?.end_ms
  })
  const dimensionPassed = review.watched_full === true && Object.values(review.dimensions || {}).length === 8 && Object.values(review.dimensions || {}).every((dimension) => dimension.status === 'passed')
  const subtitleErrors = subtitle ? { start: subtitle.startMs - timelineTimingLine.start_ms, end: subtitle.endMs - timelineTimingLine.end_ms } : null
  const subtitleToleranceMs = toleranceMs * 4
  const subtitleWithinTolerance = subtitleErrors && Math.abs(subtitleErrors.start) <= subtitleToleranceMs && Math.abs(subtitleErrors.end) <= subtitleToleranceMs
  const accepted = dimensionPassed && measuredWords.status === 'passed' && subtitleBound === true && subtitleWithinTolerance === true && timelineValid && Boolean(lipSegment) && !review.issues?.some((issue) => ['P0', 'P1'].includes(issue.severity))
  const report = {
    version: 1, episode_key: episodeKey, line_index: lineIndex, created_at: new Date().toISOString(), accepted,
    original: { asset_key: originalId.key, version_id: originalId.version_id, sha256: originalSha },
    dub: { asset_key: dubId.key, version_id: dubId.version_id, sha256: dubSha },
    source_timing: { version_id: sourceTiming.version_id, source_asset: sourceReference.source_asset, word_errors: measuredWords },
    final_alignment: { version_id: finalAlignment.version_id },
    production_duration_ms: Number.isInteger(review.production_duration_ms) ? review.production_duration_ms : null,
    subtitle: { bound: subtitleBound, within_tolerance: subtitleWithinTolerance, tolerance_ms: subtitleToleranceMs, start_error_ms: subtitleErrors?.start ?? null, end_error_ms: subtitleErrors?.end ?? null },
    lip_sync: { bound: Boolean(lipSegment), segment: lipSegment ? `${lipSegment.asset_key}@${lipSegment.version_id}` : null },
    performance_review: { watched_full: review.watched_full === true, dimensions: review.dimensions, issues: review.issues || [] },
  }
  return { report }
}

function acceptanceIdentity(report) {
  return JSON.stringify({
    episode_key: report.episode_key,
    line_index: report.line_index,
    original: report.original,
    dub: report.dub,
    source_timing_version: report.source_timing?.version_id,
    final_alignment_version: report.final_alignment?.version_id,
  })
}

async function existingReport(path) {
  try { return JSON.parse(await readFile(path, 'utf8')) }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error }
}

async function writeImmutableReport(output, report) {
  const previous = await existingReport(output)
  if (previous) {
    if (acceptanceIdentity(previous) === acceptanceIdentity(report)) return previous
    throw new Error(`真实 A/B 验收报告身份冲突且不可覆盖：${output}`)
  }
  const temporary = `${output}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
  try { await link(temporary, output) }
  catch (error) {
    if (error?.code !== 'EEXIST') throw error
    const raced = await existingReport(output)
    if (!raced || acceptanceIdentity(raced) !== acceptanceIdentity(report)) throw new Error(`真实 A/B 验收报告身份冲突且不可覆盖：${output}`)
    return raced
  } finally { await unlink(temporary).catch((error) => { if (error?.code !== 'ENOENT') throw error }) }
  return report
}

export async function runDubbingLiveAcceptance(rootArg, episodeKey, lineIndex, options) {
  const root = resolve(rootArg)
  const { report } = await assessDubbingLiveAcceptance(root, episodeKey, lineIndex, options)
  const directory = resolve(root, '.short-drama', 'acceptance')
  await mkdir(directory, { recursive: true })
  const stem = `source-timed-dubbing-${episodeKey}-line-${String(lineIndex).padStart(3, '0')}`
  const primary = resolve(directory, `${stem}.json`)
  const primaryReport = await existingReport(primary)
  const output = primaryReport && acceptanceIdentity(primaryReport) !== acceptanceIdentity(report)
    ? resolve(directory, `${stem}-dub-${report.dub.version_id}-alignment-${report.final_alignment.version_id}.json`)
    : primary
  const stored = await writeImmutableReport(output, report)
  return { output, report: stored }
}

async function main() {
  const [root, episode, lineArg, ...rest] = process.argv.slice(2)
  const options = {}
  for (let index = 0; index < rest.length; index += 2) options[rest[index]?.replace(/^--/, '')] = rest[index + 1]
  if (!root || !episode || !/^\d+$/.test(lineArg || '') || !options.original || !options.dub || !options.review) throw new Error('用法：dubbing-live-acceptance.mjs <project-root> ep-001 <line> --original asset@v001 --dub audio@v003 --review <dubbing-reviews.json>')
  const result = await runDubbingLiveAcceptance(root, episode, Number(lineArg), options)
  console.log(JSON.stringify(result, null, 2))
  if (!result.report.accepted) process.exitCode = 2
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.message); process.exitCode = 1 })
