#!/usr/bin/env node
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, relative, resolve, sep } from 'node:path'
import { withFileLock } from './file-lock.mjs'
import { invalidateFrom } from './invalidate-workflow.mjs'

const TRANSITIONS = new Set(['none', 'hard-cut', 'action-cut', 'eyeline-cut', 'composition-match', 'j-cut', 'l-cut', 'occlusion', 'fade', 'dissolve'])
const AUDIO_ROLES = new Set(['dialogue', 'voiceover', 'ambient', 'bgm', 'sfx', 'native'])
const EPISODE = /^ep-\d{3}$/
const episodePath = (root, area, episode, file) => {
  if (!EPISODE.test(episode)) throw new Error('episode key 必须为 ep-001 格式')
  return resolve(root, area, episode, file)
}
const timelinePath = (root, episode) => episodePath(root, 'editing', episode, 'timeline.json')

async function existingInside(root, value, area) {
  const rootReal = await realpath(root)
  const path = await realpath(resolve(root, value))
  if (path !== rootReal && !path.startsWith(`${rootReal}${sep}`)) throw new Error('文件真实路径必须位于项目目录内')
  if (area) {
    const areaReal = await realpath(resolve(root, area))
    if (path !== areaReal && !path.startsWith(`${areaReal}${sep}`)) throw new Error(`交付文件必须位于 ${area}/`)
  }
  return path
}

async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function atomic(path, value, exclusive = false) {
  await mkdir(dirname(path), { recursive: true })
  const content = `${JSON.stringify(value, null, 2)}\n`
  if (exclusive) return writeFile(path, content, { flag: 'wx' })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, content, { flag: 'wx' })
  await rename(temporary, path)
}

export function validateReview(review, episode) {
  const checks = ['narrative', 'visual', 'audio', 'transitions', 'captions', 'technical']
  if (typeof review !== 'object' || review === null || !checks.every((key) => ['passed', 'failed'].includes(review[key]))) throw new Error('完整审片必须包含六项 passed/failed 检查')
  if (!EPISODE.test(review.episode_key) || episode && review.episode_key !== episode) throw new Error('完整审片 episode_key 无效或与目标分集不一致')
  if (review.watchedFull !== true) throw new Error('必须完整观看并听完成片')
  if (!Array.isArray(review.issues)) throw new Error('完整审片 issues[] 必填')
  if (!review.observations || typeof review.observations !== 'object' || Array.isArray(review.observations) || !checks.every((key) => typeof review.observations[key] === 'string' && review.observations[key].trim())) throw new Error('完整审片 observations 必须逐项记录六个维度的实际观察')
  for (const issue of review.issues) if (!['P0', 'P1', 'P2'].includes(issue?.severity) || typeof issue.message !== 'string' || !issue.message) throw new Error('审片 issue 必须包含有效 severity/message')
  const approved = checks.every((key) => review[key] === 'passed') && review.issues.every((issue) => !['P0', 'P1'].includes(issue?.severity))
  if (review.approved !== approved) throw new Error(`approved 必须为 ${approved}`)
  return review
}

