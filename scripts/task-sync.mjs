import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { generationProvenance, getTask, updateTaskStatus } from './task-ledger.mjs'
import { detectMedia } from './grid-detect.mjs'
import { probeMedia } from './media-tools.mjs'

const execute = promisify(execFile)
const assetLedger = fileURLToPath(new URL('./asset-ledger.mjs', import.meta.url))

function assetType(task) {
  if (task.type === 'video') return 'video'
  if (task.type === 'audio') return 'audio'
  return task.target.startsWith('char-') ? 'character' : task.target.startsWith('scene-') ? 'scene' : task.target.startsWith('prop-') ? 'prop' : task.target.startsWith('board-') ? 'storyboard' : 'other'
}

function nextVersion(asset, offset = 0) {
  const latest = Math.max(0, ...(asset?.versions || []).map((item) => Number(item.id.slice(1)) || 0))
  return `v${String(latest + offset + 1).padStart(3, '0')}`
}

async function run(...args) { return (await execute(process.execPath, [assetLedger, ...args], { maxBuffer: 4 * 1024 * 1024 })).stdout.trim() }

function isSeedVr25(request) {
  return request.tool === 'submit_media_operation' && request.modelOrWorkflow === 'seedvr2.5-video-upscale' && request.arguments?.operation === 'video-upscale'
}

function isWindowedRunningHubLipSync(request) {
  return request.tool === 'submit_media_operation'
    && request.provider === 'runninghub'
    && request.arguments?.operation === 'lip-sync'
    && request.arguments?.parameters?.provider_video_preparation?.mode === 'painterav2v-window-and-tail-frame-pad'
}

async function videoFrameCount(path) {
  const { stdout } = await execute('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=nb_read_frames,nb_frames', '-of', 'json', path], { maxBuffer: 4 * 1024 * 1024 })
  const stream = JSON.parse(stdout || '{}').streams?.[0]
  const count = Number(stream?.nb_read_frames || stream?.nb_frames)
  if (!Number.isInteger(count) || count <= 0) throw new Error('对口型视频缺少可靠帧数')
  return count
}

function validateSeedVr25Output(source, output) {
  if (!source.has_video || !output.has_video) throw new Error('SeedVR2.5 输入和输出必须包含视频流')
  const durationTolerance = Math.max(100, Math.ceil(1500 / Math.max(source.fps, 1)))
  if (Math.abs(source.duration_ms - output.duration_ms) > durationTolerance) throw new Error(`SeedVR2.5 输出时长漂移：${source.duration_ms}ms -> ${output.duration_ms}ms`)
  if (!source.fps || !output.fps || Math.abs(source.fps - output.fps) > 0.01) throw new Error(`SeedVR2.5 输出帧率漂移：${source.fps} -> ${output.fps}`)
}

