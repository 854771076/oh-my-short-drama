#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { access, lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { assertSafeOutputPath, confinedExistingFile, fileSha256 } from './safe-files.mjs'

async function exists(path) { try { await access(path); return true } catch { return false } }

function run(command, args, capture = true) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} 执行失败：${(result.stderr || result.stdout || result.status).trim()}`)
  return result
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
  await rename(temporary, path)
}

function fps(value) {
  const [numerator, denominator = '1'] = String(value || '0/1').split('/').map(Number)
  return denominator ? numerator / denominator : 0
}

export async function probeReferenceVideo(value) {
  const input = resolve(value)
  if (!(await stat(input)).isFile()) throw new Error('参考视频路径不是文件')
  const result = run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', input])
  let probe
  try { probe = JSON.parse(result.stdout) } catch { throw new Error('ffprobe 返回了无效 JSON') }
  const video = probe.streams?.find((stream) => stream.codec_type === 'video')
  if (!video) throw new Error('参考文件不包含视频流')
  const duration = Number(video.duration || probe.format?.duration || 0)
  const frameRate = fps(video.avg_frame_rate || video.r_frame_rate)
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(frameRate) || frameRate <= 0) throw new Error('参考视频时长或帧率无效')
  return {
    duration_ms: Math.round(duration * 1000),
    width: video.width,
    height: video.height,
    fps: Number(frameRate.toFixed(6)),
    video_codec: video.codec_name || null,
    has_audio: Boolean(probe.streams?.some((stream) => stream.codec_type === 'audio')),
    audio_codec: probe.streams?.find((stream) => stream.codec_type === 'audio')?.codec_name || null,
  }
}

function sceneCuts(input, threshold, durationMs, maxShots) {
  const filter = `select=gt(scene\\,${threshold}),showinfo`
  const result = run('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'info', '-i', input, '-vf', filter, '-an', '-f', 'null', '-'])
  const cuts = [...result.stderr.matchAll(/pts_time:([0-9.]+)/g)]
    .map((match) => Math.round(Number(match[1]) * 1000))
    .filter((value) => value > 0 && value < durationMs)
  return [...new Set(cuts)].sort((a, b) => a - b).slice(0, Math.max(0, maxShots - 1))
}

function shotWindows(cuts, durationMs) {
  const boundaries = [0, ...cuts, durationMs]
  return boundaries.slice(0, -1).map((start, index) => ({
    shot_number: index + 1,
    start_ms: start,
    end_ms: boundaries[index + 1],
  })).filter((shot) => shot.end_ms > shot.start_ms)
}

function intervalFallbackCuts(cuts, durationMs, maxSegmentDurationMs, maxShots) {
  const boundaries = [0, ...cuts, durationMs]
  const expanded = [...cuts]
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index]
    const end = boundaries[index + 1]
    for (let cursor = start + maxSegmentDurationMs; cursor < end; cursor += maxSegmentDurationMs) expanded.push(cursor)
  }
  return [...new Set(expanded)].sort((a, b) => a - b).slice(0, Math.max(0, maxShots - 1))
}

async function confinedFile(root, localPath) {
  return confinedExistingFile(root, localPath, '参考视频')
}

async function assertSafeOutputTree(root, target) {
  const absoluteRoot = resolve(root)
  const absoluteTarget = resolve(target)
  const local = relative(absoluteRoot, absoluteTarget)
  if (!local || local === '..' || local.startsWith(`..${sep}`)) throw new Error('参考视频输出路径逃逸项目目录')
  const rootReal = await realpath(absoluteRoot)
  let cursor = absoluteRoot
  for (const part of local.split(sep)) {
    cursor = resolve(cursor, part)
    try {
      const info = await lstat(cursor)
      // ffmpeg 使用 -y 写入；任何既有符号链接都会把覆盖副作用引到项目外，必须在启动子进程前拒绝。
      if (info.isSymbolicLink()) throw new Error(`参考视频输出目录不得包含符号链接：${relative(absoluteRoot, cursor)}`)
      const actual = await realpath(cursor)
      if (actual !== rootReal && !actual.startsWith(`${rootReal}${sep}`)) throw new Error('参考视频输出路径逃逸项目目录')
    } catch (error) {
      if (error?.code === 'ENOENT') break
      throw error
    }
  }
}

export async function validatePreparedReferenceVideo(rootValue, value) {
  const root = resolve(rootValue)
  if (!value || value.schema_version !== 1 || !Number.isFinite(Date.parse(value.prepared_at)) || !value.source_ref || !value.technical || !value.detection || !Array.isArray(value.shots) || !Array.isArray(value.limitations) || !Array.isArray(value.failures)) throw new Error('参考视频准备清单合同无效')
  if (!/^src-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.source_ref.key || '') || !/^v\d{3}$/.test(value.source_ref.version_id || '') || !/^[0-9a-f]{64}$/.test(value.source_ref.sha256 || '')) throw new Error('准备清单 source_ref 无效')
  if (!Number.isInteger(value.technical.duration_ms) || value.technical.duration_ms <= 0 || !Number.isInteger(value.technical.width) || value.technical.width <= 0 || !Number.isInteger(value.technical.height) || value.technical.height <= 0 || typeof value.technical.fps !== 'number' || value.technical.fps <= 0 || typeof value.technical.has_audio !== 'boolean') throw new Error('准备清单 technical 无效')
  if (!value.shots.length || value.shots.length > 200) throw new Error('准备清单 shots 数量无效')
  let cursor = 0
  for (const [index, shot] of value.shots.entries()) {
    if (shot.shot_number !== index + 1 || shot.start_ms !== cursor || !Number.isInteger(shot.end_ms) || shot.end_ms <= shot.start_ms || !shot.keyframe || !Number.isInteger(shot.keyframe.at_ms) || shot.keyframe.at_ms < shot.start_ms || shot.keyframe.at_ms >= shot.end_ms || !/^[0-9a-f]{64}$/.test(shot.keyframe.sha256 || '') || !shot.keyframe.local_path?.startsWith('.short-drama/reference-video/')) throw new Error(`准备清单第 ${index + 1} 镜无效`)
    const keyframe = await confinedFile(root, shot.keyframe.local_path)
    if (await fileSha256(keyframe) !== shot.keyframe.sha256) throw new Error(`第 ${index + 1} 镜关键帧 SHA-256 不一致`)
    cursor = shot.end_ms
  }
  if (cursor !== value.technical.duration_ms) throw new Error('准备清单镜头未连续覆盖完整时长')
  if (value.technical.has_audio !== Boolean(value.audio)) throw new Error('准备清单音轨状态不一致')
  if (value.audio) {
    if (!value.audio.local_path?.startsWith('.short-drama/reference-video/') || !/^[0-9a-f]{64}$/.test(value.audio.sha256 || '')) throw new Error('准备清单音轨引用无效')
    const audio = await confinedFile(root, value.audio.local_path)
    if (await fileSha256(audio) !== value.audio.sha256) throw new Error('准备清单音轨 SHA-256 不一致')
  }
  return value
}

export async function prepareReferenceVideo(rootValue, options = {}) {
  const root = resolve(rootValue)
  const sourceKey = options.sourceKey
  const versionId = options.versionId
  const sceneThreshold = Number(options.sceneThreshold ?? 0.32)
  const maxShots = Number(options.maxShots ?? 200)
  const maxSegmentDurationMs = Number(options.maxShotDurationMs ?? 10000)
  if (!/^src-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(sourceKey || '') || !/^v\d{3}$/.test(versionId || '')) throw new Error('sourceKey 或 versionId 无效')
  if (!Number.isFinite(sceneThreshold) || sceneThreshold <= 0 || sceneThreshold >= 1) throw new Error('sceneThreshold 必须大于 0 且小于 1')
  if (!Number.isInteger(maxShots) || maxShots < 1 || maxShots > 200) throw new Error('maxShots 必须为 1–200')
  if (!Number.isInteger(maxSegmentDurationMs) || maxSegmentDurationMs < 250 || maxSegmentDurationMs > 60000) throw new Error('maxShotDurationMs 必须为 250–60000 毫秒')
  const manifest = JSON.parse(await readFile(resolve(root, 'source/manifest.json'), 'utf8'))
  const source = manifest.sources?.[sourceKey]
  if (!source || (source.kind || 'document') !== 'reference-video') throw new Error('来源必须为 reference-video')
  if (source.selectedVersionId !== versionId) throw new Error('参考视频必须是当前 selected 版本')
  const version = source.versions?.find((item) => item.id === versionId)
  if (!version) throw new Error('参考视频版本不存在')
  const input = await confinedFile(root, version.localPath)
  if (await fileSha256(input) !== version.sha256) throw new Error('参考视频 SHA-256 与来源账本不一致')
  if ((await stat(input)).size > 2 * 1024 * 1024 * 1024) throw new Error('参考视频不得超过 2 GiB')

  const technical = await probeReferenceVideo(input)
  const failures = []
  let sceneCandidates = []
  try {
    sceneCandidates = sceneCuts(input, sceneThreshold, technical.duration_ms, maxShots)
  } catch (error) {
    failures.push({ stage: 'scene-detection', message: error.message })
  }
  // scene score 对长时间无切镜素材没有覆盖能力，用固定最大跨度补足关键帧观察点。
  const cuts = intervalFallbackCuts(sceneCandidates, technical.duration_ms, maxSegmentDurationMs, maxShots)
  const shots = shotWindows(cuts, technical.duration_ms)
  const outputRoot = resolve(root, '.short-drama/reference-video', sourceKey, versionId)
  const outputParent = dirname(outputRoot)
  const transactionId = randomUUID()
  const stagingRoot = resolve(outputParent, `.staging-${versionId}-${transactionId}`)
  const backupRoot = resolve(outputParent, `.backup-${versionId}-${transactionId}`)
  const finalFrameRoot = resolve(outputRoot, 'frames')
  await assertSafeOutputTree(root, finalFrameRoot)
  for (const shot of shots) await assertSafeOutputPath(root, resolve(finalFrameRoot, `shot-${String(shot.shot_number).padStart(3, '0')}.png`), '参考视频关键帧输出')
  if (technical.has_audio) await assertSafeOutputPath(root, resolve(outputRoot, 'audio.wav'), '参考视频音轨输出')
  await assertSafeOutputPath(root, stagingRoot, '参考视频暂存输出')
  await mkdir(resolve(stagingRoot, 'frames'), { recursive: true })

  let movedPrevious = false
  let published = false
  try {
    for (const shot of shots) {
      const positionMs = Math.min(shot.end_ms - 1, shot.start_ms + Math.max(1, Math.floor((shot.end_ms - shot.start_ms) / 2)))
      const filename = `shot-${String(shot.shot_number).padStart(3, '0')}.png`
      const file = resolve(stagingRoot, 'frames', filename)
      run('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-ss', String(positionMs / 1000), '-i', input, '-frames:v', '1', '-update', '1', file])
      shot.keyframe = {
        at_ms: positionMs,
        local_path: `.short-drama/reference-video/${sourceKey}/${versionId}/frames/${filename}`,
        sha256: await fileSha256(file),
      }
    }
    let audio = null
    if (technical.has_audio) {
      const audioPath = resolve(stagingRoot, 'audio.wav')
      run('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', audioPath])
      audio = { local_path: `.short-drama/reference-video/${sourceKey}/${versionId}/audio.wav`, sha256: await fileSha256(audioPath) }
    }
    const prepared = {
      schema_version: 1,
      prepared_at: new Date().toISOString(),
      source_ref: { key: sourceKey, version_id: versionId, local_path: version.localPath, sha256: version.sha256 },
      technical,
      detection: { scene_threshold: sceneThreshold, max_shots: maxShots, max_segment_duration_ms: maxSegmentDurationMs, detected_cut_count: sceneCandidates.length, fallback_cut_count: cuts.length - sceneCandidates.length },
      shots,
      audio,
      failures,
      limitations: ['镜头切点来自 ffmpeg scene score，语义边界仍需 Codex 结合关键帧和音频核对。'],
    }

    await mkdir(outputParent, { recursive: true })
    if (await exists(outputRoot)) { await rename(outputRoot, backupRoot); movedPrevious = true }
    await rename(stagingRoot, outputRoot)
    published = true
    await validatePreparedReferenceVideo(root, prepared)
    await writeJson(resolve(root, '.short-drama/reference-video/prepared.json'), prepared)
    // 清理旧备份发生故障时，新媒体与清单已经共同提交；此时回滚反而会让清单指向错误版本。
    if (movedPrevious) await rm(backupRoot, { recursive: true }).catch(() => {})
    return prepared
  } catch (error) {
    if (published && await exists(outputRoot)) await rm(outputRoot, { recursive: true })
    if (movedPrevious && await exists(backupRoot)) await rename(backupRoot, outputRoot)
    throw error
  } finally {
    if (await exists(stagingRoot)) await rm(stagingRoot, { recursive: true })
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2)
  if (command === '--self-check') {
    if (fps('30000/1001').toFixed(3) !== '29.970' || shotWindows([1000], 2000).length !== 2) throw new Error('自检失败')
    return console.log('ok')
  }
  if (command === 'probe') return console.log(JSON.stringify(await probeReferenceVideo(args[0]), null, 2))
  if (command === 'prepare') {
    const [root, sourceKey, versionId] = args
    if (!root || !sourceKey || !versionId) throw new Error('用法：prepare <项目目录> <source key> <version>')
    return console.log(JSON.stringify(await prepareReferenceVideo(root, { sourceKey, versionId }), null, 2))
  }
  throw new Error('用法：reference-video.mjs probe <视频>|prepare <项目目录> <source key> <version>|--self-check')
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.message); process.exitCode = 1 })