export async function validateTimeline(root, timeline) {
  for (const field of ['fps', 'width', 'height']) if (!Number.isInteger(timeline[field]) || timeline[field] <= 0) throw new Error(`${field} 必须是正整数`)
  if (!EPISODE.test(timeline.episode_key) || !Array.isArray(timeline.segments) || timeline.segments.length === 0 || !Array.isArray(timeline.subtitles)) throw new Error('timeline episode_key、segments[]、subtitles[] 必填')
  const audioTracks = timeline.audio_tracks || []
  const labels = timeline.labels || []
  const graphics = timeline.graphics || []
  if (!Array.isArray(audioTracks) || !Array.isArray(labels) || !Array.isArray(graphics)) throw new Error('timeline audio_tracks[]、labels[]、graphics[] 必须是数组')
  const assets = JSON.parse(await readFile(resolve(root, '.short-drama', 'assets.json'), 'utf8'))
  const reviews = JSON.parse(await readFile(resolve(root, '.short-drama', 'shot-reviews.json'), 'utf8'))
  const keys = new Set()
  let previousEnd = 0
  const segments = []
  for (const segment of timeline.segments) {
    for (const field of ['shot_key', 'asset_key', 'version_id']) if (typeof segment[field] !== 'string' || !segment[field]) throw new Error(`segment.${field} 必填`)
    if (!/^v\d{3}$/.test(segment.version_id)) throw new Error(`${segment.shot_key}.version_id 必须为 v001 格式`)
    if (keys.has(segment.shot_key)) throw new Error(`shot_key 重复：${segment.shot_key}`)
    keys.add(segment.shot_key)
    for (const field of ['source_in_ms', 'source_out_ms', 'timeline_start_ms', 'timeline_end_ms']) if (!Number.isInteger(segment[field]) || segment[field] < 0) throw new Error(`${segment.shot_key}.${field} 必须是非负整数`)
    if (segment.source_out_ms <= segment.source_in_ms || segment.timeline_end_ms <= segment.timeline_start_ms || segment.timeline_start_ms < previousEnd) throw new Error(`${segment.shot_key} 时间范围无效或与前镜重叠`)
    const transition = typeof segment.transition === 'string' ? { type: segment.transition, duration_frames: 0 } : segment.transition
    if (!transition || !TRANSITIONS.has(transition.type) || !Number.isInteger(transition.duration_frames) || transition.duration_frames < 0 || transition.duration_frames > timeline.fps) throw new Error(`${segment.shot_key}.transition 无效`)
    if (['none', 'hard-cut', 'action-cut', 'eyeline-cut', 'composition-match', 'j-cut', 'l-cut'].includes(transition.type) && transition.duration_frames !== 0) throw new Error(`${segment.shot_key} 当前转场类型不得设置持续帧`)
    const asset = assets.assets?.[segment.asset_key]
    const version = asset?.versions?.find((item) => item.id === segment.version_id)
    if (asset?.type !== 'video' || asset.selectedVersionId !== segment.version_id || !version?.localPath) throw new Error(`${segment.shot_key} 必须引用 selected 视频版本`)
    if (version.provenance?.prompt_document?.episode_key !== timeline.episode_key) throw new Error(`${segment.shot_key} 视频不属于 ${timeline.episode_key}`)
    const shotNumber = version.provenance?.prompt_document?.shot_number
    const expectedShotKey = `shot-${timeline.episode_key.replace('-', '')}-${String(shotNumber).padStart(3, '0')}`
    if (!Number.isInteger(shotNumber) || segment.shot_key !== expectedShotKey || segment.asset_key !== expectedShotKey) throw new Error(`${segment.shot_key} 必须与视频提示词镜号和规范资产 key 一致`)
    if (!reviews.reviews?.[`${segment.asset_key}@${segment.version_id}`]?.approved) throw new Error(`${segment.shot_key} 未通过逐镜四项验收`)
    await existingInside(root, version.localPath)
    previousEnd = segment.timeline_end_ms
    segments.push({ ...segment, transition, source: version.localPath })
  }
  for (const subtitle of timeline.subtitles) {
    if (typeof subtitle.text !== 'string' || !subtitle.text || !Number.isInteger(subtitle.startMs) || !Number.isInteger(subtitle.endMs) || !Number.isInteger(subtitle.timestampMs) || typeof subtitle.confidence !== 'number' || subtitle.confidence < 0 || subtitle.confidence > 1 || subtitle.startMs < 0 || subtitle.endMs <= subtitle.startMs || subtitle.timestampMs < subtitle.startMs || subtitle.timestampMs > subtitle.endMs || subtitle.endMs > previousEnd) throw new Error('字幕必须符合 Remotion Caption 时间与置信度合同')
    if ('speaker' in subtitle && (typeof subtitle.speaker !== 'string' || !subtitle.speaker.trim())) throw new Error('字幕 speaker 必须是非空字符串')
    if ('show_speaker' in subtitle && typeof subtitle.show_speaker !== 'boolean') throw new Error('字幕 show_speaker 必须是布尔值（默认 false，电影式隐藏）')
    if ('speakers' in subtitle && (!Array.isArray(subtitle.speakers) || subtitle.speakers.length < 1 || subtitle.speakers.length > 2 || subtitle.speakers.some((name) => typeof name !== 'string' || !name.trim()))) throw new Error('字幕 speakers 必须是 1–2 个非空字符串（双人对白）')
  }
  for (const track of audioTracks) {
    for (const field of ['asset_key', 'version_id', 'role']) if (typeof track[field] !== 'string' || !track[field]) throw new Error(`audio_track.${field} 必填`)
    if (!AUDIO_ROLES.has(track.role) || !/^v\d{3}$/.test(track.version_id)) throw new Error(`${track.asset_key} 音轨角色或版本无效`)
    for (const field of ['source_in_ms', 'source_out_ms', 'timeline_start_ms', 'timeline_end_ms']) if (!Number.isInteger(track[field]) || track[field] < 0) throw new Error(`${track.asset_key}.${field} 必须是非负整数`)
    if (track.source_out_ms <= track.source_in_ms || track.timeline_end_ms <= track.timeline_start_ms || track.timeline_end_ms > previousEnd) throw new Error(`${track.asset_key} 音轨时间范围无效`)
    const asset = assets.assets?.[track.asset_key]
    const version = asset?.versions?.find((item) => item.id === track.version_id)
    if (!['audio', 'video'].includes(asset?.type) || asset.selectedVersionId !== track.version_id || !version?.localPath) throw new Error(`${track.asset_key} 必须引用 selected 音频或原生声轨视频`)
    if (asset.type === 'audio' && !track.asset_key.startsWith(`audio-${timeline.episode_key.replace('-', '')}-`)) throw new Error(`${track.asset_key} 音频不属于 ${timeline.episode_key}`)
    if (asset.type === 'video' && version.provenance?.prompt_document?.episode_key !== timeline.episode_key) throw new Error(`${track.asset_key} 原生声轨不属于 ${timeline.episode_key}`)
    const envelope = track.volume_envelope || []
    if (!Array.isArray(envelope) || envelope.some((point) => !Number.isInteger(point?.time_ms) || point.time_ms < track.timeline_start_ms || point.time_ms > track.timeline_end_ms || typeof point.gain_db !== 'number')) throw new Error(`${track.asset_key}.volume_envelope 无效`)
    await existingInside(root, version.localPath)
  }
  for (const label of labels) if (!['character', 'scene', 'title', 'chapter', 'credit'].includes(label?.type) || typeof label.text !== 'string' || !label.text || !Number.isInteger(label.startMs) || !Number.isInteger(label.endMs) || label.startMs < 0 || label.endMs <= label.startMs || label.endMs > previousEnd) throw new Error('角标/标题时间或内容无效')
  for (const graphic of graphics) if (!['phone-call', 'countdown', 'message'].includes(graphic?.type) || typeof graphic.title !== 'string' || typeof graphic.text !== 'string' || !graphic.text.trim() || !Number.isInteger(graphic.startMs) || !Number.isInteger(graphic.endMs) || graphic.startMs < 0 || graphic.endMs <= graphic.startMs || graphic.endMs > previousEnd) throw new Error('剧情图形层时间或内容无效')
  if (audioTracks.length) {
    if (!timeline.mix || typeof timeline.mix.target_lufs !== 'number' || timeline.mix.target_lufs < -24 || timeline.mix.target_lufs > -8 || typeof timeline.mix.true_peak_dbtp !== 'number' || timeline.mix.true_peak_dbtp > -1) throw new Error('存在音轨时必须设置合理的 mix.target_lufs 与 true_peak_dbtp')
  }
  return { ...timeline, version: 1, segments, audio_tracks: audioTracks, labels, graphics, mix: timeline.mix || null }
}