async function normalizeSeedVr25Output(root, task, request, registered, versionId, temporary) {
  const sourceRef = request.arguments.source
  const ledger = JSON.parse(await readFile(resolve(root, '.short-drama/assets.json'), 'utf8'))
  const sourceVersion = ledger.assets?.[sourceRef.asset_key]?.versions?.find((item) => item.id === sourceRef.version_id)
  if (!sourceVersion || sourceVersion.sha256 !== request.arguments.source_sha256) throw new Error('SeedVR2.5 源视频版本或 SHA-256 已变化')
  const sourcePath = resolve(root, sourceVersion.localPath)
  const providerPath = resolve(root, registered.localPath)
  const sourceProbe = probeMedia(sourcePath)
  const providerProbe = probeMedia(providerPath)
  validateSeedVr25Output(sourceProbe, providerProbe)
  const output = resolve(root, '.short-drama', 'provider-output', `${task.taskId}-${versionId}-final.mp4`)
  await mkdir(resolve(root, '.short-drama', 'provider-output'), { recursive: true })
  const remuxAudio = sourceProbe.has_audio && !providerProbe.has_audio
  const inputs = remuxAudio ? ['-i', providerPath, '-i', sourcePath] : ['-i', providerPath]
  const maps = remuxAudio ? ['-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-shortest'] : ['-map', '0:v:0', '-map', '0:a?', '-c', 'copy']
  try { await execute('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', ...inputs, ...maps, output], { maxBuffer: 4 * 1024 * 1024 }) }
  catch (error) { throw new Error(`SeedVR2.5 输出封装失败：${String(error.stderr || error.message).slice(0, 500)}`) }
  const finalProbe = probeMedia(output)
  validateSeedVr25Output(sourceProbe, finalProbe)
  if (sourceProbe.has_audio && !finalProbe.has_audio) throw new Error('SeedVR2.5 最终输出未保留源音轨')
  const provenanceValue = generationProvenance(task, request)
  provenanceValue.parameters.output_processing = {
    provider_output: { asset_key: task.target, version_id: registered.id, sha256: registered.sha256 },
    ...(remuxAudio ? { audio_remux_source: { asset_key: sourceRef.asset_key, version_id: sourceRef.version_id, sha256: sourceVersion.sha256 } } : {}),
    method: remuxAudio ? 'ffmpeg-video-copy-source-audio-aac' : 'ffmpeg-stream-copy',
  }
  const provenance = resolve(temporary, `provenance-${versionId}-final.json`)
  await writeFile(provenance, `${JSON.stringify(provenanceValue, null, 2)}\n`)
  const finalVersionId = nextVersion(ledger.assets[task.target])
  try { return JSON.parse(await run('import', root, task.target, output, finalVersionId, '-', provenance)) }
  finally { await rm(output, { force: true }) }
}

async function normalizeWindowedRunningHubLipSyncOutput(root, task, request, registered, temporary) {
  const sourceRef = request.arguments.source
  const preparation = request.arguments.parameters.provider_video_preparation
  const ledger = JSON.parse(await readFile(resolve(root, '.short-drama/assets.json'), 'utf8'))
  const sourceVersion = ledger.assets?.[sourceRef.asset_key]?.versions?.find((item) => item.id === sourceRef.version_id)
  if (!sourceVersion || sourceVersion.sha256 !== request.arguments.source_sha256) throw new Error('RunningHub 对口型源视频版本或 SHA-256 已变化')
  const sourcePath = resolve(root, sourceVersion.localPath)
  const providerPath = resolve(root, registered.localPath)
  const sourceProbe = probeMedia(sourcePath)
  const providerProbe = probeMedia(providerPath)
  const expectedFrames = preparation.expected_output_frame_count
  const providerFrames = await videoFrameCount(providerPath)
  if (!sourceProbe.has_video || !providerProbe.has_video || !Number.isInteger(expectedFrames) || providerFrames < expectedFrames) throw new Error(`RunningHub 对口型窗口输出帧数不足：${providerFrames}/${expectedFrames}`)
  if (sourceProbe.width !== providerProbe.width || sourceProbe.height !== providerProbe.height || Math.abs(sourceProbe.fps - providerProbe.fps) > 0.01) throw new Error('RunningHub 对口型窗口输出的分辨率或帧率与来源不一致')
  const start = preparation.window_start_frame
  const end = preparation.window_end_frame
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end - start !== expectedFrames || end > preparation.source_frame_count || await videoFrameCount(sourcePath) !== preparation.source_frame_count) throw new Error('RunningHub 对口型窗口回写范围无效或来源帧数已变化')
  const labels = []
  const filters = []
  if (start > 0) { filters.push(`[0:v]trim=start_frame=0:end_frame=${start},setpts=PTS-STARTPTS[pre]`); labels.push('[pre]') }
  filters.push(`[1:v]trim=start_frame=0:end_frame=${expectedFrames},setpts=PTS-STARTPTS[mid]`); labels.push('[mid]')
  if (end < preparation.source_frame_count) { filters.push(`[0:v]trim=start_frame=${end}:end_frame=${preparation.source_frame_count},setpts=PTS-STARTPTS[post]`); labels.push('[post]') }
  filters.push(`${labels.join('')}concat=n=${labels.length}:v=1:a=0[v]`)
  const output = resolve(root, '.short-drama', 'provider-output', `${task.taskId}-lip-sync-final.mp4`)
  await mkdir(resolve(root, '.short-drama', 'provider-output'), { recursive: true })
  try {
    await execute('ffmpeg', [
      '-nostdin', '-loglevel', 'error', '-y', '-i', sourcePath, '-i', providerPath,
      '-filter_complex', filters.join(';'), '-map', '[v]', '-map', '0:a?', '-frames:v', String(preparation.source_frame_count),
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '12', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', output,
    ], { maxBuffer: 4 * 1024 * 1024 })
  } catch (error) { throw new Error(`RunningHub 对口型窗口拼回失败：${String(error.stderr || error.message).slice(0, 500)}`) }
  const finalProbe = probeMedia(output)
  const finalFrames = await videoFrameCount(output)
  if (finalFrames !== preparation.source_frame_count || Math.abs(finalProbe.duration_ms - sourceProbe.duration_ms) > Math.ceil(1000 / sourceProbe.fps) || sourceProbe.has_audio !== finalProbe.has_audio) throw new Error('RunningHub 对口型拼回后时长、帧数或音轨未保持')
  const provenanceValue = generationProvenance(task, request)
  provenanceValue.parameters.output_processing = {
    provider_output: { asset_key: task.target, version_id: registered.id, sha256: registered.sha256 },
    source_video: { asset_key: sourceRef.asset_key, version_id: sourceRef.version_id, sha256: sourceVersion.sha256 },
    method: 'ffmpeg-frame-window-splice-source-audio',
    window_start_frame: start,
    window_end_frame: end,
    expected_output_frame_count: expectedFrames,
  }
  const provenance = resolve(temporary, `provenance-${registered.id}-lip-sync-final.json`)
  await writeFile(provenance, `${JSON.stringify(provenanceValue, null, 2)}\n`)
  const finalVersionId = nextVersion(ledger.assets[task.target])
  try { return JSON.parse(await run('import', root, task.target, output, finalVersionId, '-', provenance)) }
  finally { await rm(output, { force: true }) }
}

