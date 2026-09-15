import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, relative, resolve, sep } from 'node:path'
import { addAssetVersion, putAsset, selectedAssetVersion } from './asset-ledger.mjs'
import { operationCapability, validateMediaOperation } from './media-operation-contract.mjs'
import { probeMedia } from './media-tools.mjs'

const LOCAL_OPERATIONS = new Set(['trim', 'replace-audio', 'stabilize', 'denoise', 'color-match', 'mask-blur', 'frame-interpolate'])
const PARAMETER_KEYS = {
  trim: [],
  'replace-audio': ['replacement_gain'],
  stabilize: ['shakiness', 'smoothing'],
  denoise: ['luma'],
  'color-match': ['brightness', 'contrast', 'saturation', 'gamma'],
  'mask-blur': ['radius'],
  'frame-interpolate': ['fps'],
}

function number(value, fallback, minimum, maximum, label) {
  const output = value === undefined ? fallback : Number(value)
  if (!Number.isFinite(output) || output < minimum || output > maximum) throw new Error(`${label} 必须为 ${minimum}–${maximum}`)
  return output
}

function integer(value, fallback, minimum, maximum, label) {
  const output = number(value, fallback, minimum, maximum, label)
  if (!Number.isInteger(output)) throw new Error(`${label} 必须是整数`)
  return output
}

function validateParameters(operation, parameters) {
  const allowed = PARAMETER_KEYS[operation] || []
  const unknown = Object.keys(parameters).filter((key) => !allowed.includes(key))
  if (unknown.length) throw new Error(`${operation} 参数不受支持：${unknown.join('、')}`)
}

function runFfmpeg(args, capability = null) {
  const result = spawnSync('ffmpeg', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || String(result.status)
    if (capability && /No such filter|not found|Error initializing filter/i.test(detail)) throw new Error(`FFMPEG_FILTER_UNAVAILABLE: ${capability}`)
    throw new Error(`FFmpeg ${capability || '媒体操作'}执行失败：${detail}`)
  }
}

function ffmpegHasFilters(names) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8' })
  return !result.error && result.status === 0 && names.every((name) => new RegExp(`\\b${name}\\b`).test(result.stdout || ''))
}

async function nextVersion(root, key) {
  const ledger = JSON.parse(await readFile(resolve(root, '.short-drama/assets.json'), 'utf8'))
  const latest = Math.max(0, ...(ledger.assets?.[key]?.versions || []).map((item) => Number(item.id.slice(1)) || 0))
  return `v${String(latest + 1).padStart(3, '0')}`
}

export function operationOutputPath(rootArg, target, versionId, extension = '.mp4') {
  const root = resolve(rootArg)
  if (!/^shot-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(target) || !/^v\d{3}$/.test(versionId) || !['.mp4', '.webm'].includes(extension)) throw new Error('媒体操作输出身份无效')
  const output = resolve(root, 'assets', 'videos', target, `${versionId}${extension}`)
  const directory = resolve(root, 'assets', 'videos', target)
  if (!output.startsWith(`${directory}${sep}`)) throw new Error('媒体操作输出必须位于标准视频资产目录')
  return output
}