async function fileRecord(root, value, area) {
  const path = await existingInside(root, value, area)
  const info = await stat(path)
  if (!info.isFile() || info.size === 0) throw new Error(`交付文件无效：${value}`)
  return { path: relative(await realpath(root), path), sizeBytes: info.size, sha256: await sha256(path) }
}

export async function validateManifest(root, manifest, episode) {
  if (!manifest || manifest.version !== 2 || typeof manifest.project !== 'string' || !/^ep-\d{3}$/.test(manifest.episode_key)) throw new Error('交付 manifest 合同无效')
  if (episode && manifest.episode_key !== episode) throw new Error('交付 manifest 与目标分集不一致')
  const project = JSON.parse(await readFile(resolve(root, '.short-drama', 'project.json'), 'utf8'))
  if (manifest.project !== project.key) throw new Error('交付 manifest 项目不一致')
  for (const kind of ['timeline', 'review']) {
    const input = manifest.inputs?.[kind]
    if (!input || typeof input.path !== 'string' || !Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0 || !/^[0-9a-f]{64}$/.test(input.sha256 || '')) throw new Error(`交付输入 ${kind} 记录无效`)
    const path = await existingInside(root, input.path, `editing/${manifest.episode_key}`)
    const info = await stat(path)
    if (!info.isFile() || info.size !== input.sizeBytes || await sha256(path) !== input.sha256) throw new Error(`交付输入 ${kind} 已变化`)
    const value = JSON.parse(await readFile(path, 'utf8'))
    if (kind === 'timeline') await validateTimeline(root, value)
    else if (!validateReview(value, manifest.episode_key).approved) throw new Error('交付审片未通过')
  }
  for (const kind of ['video', 'srt', 'ass']) {
    const file = manifest.files?.[kind]
    if (!file || typeof file.path !== 'string' || !Number.isInteger(file.sizeBytes) || file.sizeBytes <= 0 || !/^[0-9a-f]{64}$/.test(file.sha256 || '')) throw new Error(`交付 ${kind} 记录无效`)
    const path = await existingInside(root, file.path, `delivery/${manifest.episode_key}`)
    const info = await stat(path)
    if (!info.isFile() || info.size !== file.sizeBytes || await sha256(path) !== file.sha256) throw new Error(`交付 ${kind} 文件已变化`)
  }
  return manifest
}

