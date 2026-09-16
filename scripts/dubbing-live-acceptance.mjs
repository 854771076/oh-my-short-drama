#!/usr/bin/env node
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { validateTimeline } from './editing-store.mjs'
import { probeMedia } from './media-tools.mjs'
import { finalSpeechAlignment } from './speech-timing.mjs'

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
  return { status: !sameWords ? 'mismatch' : maxError <= toleranceMs ? 'passed' : 'out-of-tolerance', max_error_ms: Number.isFinite(maxError) ? maxError : null, items }
}

export async function runDubbingLiveAcceptance(rootArg, episodeKey, lineIndex, options) {
  const root = resolve(rootArg)
  if (!/^ep-\d{3}$/.test(episodeKey) || !Number.isInteger(lineIndex) || lineIndex <= 0) throw new Error('episode 或 line 无效')
  const originalId = parseIdentity(options.original, '--original')
  const dubId = parseIdentity(options.dub, '--dub')
  const ledger = await json(resolve(root, '.short-drama/assets.json'))
  const original = assetVersion(root, ledger, originalId, true)
  const dub = assetVersion(root, ledger, dubId, true)
  const [originalSha, dubSha] = await Promise.all([sha256(original.path), sha256(dub.path)])
  if (originalSha !== original.version.sha256 || dubSha !== dub.version.sha256) throw new Error('原声或配音文件 SHA 与资产账本不一致')
  const originalMedia = probeMedia(original.path)
  const dubMedia = probeMedia(dub.path)
  if ((!originalMedia.has_video && !originalMedia.has_audio) || !dubMedia.has_audio) throw new Error('真实验收资产必须包含可解码原声媒体和配音音轨')

  const reviewFile = resolve(options.review)
  if (reviewFile !== root && !reviewFile.startsWith(`${root}${sep}`)) throw new Error('审核账本必须位于项目目录内')
  const reviews = await json(reviewFile)
  const review = reviews.reviews?.[`${dubId.key}@${dubId.version_id}`]
  if (!review || review.asset_sha256 !== dubSha || review.episode_key !== episodeKey || review.line_index !== lineIndex) throw new Error('缺少与当前配音 SHA、分集和行号一致的八维审核')

  const timingMarker = await json(resolve(root, 'episodes', episodeKey, 'speech-timing', 'selected.json'))
  const timing = await json(resolve(root, 'episodes', episodeKey, 'speech-timing', `${timingMarker.versionId}.json`))
  const timingLine = timing.lines?.find((line) => line.line_index === lineIndex)
  if (!timingLine) throw new Error('验收必须绑定当前 selected speech-timing')
  const timeline = await json(resolve(root, 'editing', episodeKey, 'timeline.json')).catch(() => null)
  const toleranceMs = Math.ceil(1000 / (timeline?.fps || 24))
  const finalAlignment = await finalSpeechAlignment(root, { asset_key: dubId.key, version_id: dubId.version_id, sha256: dubSha })
  if (review.timing_version_id !== finalAlignment.version_id) throw new Error('验收必须绑定当前最终配音词级对齐')
  const offset = finalAlignment.document.timeline_mapping.timeline_at_ms - finalAlignment.document.timeline_mapping.audio_in_ms
  const measuredWords = assessWordAlignment(timingLine, { words: finalAlignment.document.words.map((word) => ({ ...word, start_ms: word.start_ms + offset, end_ms: word.end_ms + offset })) }, toleranceMs)

  const subtitle = timeline?.subtitles?.find((item) => item.audio_binding?.line_index === lineIndex)
  const audioBinding = subtitle?.audio_binding
  const subtitleBound = audioBinding?.asset_key === dubId.key && audioBinding?.version_id === dubId.version_id && audioBinding?.sha256 === dubSha && audioBinding?.speech_timing_version === timingMarker.versionId
  let timelineValid = false
  try { if (timeline) { await validateTimeline(root, timeline); timelineValid = true } } catch {}
  const planMarker = await json(resolve(root, 'episodes', episodeKey, 'audio-plan', 'selected.json'))
  const plan = await json(resolve(root, planMarker.path || `episodes/${episodeKey}/audio-plan/${planMarker.versionId}.json`))
  const contractRange = plan.lines?.find((line) => line.line_index === lineIndex)?.dubbing_contract?.target_range
  const lipSegment = timeline?.segments?.find((segment) => {
    const asset = ledger.assets?.[segment.asset_key]
    const version = asset?.versions?.find((item) => item.id === segment.version_id)
    const parameters = version?.provenance?.parameters
    const requestBinding = parameters?.parameters?.audio_binding
    const range = parameters?.range
    return segment.dialogue_sync === 'lip-synced' && asset?.selectedVersionId === segment.version_id && !asset.staleVersionIds?.includes(segment.version_id) && requestBinding?.sha256 === dubSha && range?.start_ms === contractRange?.start_ms && range?.end_ms === contractRange?.end_ms
  })
  const dimensionPassed = review.watched_full === true && Object.values(review.dimensions || {}).length === 8 && Object.values(review.dimensions || {}).every((dimension) => dimension.status === 'passed')
  const subtitleErrors = subtitle ? { start: subtitle.startMs - timingLine.start_ms, end: subtitle.endMs - timingLine.end_ms } : null
  const subtitleToleranceMs = toleranceMs * 4
  const subtitleWithinTolerance = subtitleErrors && Math.abs(subtitleErrors.start) <= subtitleToleranceMs && Math.abs(subtitleErrors.end) <= subtitleToleranceMs
  const accepted = dimensionPassed && measuredWords.status === 'passed' && subtitleBound === true && subtitleWithinTolerance === true && timelineValid && Boolean(lipSegment) && !review.issues?.some((issue) => ['P0', 'P1'].includes(issue.severity))
  const report = {
    version: 1, episode_key: episodeKey, line_index: lineIndex, created_at: new Date().toISOString(), accepted,
    original: { asset_key: originalId.key, version_id: originalId.version_id, sha256: originalSha },
    dub: { asset_key: dubId.key, version_id: dubId.version_id, sha256: dubSha },
    timing: { version_id: timingMarker.versionId, word_errors: measuredWords },
    production_duration_ms: Number.isInteger(review.production_duration_ms) ? review.production_duration_ms : null,
    subtitle: { bound: subtitleBound, within_tolerance: subtitleWithinTolerance, tolerance_ms: subtitleToleranceMs, start_error_ms: subtitleErrors?.start ?? null, end_error_ms: subtitleErrors?.end ?? null },
    lip_sync: { bound: Boolean(lipSegment), segment: lipSegment ? `${lipSegment.asset_key}@${lipSegment.version_id}` : null },
    performance_review: { watched_full: review.watched_full === true, dimensions: review.dimensions, issues: review.issues || [] },
  }
  const output = resolve(root, '.short-drama', 'acceptance', `source-timed-dubbing-${episodeKey}-line-${String(lineIndex).padStart(3, '0')}.json`)
  await mkdir(dirname(output), { recursive: true })
  const temporary = `${output}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
  await rename(temporary, output)
  return { output, report }
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