function ordinaryArgs(operation, context) {
  const { input, output, sourceProbe, range, parameters, audio, mask } = context
  const commonOutput = ['-map', '0:v:0', '-map', '0:a?', '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output]
  if (operation === 'trim') return ['-nostdin', '-loglevel', 'error', '-n', '-ss', String(range.start_ms / 1000), '-i', input, '-t', String((range.end_ms - range.start_ms) / 1000), ...commonOutput]
  if (operation === 'denoise') return ['-nostdin', '-loglevel', 'error', '-n', '-i', input, '-vf', `hqdn3d=${number(parameters.luma, 1.5, 0, 10, 'luma')}`, ...commonOutput]
  if (operation === 'frame-interpolate') return ['-nostdin', '-loglevel', 'error', '-n', '-i', input, '-vf', `minterpolate=fps=${integer(parameters.fps, 48, 1, 120, 'fps')}`, ...commonOutput]
  if (operation === 'color-match') {
    const values = [
      `brightness=${number(parameters.brightness, 0, -1, 1, 'brightness')}`,
      `contrast=${number(parameters.contrast, 1, 0, 2, 'contrast')}`,
      `saturation=${number(parameters.saturation, 1, 0, 3, 'saturation')}`,
      `gamma=${number(parameters.gamma, 1, 0.1, 10, 'gamma')}`,
    ]
    return ['-nostdin', '-loglevel', 'error', '-n', '-i', input, '-vf', `eq=${values.join(':')}`, ...commonOutput]
  }
  if (operation === 'replace-audio') {
    const start = range.start_ms / 1000
    const end = range.end_ms / 1000
    const duration = (range.end_ms - range.start_ms) / 1000
    const gain = number(parameters.replacement_gain, 1, 0, 4, 'replacement_gain')
    const filter = `[0:a]volume=0:enable='between(t,${start},${end})'[base];[1:a]atrim=0:${duration},asetpts=PTS-STARTPTS,volume=${gain},adelay=${range.start_ms}:all=1[replacement];[base][replacement]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]`
    return ['-nostdin', '-loglevel', 'error', '-n', '-i', input, '-i', audio, '-filter_complex', filter, '-map', '0:v:0', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-t', String(sourceProbe.duration_ms / 1000), '-movflags', '+faststart', output]
  }
  if (operation === 'mask-blur') {
    const radius = integer(parameters.radius, 12, 1, 64, 'radius')
    const start = range.start_ms / 1000
    const end = range.end_ms / 1000
    const filter = `[0:v]split=3[original][base][blur-source];[blur-source]boxblur=${radius}:${radius}[blurred];[1:v]scale=${sourceProbe.width}:${sourceProbe.height},format=gray[mask];[base][blurred][mask]maskedmerge[masked];[original][masked]blend=all_expr='if(between(T,${start},${end}),B,A)'[v]`
    return ['-nostdin', '-loglevel', 'error', '-n', '-i', input, '-loop', '1', '-i', mask, '-filter_complex', filter, '-map', '[v]', '-map', '0:a?', '-c:v', 'libx264', '-c:a', 'copy', '-pix_fmt', 'yuv420p', '-t', String(sourceProbe.duration_ms / 1000), '-movflags', '+faststart', output]
  }
  throw new Error(`本地媒体操作未实现：${operation}`)
}

async function executeStabilize(context) {
  if (!ffmpegHasFilters(['vidstabdetect', 'vidstabtransform'])) throw new Error('FFMPEG_FILTER_UNAVAILABLE: vidstabdetect,vidstabtransform')
  const directory = await mkdtemp(resolve(tmpdir(), 'short-drama-vidstab-'))
  const transforms = resolve(directory, 'transforms.trf')
  try {
    const shakiness = integer(context.parameters.shakiness, 5, 1, 10, 'shakiness')
    const smoothing = integer(context.parameters.smoothing, 10, 0, 100, 'smoothing')
    runFfmpeg(['-nostdin', '-loglevel', 'error', '-i', context.input, '-vf', `vidstabdetect=shakiness=${shakiness}:result=${transforms}`, '-f', 'null', '-'], 'vidstabdetect')
    runFfmpeg(['-nostdin', '-loglevel', 'error', '-n', '-i', context.input, '-vf', `vidstabtransform=input=${transforms}:smoothing=${smoothing}`, '-map', '0:v:0', '-map', '0:a?', '-c:v', 'libx264', '-c:a', 'copy', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', context.output], 'vidstabtransform')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

export async function executeLocalMediaOperation(rootArg, inputRequest) {
  const root = resolve(rootArg)
  const request = validateMediaOperation(inputRequest)
  if (operationCapability(request.operation) !== 'transform.local' || !LOCAL_OPERATIONS.has(request.operation)) throw new Error(`${request.operation} 不是可本地执行的媒体操作`)
  validateParameters(request.operation, request.parameters)

  const source = await selectedAssetVersion(root, request.source.asset_key)
  if (source.version.id !== request.source.version_id || source.asset.type !== 'video') throw new Error('媒体操作来源必须是当前 selected 视频版本')
  const sourceProbe = probeMedia(source.path)
  if (!sourceProbe.has_video || sourceProbe.duration_ms <= 0) throw new Error('媒体操作来源缺少有效视频流')
  if (request.range?.end_ms > sourceProbe.duration_ms) throw new Error('媒体操作时间范围超过来源时长')

  let audio = null
  if (request.audio) {
    audio = await selectedAssetVersion(root, request.audio.asset_key)
    if (audio.version.id !== request.audio.version_id || audio.asset.type !== 'audio') throw new Error('媒体操作音频必须是当前 selected 音频版本')
  }
  if (request.operation === 'replace-audio' && !sourceProbe.has_audio) throw new Error('replace-audio 当前要求来源视频已有可替换音轨')
  let mask = null
  if (request.mask) {
    mask = await selectedAssetVersion(root, request.mask.asset_key)
    if (mask.version.id !== request.mask.version_id || !['other', 'storyboard'].includes(mask.asset.type) || !['.png', '.jpg', '.jpeg', '.webp'].includes(extname(mask.path).toLowerCase())) throw new Error('遮罩必须是当前 selected 本地图像资产')
  }

  const target = request.target || source.asset.key
  const versionId = await nextVersion(root, target)
  const output = operationOutputPath(root, target, versionId, '.mp4')
  let registered = false
  try {
    const context = { input: source.path, output, sourceProbe, range: request.range, parameters: request.parameters, audio: audio?.path, mask: mask?.path }
    if (request.operation === 'stabilize') await executeStabilize(context)
    else runFfmpeg(ordinaryArgs(request.operation, context), request.operation)
    const outputProbe = probeMedia(output)
    if (!outputProbe.has_video) throw new Error('媒体操作输出缺少视频流')
    const expectedDuration = request.operation === 'trim' ? request.range.end_ms - request.range.start_ms : sourceProbe.duration_ms
    if (Math.abs(outputProbe.duration_ms - expectedDuration) > Math.max(100, 1000 / Math.max(1, sourceProbe.fps))) throw new Error('媒体操作输出时长偏移超出允许范围')
    if (sourceProbe.has_audio && request.operation !== 'trim' && !outputProbe.has_audio) throw new Error('媒体操作输出意外丢失音轨')

    await putAsset(root, { key: target, type: 'video', name: source.asset.name })
    const sourceAssets = [request.source, request.audio, request.mask].filter(Boolean).map((item) => ({ key: item.asset_key, version_id: item.version_id }))
    await addAssetVersion(root, target, {
      id: versionId,
      localPath: relative(root, output),
      provenance: {
        origin: 'transformed', created_by: 'codex', provider: null, model_or_workflow: `ffmpeg-${request.operation}`, task_id: null, prompt_document: null,
        source_assets: sourceAssets,
        parameters: { operation: request.operation, ...(request.range ? { range: request.range } : {}), ...(request.mask ? { mask: request.mask } : {}), parameters: request.parameters, source_sha256: source.version.sha256 },
      },
    })
    registered = true
    return { output_path: output, output_version_id: versionId, probe: outputProbe }
  } catch (error) {
    if (!registered) await rm(output, { force: true })
    throw error
  }
}