async function main() {
  const [command, rootArg, ...args] = process.argv.slice(2)
  if (command === '--self-check') {
    validateReview({ episode_key: 'ep-001', watchedFull: true, narrative: 'passed', visual: 'passed', audio: 'passed', transitions: 'passed', captions: 'passed', technical: 'passed', observations: { narrative: '故事完整', visual: '画面清晰', audio: '对白清楚', transitions: '切点自然', captions: '字幕准确', technical: '参数合格' }, issues: [], approved: true })
    return console.log('ok')
  }
  if (!rootArg) throw new Error('必须提供项目目录')
  const root = resolve(rootArg)
  if (command === 'put-timeline') {
    const input = args[0]
    if (!input) throw new Error('用法：put-timeline <项目目录> <timeline JSON>')
    const timeline = await validateTimeline(root, JSON.parse(await readFile(resolve(input), 'utf8')))
    const target = timelinePath(root, timeline.episode_key)
    await invalidateFrom(root, 'editing')
    return withFileLock(target, async () => {
      await atomic(target, timeline)
      console.log(target)
    })
  }
  if (command === 'validate-timeline') {
    const input = args[0]
    if (!input) throw new Error('用法：validate-timeline <项目目录> <timeline JSON>')
    const timeline = await validateTimeline(root, JSON.parse(await readFile(resolve(input), 'utf8')))
    return console.log(JSON.stringify({ valid: true, segments: timeline.segments.length, durationMs: timeline.segments.at(-1).timeline_end_ms }))
  }
  if (command === 'put-review') {
    const [episode, input] = args
    if (!episode || !input) throw new Error('用法：put-review <项目目录> <episode key> <完整审片 JSON>')
    const review = validateReview(JSON.parse(await readFile(resolve(input), 'utf8')), episode)
    const target = episodePath(root, 'editing', episode, 'review.json')
    await invalidateFrom(root, 'editing')
    await atomic(target, { ...review, reviewedAt: new Date().toISOString() })
    return console.log(target)
  }
  if (command === 'manifest') {
    const [episode, video, srt, ass] = args
    if (!episode || !video || !srt || !ass) throw new Error('用法：manifest <项目目录> <episode key> <成片> <SRT> <ASS>')
    await invalidateFrom(root, 'delivery')
    const timeline = await validateTimeline(root, JSON.parse(await readFile(timelinePath(root, episode), 'utf8')))
    const reviewPath = episodePath(root, 'editing', episode, 'review.json')
    const review = validateReview(JSON.parse(await readFile(reviewPath, 'utf8')), episode)
    if (!review.approved) throw new Error('完整审片未通过，不得生成交付 manifest')
    const files = { video: await fileRecord(root, video, `delivery/${episode}`) }
    files.srt = await fileRecord(root, srt, `delivery/${episode}`)
    files.ass = await fileRecord(root, ass, `delivery/${episode}`)
    const inputs = {
      timeline: await fileRecord(root, timelinePath(root, episode), `editing/${episode}`),
      review: await fileRecord(root, reviewPath, `editing/${episode}`),
    }
    const manifest = { version: 2, project: JSON.parse(await readFile(resolve(root, '.short-drama', 'project.json'), 'utf8')).key, episode_key: timeline.episode_key, inputs, files, createdAt: new Date().toISOString() }
    const target = episodePath(root, 'delivery', episode, 'manifest.json')
    await atomic(target, manifest, true)
    return console.log(target)
  }
  throw new Error('用法：editing-store.mjs put-timeline|validate-timeline|put-review|manifest ...')
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.message); process.exitCode = 1 })