export async function syncTaskResult(rootArg, taskId, result) {
  const root = resolve(rootArg)
  const task = await getTask(root, taskId)
  if (result.status === 'pending') return { ...result, local_task: await updateTaskStatus(root, taskId, 'running') }
  if (result.status === 'failed') return { ...result, local_task: await updateTaskStatus(root, taskId, 'failed') }
  if (result.status !== 'completed' || !result.outputs?.length) throw new Error('远端任务已完成但没有可回写输出')
  if (task.status === 'completed' && task.outputVersionId) return { ...result, local_task: task, output_version_ids: [task.outputVersionId] }

  const request = JSON.parse(await readFile(resolve(root, task.requestPath), 'utf8'))
  let ledger = JSON.parse(await readFile(resolve(root, '.short-drama/assets.json'), 'utf8'))
  const temporary = await mkdtemp(resolve(tmpdir(), 'short-drama-sync-'))
  try {
    if (!ledger.assets?.[task.target]) {
      const record = resolve(temporary, 'asset.json')
      await writeFile(record, `${JSON.stringify({ key: task.target, type: assetType(task), name: task.target }, null, 2)}\n`)
      await run('put', root, record)
      ledger = JSON.parse(await readFile(resolve(root, '.short-drama/assets.json'), 'utf8'))
    }
    const versions = (ledger.assets[task.target].versions || []).filter((item) => item.provenance?.task_id === taskId).map((item) => item.id)
    const existingCount = versions.length
    const quality = []
    for (const [index, output] of result.outputs.entries()) {
      if (versions[index]) continue
      if (output.media_type && output.media_type !== task.type) throw new Error(`输出类型与任务不一致：${output.media_type}/${task.type}`)
      const versionId = nextVersion(ledger.assets[task.target], index - existingCount)
      const provenance = resolve(temporary, `provenance-${index}.json`)
      const seedVr25 = isSeedVr25(request)
      const windowedLipSync = isWindowedRunningHubLipSync(request)
      const provenanceTask = seedVr25 || windowedLipSync ? { ...task, taskId: `${task.taskId}:provider-output` } : task
      await writeFile(provenance, `${JSON.stringify(generationProvenance(provenanceTask, request), null, 2)}\n`)
      let registered
      if (output.url) registered = JSON.parse(await run('fetch', root, task.target, output.url, versionId, '-', provenance))
      else if (output.b64_json) {
        const encoded = resolve(temporary, `output-${index}.txt`)
        await writeFile(encoded, output.b64_json)
        registered = JSON.parse(await run('decode', root, task.target, encoded, versionId, '-', provenance))
      } else if (output.path) {
        const [rootReal, outputReal] = await Promise.all([realpath(root), realpath(resolve(output.path))])
        if (outputReal !== rootReal && !outputReal.startsWith(`${rootReal}${sep}`)) throw new Error('本地 Provider 输出必须位于项目目录内')
        registered = JSON.parse(await run('import', root, task.target, outputReal, versionId, '-', provenance))
        const temporaryRoot = resolve(rootReal, '.short-drama', 'provider-output')
        if (outputReal.startsWith(`${temporaryRoot}${sep}`)) await rm(outputReal, { force: true })
      } else throw new Error(`第 ${index + 1} 个输出无 URL、base64 或受控本地路径`)
      if (seedVr25) {
        registered = await normalizeSeedVr25Output(root, task, request, registered, versionId, temporary)
        ledger = JSON.parse(await readFile(resolve(root, '.short-drama/assets.json'), 'utf8'))
      } else if (windowedLipSync) {
        registered = await normalizeWindowedRunningHubLipSyncOutput(root, task, request, registered, temporary)
        ledger = JSON.parse(await readFile(resolve(root, '.short-drama/assets.json'), 'utf8'))
      }
      // 成片宫格自动检测：只打标，不自动重生（门框/地平线可能误报，交给人工复核）
      if (task.type === 'video') {
        let flags = []
        let report = null
        try { report = detectMedia(resolve(root, registered.localPath)); if (report.detected) flags = [report.confidence === 'high' ? 'grid_high_confidence' : 'grid_suspect'] }
        catch { flags = ['grid_check_failed'] }
        quality.push({ version_id: registered.id, flags, ...(report ? { grid_report: report } : {}) })
        if (flags.length) {
          const flagFile = resolve(temporary, `flags-${index}.json`)
          await writeFile(flagFile, JSON.stringify(flags))
          await run('flag-version', root, task.target, registered.id, flagFile)
        }
      }
      versions.push(registered.id)
    }
    return { ...result, output_version_ids: versions, output_quality: quality, local_task: await updateTaskStatus(root, taskId, 'completed', versions[0]) }
  } finally { await rm(temporary, { recursive: true, force: true }) }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== '--self-check') throw new Error('仅支持 --self-check')
  if (assetType({ type: 'image', target: 'board-ep001-001' }) !== 'storyboard' || nextVersion({ versions: [{ id: 'v002' }] }) !== 'v003') throw new Error('任务回写自检失败')
  const operation = generationProvenance({ taskId: 'task-operation', provider: 'runninghub' }, { tool: 'submit_media_operation', modelOrWorkflow: 'workflow-upscale', promptDocument: null, arguments: { operation: 'video-upscale', source: { asset_key: 'shot-ep001-001', version_id: 'v001' }, parameters: {}, source_sha256: 'a'.repeat(64) } })
  if (operation.origin !== 'transformed' || operation.source_assets[0]?.key !== 'shot-ep001-001') throw new Error('媒体操作回写来源自检失败')
  console.log('ok')
}
