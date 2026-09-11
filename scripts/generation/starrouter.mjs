import { readFile, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, extname } from 'node:path'
import { credential } from './credentials.mjs'

const API_BASE = (process.env.STARROUTER_BASE_URL || 'https://starrouter.io/v1').replace(/\/$/, '')
const ROOT_BASE = API_BASE.replace(/\/v1$/, '')
function configuredModels(name, defaults) {
  const values = process.env[name]?.split(',').map((value) => value.trim()).filter(Boolean)
  return [...new Set(values?.length ? values : defaults)]
}

const IMAGE_MODELS = configuredModels('STARROUTER_IMAGE_MODELS', ['gpt-image-2'])
const AUDIO_MODELS = configuredModels('STARROUTER_AUDIO_MODELS', ['speech-2.8-hd', 'speech-2.8-turbo', 'qwen3-tts-vc-realtime-2025-11-27', 'qwen3-tts-vc-realtime', 'pawsense-audio', 'tts-1'])
const ASR_MODELS = configuredModels('STARROUTER_ASR_MODELS', ['qwen3-asr-flash', 'whisper-1'])
const MUSIC_MODELS = configuredModels('STARROUTER_MUSIC_MODELS', ['suno_music'])
const VIDEO_MODELS = configuredModels('STARROUTER_VIDEO_MODELS', [
  'MiniMax-H3',
  'MiniMax-H3-Max',
  'dreamina-seedance-2-0-fast-260128',
  'dreamina-seedance-2-0-260128',
  'doubao-seedance-2-0-260128',
  'doubao-seedance-2-0-fast-260128',
  'doubao-seedance-1-5-pro-251215',
  'doubao-seedance-1-0-pro-250528',
  'doubao-seedance-1-0-pro-fast-251015',
])
const IMAGE_RESOLUTION_EDGE = new Map([['1K', 1024], ['2K', 2048], ['4K', 3840]])
const IMAGE_ASPECT_RATIOS = new Set(['1:1', '16:9', '9:16', '4:3', '3:4'])
const IMAGE_QUALITIES = new Set(['auto', 'low', 'medium', 'high'])
const IMAGE_BACKGROUNDS = new Set(['auto', 'opaque', 'transparent'])
const IMAGE_MODERATIONS = new Set(['auto', 'low'])
const IMAGE_OUTPUT_FORMATS = new Set(['png', 'jpeg', 'webp'])
const IMAGE_MIN_PIXELS = 1_048_576
const IMAGE_MAX_PIXELS = 8_294_400
const MAX_REFERENCE_IMAGE_BYTES = 4 * 1024 * 1024
const MULTIMODAL_VIDEO_MODELS = new Set(configuredModels('STARROUTER_MULTIMODAL_VIDEO_MODELS', ['dreamina-seedance-2-0-260128', 'dreamina-seedance-2-0-fast-260128']))
const SEEDANCE2_MODELS = new Set(VIDEO_MODELS.filter((model) => /seedance-2-0/.test(model)))
const H3_MODELS = new Set(VIDEO_MODELS.filter((model) => /^MiniMax-H3(?:-Max)?$/.test(model)))
const IMAGE_MIME_TYPES = { '.gif': 'image/gif', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }
const AUDIO_FORMATS = new Set(['mp3', 'pcm', 'flac'])
const AUDIO_MIME_TYPES = { mp3: 'audio/mpeg', pcm: 'audio/L16', flac: 'audio/flac' }
const ASR_FORMATS = new Set(['json', 'text', 'srt', 'verbose_json', 'vtt'])
const ASR_EXTENSIONS = new Set(['.flac', '.m4a', '.mp3', '.mp4', '.mpeg', '.mpga', '.ogg', '.wav', '.webm'])
const MAX_ASR_BYTES = Number(process.env.SHORT_DRAMA_MAX_ASR_BYTES || 64 * 1024 * 1024)
const AUDIO_METADATA_FIELDS = new Set(['voice_setting', 'audio_setting', 'pronunciation_dict', 'timbre_weights', 'language_boost', 'voice_modify', 'subtitle_enable', 'aigc_watermark', 'output_format', 'stream', 'stream_options'])
const AUDIO_SAMPLE_RATES = new Set([8000, 16000, 22050, 24000, 32000, 44100])
const AUDIO_BITRATES = new Set([32000, 64000, 128000, 256000])
const VIDEO_RESOLUTIONS = new Set(['480p', '720p', '1080p'])
const VIDEO_RATIOS = new Set(['16:9', '9:16', '1:1', '4:3', '3:4'])
const H3_RATIOS = new Set(['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'])
const H3_METADATA_FIELDS = new Set(['model', 'content', 'resolution', 'duration', 'ratio', 'callback_url'])
const H3_CONTENT_ROLES = new Set(['first_frame', 'last_frame', 'reference_image', 'reference_video', 'reference_audio'])

function key() {
  const value = credential('STARROUTER_API_KEY')
  if (!value) throw new Error('STARROUTER_API_KEY 未配置')
  return value
}

function confirm(input) {
  if (input.confirmed !== true) throw new Error('付费生成前必须取得用户确认，并传 confirmed=true')
}

async function json(response) {
  const raw = await response.text()
  let data = {}
  try { data = raw ? JSON.parse(raw) : {} } catch { throw new Error('STARROUTER_RESPONSE_INVALID_JSON') }
  if (!response.ok) {
    const detail = data?.error?.message || data?.message || data?.error?.code || data?.code || raw
    throw new Error(`STARROUTER_REQUEST_FAILED(${response.status}): ${String(detail).slice(0, 500)}`)
  }
  return data
}

async function request(path, init = {}) {
  return json(await fetch(`${ROOT_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key()}`, ...(init.headers || {}) },
    signal: AbortSignal.timeout(init.timeout ?? 300_000),
  }))
}

async function binaryRequest(path, init = {}) {
  const response = await fetch(`${ROOT_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key()}`, ...(init.headers || {}) },
    signal: AbortSignal.timeout(init.timeout ?? 300_000),
  })
  if (!response.ok) await json(response)
  return response
}

async function asrRequest(path, form, responseFormat) {
  const response = await fetch(`${ROOT_BASE}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${key()}` }, body: form, signal: AbortSignal.timeout(300_000) })
  if (['json', 'verbose_json'].includes(responseFormat)) return json(response)
  const text = await response.text()
  if (!response.ok) throw new Error(`STARROUTER_REQUEST_FAILED(${response.status}): ${text.slice(0, 500)}`)
  return { text }
}

function assertHttps(value, field) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || ['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new Error(`${field} 必须是公网 HTTPS URL`)
  }
  return value
}

function positiveInteger(value, field) {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${field} 必须是正整数`)
  return value
}

function enumValue(value, values, field) {
  if (value === undefined || value === '') return undefined
  if (!values.has(value)) throw new Error(`${field} 枚举值无效：${value}`)
  return value
}

function range(value, minimum, maximum, field) {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || value < minimum || value > maximum) throw new Error(`${field} 必须为 ${minimum}–${maximum}`)
  return value
}

function imageSize(input) {
  if (!input.resolution) return input.size
  const edge = IMAGE_RESOLUTION_EDGE.get(input.resolution)
  if (!edge) throw new Error(`不支持的图片分辨率：${input.resolution}`)
  const aspectRatio = enumValue(input.aspect_ratio || '1:1', IMAGE_ASPECT_RATIOS, 'aspect_ratio')
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspectRatio)
  if (!match) throw new Error(`图片画幅无效：${input.aspect_ratio}`)
  const ratio = Number(match[1]) / Number(match[2])
  let width = ratio >= 1 ? edge : edge * ratio
  let height = ratio >= 1 ? edge / ratio : edge
  const align = (value, mode = 'round') => Math.max(64, Math[mode](value / 64) * 64)
  width = align(width)
  height = align(height)
  if (width * height < IMAGE_MIN_PIXELS) {
    const scale = Math.sqrt(IMAGE_MIN_PIXELS / (width * height))
    if (ratio >= 1) { height = align(height * scale, 'ceil'); width = align(height * ratio, 'ceil') }
    else { width = align(width * scale, 'ceil'); height = align(width / ratio, 'ceil') }
  } else if (width * height > IMAGE_MAX_PIXELS) {
    const scale = Math.sqrt(IMAGE_MAX_PIXELS / (width * height))
    width = align(width * scale, 'floor')
    height = align(height * scale, 'floor')
  }
  if (width * height < IMAGE_MIN_PIXELS || width * height > IMAGE_MAX_PIXELS) {
    throw new Error(`图片画幅超出像素限制：${input.aspect_ratio}`)
  }
  return `${width}x${height}`
}

function imageOptions(input) {
  return Object.fromEntries(Object.entries({
    size: imageSize(input),
    n: range(input.n, 1, 4, 'n'),
    quality: enumValue(input.quality, IMAGE_QUALITIES, 'quality'),
    style: input.style,
    background: enumValue(input.background, IMAGE_BACKGROUNDS, 'background'),
    moderation: enumValue(input.moderation, IMAGE_MODERATIONS, 'moderation'),
    output_format: enumValue(input.output_format, IMAGE_OUTPUT_FORMATS, 'output_format'),
    output_compression: positiveInteger(input.output_compression, 'output_compression'),
    partial_images: positiveInteger(input.partial_images, 'partial_images'),
    user: input.user,
  }).filter(([, value]) => value !== undefined && value !== ''))
}

function validatedUrls(values, field) {
  if (!Array.isArray(values)) return []
  return values.map((value) => assertHttps(value, field))
}

function validateSeedance2Contract(input, counts) {
  if (!SEEDANCE2_MODELS.has(input.model)) return []
  if (input.prompt_profile !== 'seedance2') throw new Error('Seedance 2.0 模型必须使用 seedance2 提示词协议')
  if (!['first-last-frame', 'full-reference'].includes(input.input_mode)) throw new Error('Seedance 2.0 input_mode 无效')
  if (!Number.isInteger(input.duration) || input.duration < 4 || input.duration > 15) throw new Error('Seedance 2.0 时长必须为 4–15 秒整数')
  const manifest = Array.isArray(input.reference_manifest) ? input.reference_manifest : []
  if (manifest.length !== counts.image + counts.video + counts.audio) throw new Error('reference_manifest 与实际参考素材数量不一致')
  if (counts.image > 9 || counts.video > 3 || counts.audio > 3 || counts.image + counts.video + counts.audio > 12) throw new Error('Seedance 2.0 参考素材超过图片 9、视频 3、音频 3 或总数 12 的限制')
  for (const [type, count] of Object.entries(counts)) {
    const items = manifest.filter((item) => item?.type === type)
    if (items.length !== count || items.some((item, index) => item.order !== index + 1)) throw new Error(`${type} 参考素材顺序无效`)
    for (const item of items) {
      if (!item.asset_key?.trim() || !item.version_id?.trim() || !item.role?.trim()) throw new Error(`${type} 参考素材缺少本地版本或用途`)
      if (item.real_person_face === true) throw new Error('Seedance 2.0 不接受真实人物脸部参考')
      const label = type === 'image' ? '图片' : type === 'video' ? '视频' : '音频'
      if (!input.prompt.includes(`@${label}${item.order}`)) throw new Error(`${type} 参考标签未完整写入提示词`)
    }
  }
  if (input.input_mode === 'first-last-frame') {
    if (counts.image > 2 || counts.video || counts.audio) throw new Error('Seedance 2.0 首尾帧模式只接受最多两张图片')
    const roles = manifest.filter((item) => item.type === 'image').map((item) => item.role)
    if (roles.some((role, index) => role !== ['first_frame', 'last_frame'][index])) throw new Error('Seedance 2.0 首尾帧角色必须依次为 first_frame、last_frame')
  } else {
    if (manifest.length === 0) throw new Error('Seedance 2.0 全参考模式至少需要一个参考素材')
    const expected = { image: 'reference_image', video: 'reference_video', audio: 'reference_audio' }
    if (manifest.some((item) => item.role !== expected[item.type])) throw new Error('Seedance 2.0 全参考素材 role 与类型不匹配')
  }
  const videoSeconds = manifest.filter((item) => item.type === 'video').reduce((sum, item) => sum + Number(item.duration_seconds || 0), 0)
  const audioSeconds = manifest.filter((item) => item.type === 'audio').reduce((sum, item) => sum + Number(item.duration_seconds || 0), 0)
  if (counts.video && (videoSeconds < 2 || videoSeconds > 15)) throw new Error('Seedance 2.0 参考视频总时长必须为 2–15 秒')
  if (counts.audio && (audioSeconds <= 0 || audioSeconds > 15)) throw new Error('Seedance 2.0 参考音频总时长必须为 15 秒以内')
  enumValue(input.resolution, VIDEO_RESOLUTIONS, 'resolution')
  enumValue(input.ratio, VIDEO_RATIOS, 'ratio')
  if (input.fps !== undefined && input.fps !== 24) throw new Error('Seedance 2.0 fps 仅支持 24')
  return manifest
}

function seedanceContent(input, frameUrl, images, videos, audios, manifest) {
  const content = [{ type: 'text', text: input.prompt }]
  const imageUrls = frameUrl ? [frameUrl, ...images] : images
  const imageItems = manifest.filter((item) => item.type === 'image')
  const videoItems = manifest.filter((item) => item.type === 'video')
  const audioItems = manifest.filter((item) => item.type === 'audio')
  content.push(...imageUrls.map((url, index) => ({ type: 'image_url', image_url: { url }, role: imageItems[index].role })))
  content.push(...videos.map((url, index) => ({ type: 'video_url', video_url: { url }, role: videoItems[index].role })))
  content.push(...audios.map((url, index) => ({ type: 'audio_url', audio_url: { url }, role: audioItems[index].role })))
  return content
}

function h3Payload(input) {
  if (input.prompt_profile !== 'h3' || !['T2VA', 'I2VA', 'FL2VA', 'L2VA', 'Ref2VA'].includes(input.input_mode)) throw new Error('MiniMax H3 必须使用 h3 与有效 H3 input_mode')
  const metadata = input.metadata ?? {}
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('metadata 必须是对象')
  const unknown = Object.keys(metadata).filter((field) => !H3_METADATA_FIELDS.has(field))
  if (unknown.length) throw new Error(`MiniMax H3 metadata 包含未支持字段：${unknown.join(', ')}`)
  if (metadata.model !== undefined && metadata.model !== input.model) throw new Error('metadata.model 必须与顶层 model 一致')
  const duration = metadata.duration ?? input.duration ?? 5
  const minimum = input.model === 'MiniMax-H3-Max' ? 5 : 4
  if (!Number.isInteger(duration) || duration < minimum || duration > 15) throw new Error(`${input.model} duration 必须为 ${minimum}–15 秒整数`)
  const size = metadata.resolution ?? input.size ?? input.resolution ?? '768P'
  const sizes = input.model === 'MiniMax-H3-Max' ? new Set(['480P', '768P']) : new Set(['768P', '2K'])
  enumValue(size, sizes, 'size')
  const topImages = validatedUrls(input.images, 'images')
  if (topImages.length > 2) throw new Error('MiniMax H3 images 最多两张，分别作为首帧和尾帧')
  const first = input.input_reference ? assertHttps(input.input_reference, 'input_reference') : input.frame_url ? assertHttps(input.frame_url, 'frame_url') : ''
  const imageUrls = topImages.length ? topImages : first ? [first] : []
  let content = metadata.content
  if (content === undefined) {
    content = [{ type: 'text', text: input.prompt }]
    content.push(...imageUrls.map((url, index) => ({ type: 'image_url', image_url: { url }, role: index === 0 ? 'first_frame' : 'last_frame' })))
    content.push(...validatedUrls(input.reference_image_urls || input.reference_urls, 'reference_image_urls').map((url) => ({ type: 'image_url', image_url: { url }, role: 'reference_image' })))
    content.push(...validatedUrls(input.reference_video_urls, 'reference_video_urls').map((url) => ({ type: 'video_url', video_url: { url }, role: 'reference_video' })))
    content.push(...validatedUrls(input.reference_audio_urls, 'reference_audio_urls').map((url) => ({ type: 'audio_url', audio_url: { url }, role: 'reference_audio' })))
  }
  if (!Array.isArray(content) || content.length === 0) throw new Error('metadata.content 必须是非空数组')
  let textCount = 0
  let keyframes = 0
  let references = 0
  for (const item of content) {
    if (!item || typeof item !== 'object' || !['text', 'image_url', 'video_url', 'audio_url'].includes(item.type)) throw new Error('MiniMax H3 content.type 无效')
    if (item.type === 'text') { if (typeof item.text !== 'string' || !item.text.trim()) throw new Error('MiniMax H3 text 内容不能为空'); textCount += 1; continue }
    if (!H3_CONTENT_ROLES.has(item.role)) throw new Error(`MiniMax H3 content.role 无效：${item.role}`)
    const url = item[`${item.type}`]?.url
    assertHttps(url, `content.${item.type}.url`)
    const allowedRoles = item.type === 'image_url' ? new Set(['first_frame', 'last_frame', 'reference_image']) : item.type === 'video_url' ? new Set(['reference_video']) : new Set(['reference_audio'])
    if (!allowedRoles.has(item.role)) throw new Error(`${item.type} 与 ${item.role} 不匹配`)
    if (item.role === 'first_frame' || item.role === 'last_frame') keyframes += 1
    else references += 1
  }
  if (textCount === 0) throw new Error('MiniMax H3 content 至少需要一个非空 text')
  if (keyframes && references) throw new Error('MiniMax H3 首尾帧模式不能与参考素材模式混用')
  if (input.model === 'MiniMax-H3-Max' && references) throw new Error('MiniMax-H3-Max 不支持参考素材模式')
  const modeCounts = { T2VA: [0, 0], I2VA: [1, 0], FL2VA: [2, 0], L2VA: [1, 0], Ref2VA: [0, 1] }[input.input_mode]
  if ((modeCounts[0] === 0 ? keyframes !== 0 : keyframes !== modeCounts[0]) || (modeCounts[1] === 0 ? references !== 0 : references < modeCounts[1])) throw new Error(`MiniMax H3 输入素材与 ${input.input_mode} 不匹配`)
  if (input.input_mode === 'I2VA' && !content.some((item) => item.role === 'first_frame')) throw new Error('I2VA 必须提供 first_frame')
  if (input.input_mode === 'FL2VA' && !['first_frame', 'last_frame'].every((role) => content.some((item) => item.role === role))) throw new Error('FL2VA 必须同时提供 first_frame 与 last_frame')
  if (input.input_mode === 'L2VA' && !content.some((item) => item.role === 'last_frame')) throw new Error('L2VA 必须提供 last_frame')
  const ratio = metadata.ratio ?? input.ratio ?? (keyframes ? undefined : '16:9')
  enumValue(ratio, H3_RATIOS, 'ratio')
  if (metadata.callback_url !== undefined) assertHttps(metadata.callback_url, 'metadata.callback_url')
  return {
    model: input.model,
    prompt: input.prompt,
    duration,
    size,
    ...(ratio ? { ratio } : {}),
    metadata: { ...(metadata.callback_url ? { callback_url: metadata.callback_url } : {}), content },
  }
}

function findVideoUrls(value, found = []) {
  if (!value || typeof value !== 'object') return found
  for (const name of ['video_url', 'videoUrl', 'download_url', 'downloadUrl', 'result_url', 'output_url', 'url']) {
    const candidate = value[name]
    if (typeof candidate === 'string' && /^https?:\/\//.test(candidate)) found.push(candidate)
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') findVideoUrls(child, found)
  }
  return [...new Set(found)]
}

function imageResult(data) {
  const outputs = (Array.isArray(data?.data) ? data.data : []).flatMap((item) => {
    if (typeof item?.url === 'string') return [{ url: item.url, media_type: 'image' }]
    if (typeof item?.b64_json === 'string') return [{ b64_json: item.b64_json, media_type: 'image' }]
    return []
  })
  if (!outputs.length) throw new Error('STARROUTER_IMAGE_OUTPUT_MISSING')
  return { provider: 'starrouter', status: 'completed', outputs }
}

function audioPayload(input) {
  if (!AUDIO_MODELS.includes(input.model)) throw new Error(`未注册的语音模型：${input.model}`)
  const text = input.input ?? input.prompt
  if (typeof text !== 'string' || !text.trim()) throw new Error('input 必填')
  if (typeof input.voice !== 'string' || !input.voice.trim()) throw new Error('voice 必填')
  if (input.speed !== undefined && (typeof input.speed !== 'number' || input.speed < 0.5 || input.speed > 2)) throw new Error('speed 必须为 0.5–2')
  const responseFormat = input.response_format || 'mp3'
  if (!AUDIO_FORMATS.has(responseFormat)) throw new Error('response_format 仅支持 mp3、pcm、flac')
  const metadata = input.metadata ?? {}
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('metadata 必须是对象')
  if (input.instructions !== undefined && typeof input.instructions !== 'string') throw new Error('instructions 必须是字符串')
  if (input.stream_format !== undefined) throw new Error('当前 MCP 仅支持同步语音文件，暂不支持 stream_format')
  if (input.model.startsWith('speech-2.8')) {
    const unknown = Object.keys(metadata).filter((field) => !AUDIO_METADATA_FIELDS.has(field))
    if (unknown.length) throw new Error(`metadata 包含未支持字段：${unknown.join(', ')}`)
    if (metadata.output_format !== undefined && !['hex', 'url'].includes(metadata.output_format)) throw new Error('metadata.output_format 仅支持 hex 或 url')
    if (metadata.stream === true) throw new Error('StarRouter 同步语音不支持 stream=true')
    for (const field of ['voice_setting', 'audio_setting', 'pronunciation_dict', 'voice_modify', 'stream_options']) if (metadata[field] !== undefined && (!metadata[field] || typeof metadata[field] !== 'object' || Array.isArray(metadata[field]))) throw new Error(`metadata.${field} 必须是对象`)
    if (metadata.timbre_weights !== undefined && !Array.isArray(metadata.timbre_weights)) throw new Error('metadata.timbre_weights 必须是数组')
    const voiceSetting = metadata.voice_setting || {}
    range(voiceSetting.speed, 0.5, 2, 'metadata.voice_setting.speed')
    if (voiceSetting.vol !== undefined && (typeof voiceSetting.vol !== 'number' || voiceSetting.vol <= 0 || voiceSetting.vol > 10)) throw new Error('metadata.voice_setting.vol 必须为 (0,10]')
    range(voiceSetting.pitch, -12, 12, 'metadata.voice_setting.pitch')
    if (voiceSetting.emotion !== undefined && (typeof voiceSetting.emotion !== 'string' || !voiceSetting.emotion.trim())) throw new Error('metadata.voice_setting.emotion 必须是非空字符串')
    const audioSetting = metadata.audio_setting || {}
    enumValue(audioSetting.sample_rate, AUDIO_SAMPLE_RATES, 'metadata.audio_setting.sample_rate')
    enumValue(audioSetting.bitrate, AUDIO_BITRATES, 'metadata.audio_setting.bitrate')
    enumValue(audioSetting.format, AUDIO_FORMATS, 'metadata.audio_setting.format')
    enumValue(audioSetting.channel, new Set([1, 2]), 'metadata.audio_setting.channel')
    if (metadata.language_boost !== undefined && (typeof metadata.language_boost !== 'string' || !metadata.language_boost.trim())) throw new Error('metadata.language_boost 必须是语言名称或 auto')
  }
  return { model: input.model, input: text, voice: input.voice, response_format: responseFormat, ...(input.speed === undefined ? {} : { speed: input.speed }), ...(input.instructions === undefined ? {} : { instructions: input.instructions }), ...(Object.keys(metadata).length ? { metadata } : {}) }
}

function audioResult(bytes, contentType, format) {
  if (!bytes.length) throw new Error('STARROUTER_AUDIO_OUTPUT_MISSING')
  const reported = contentType?.split(';')[0]?.trim()
  const mime = reported?.startsWith('audio/') ? reported : AUDIO_MIME_TYPES[format]
  return { provider: 'starrouter', task_id: `starrouter-sync-${randomUUID()}`, status: 'completed', outputs: [{ b64_json: `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`, media_type: 'audio', content_type: mime, format }] }
}

function asrOptions(input) {
  if (!ASR_MODELS.includes(input.model)) throw new Error(`未注册的语音识别模型：${input.model}`)
  const responseFormat = input.response_format || 'json'
  enumValue(responseFormat, ASR_FORMATS, 'response_format')
  if (input.language !== undefined && (typeof input.language !== 'string' || !input.language.trim())) throw new Error('language 必须是非空字符串')
  if (input.prompt !== undefined && typeof input.prompt !== 'string') throw new Error('prompt 必须是字符串')
  range(input.temperature, 0, 1, 'temperature')
  return { model: input.model, response_format: responseFormat, language: input.language, prompt: input.prompt, temperature: input.temperature }
}

async function asrForm(input) {
  const options = asrOptions(input)
  const extension = extname(input.file_path || '').toLowerCase()
  const file = await stat(input.file_path || '').catch(() => null)
  if (!file?.isFile() || file.size <= 0 || file.size > MAX_ASR_BYTES || !ASR_EXTENSIONS.has(extension)) throw new Error('ASR 文件不存在、格式不支持或超过大小限制')
  const form = new FormData()
  for (const [name, value] of Object.entries(options)) if (value !== undefined) form.append(name, String(value))
  form.append('file', new Blob([await readFile(input.file_path)], { type: 'application/octet-stream' }), basename(input.file_path))
  return { form, responseFormat: options.response_format }
}

function musicPayload(input) {
  if (!MUSIC_MODELS.includes(input.model)) throw new Error(`未注册的音乐模型：${input.model}`)
  if (typeof input.prompt !== 'string' || !input.prompt.trim()) throw new Error('音乐 prompt 必填')
  if (input.title !== undefined && (typeof input.title !== 'string' || !input.title.trim())) throw new Error('音乐 title 必须是非空字符串')
  if (input.tags !== undefined && (typeof input.tags !== 'string' || !input.tags.trim())) throw new Error('音乐 tags 必须是非空字符串')
  if (input.lyrics !== undefined && typeof input.lyrics !== 'string') throw new Error('音乐 lyrics 必须是字符串')
  const instrumental = input.make_instrumental === true
  if (instrumental && input.lyrics?.trim()) throw new Error('纯音乐不能同时提供 lyrics')
  return Object.fromEntries(Object.entries({
    prompt: input.lyrics?.trim() || input.prompt.trim(),
    title: input.title?.trim(),
    tags: input.tags?.trim(),
    make_instrumental: instrumental,
  }).filter(([, value]) => value !== undefined && value !== ''))
}

function musicTaskId(data) {
  const value = typeof data?.data === 'string' ? data.data : data?.data?.task_id || data?.data?.id || data?.task_id || data?.id
  if (!value) throw new Error('STARROUTER_MUSIC_TASK_ID_MISSING')
  return `music:${value}`
}

function findMusicUrls(value, found = []) {
  if (!value || typeof value !== 'object') return found
  for (const name of ['audio_url', 'audioUrl', 'source_audio_url', 'sourceAudioUrl', 'stream_audio_url', 'streamAudioUrl']) {
    const candidate = value[name]
    if (typeof candidate === 'string' && /^https?:\/\//.test(candidate)) found.push(candidate)
  }
  for (const child of Object.values(value)) if (child && typeof child === 'object') findMusicUrls(child, found)
  return [...new Set(found)]
}

export const starrouter = {
  label: 'StarRouter', credentialEnv: 'STARROUTER_API_KEY',
  catalog: { image: IMAGE_MODELS, video: VIDEO_MODELS, audio: AUDIO_MODELS, music: MUSIC_MODELS, asr: ASR_MODELS },
  capabilities: { text: false, image: true, video: true, audio: true, music: true, transcription: true, translation: true },
  async models() {
    const data = await request('/v1/models', { timeout: 20_000 })
    return { catalog: starrouter.catalog, remote: data.data || [] }
  },
  async testConnection() { await starrouter.models() },

  async image(input) {
    confirm(input)
    if (!IMAGE_MODELS.includes(input.model)) throw new Error(`未注册的图片模型：${input.model}`)
    if (!input.prompt?.trim()) throw new Error('prompt 必填')
    const options = imageOptions(input)
    if (input.reference_paths?.length) {
      const form = new FormData()
      form.append('model', input.model)
      form.append('prompt', input.prompt)
      for (const [name, value] of Object.entries(options)) form.append(name, String(value))
      const field = input.reference_paths.length > 1 ? 'image[]' : 'image'
      for (const path of input.reference_paths) {
        if ((await stat(path)).size > MAX_REFERENCE_IMAGE_BYTES) throw new Error(`参考图超过 4MB：${path}`)
        const bytes = await readFile(path)
        form.append(field, new Blob([bytes], { type: IMAGE_MIME_TYPES[extname(path).toLowerCase()] || 'application/octet-stream' }), basename(path))
      }
      return imageResult(await request('/v1/images/edits', { method: 'POST', body: form }))
    }
    return imageResult(await request('/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: input.model, prompt: input.prompt, ...options }),
    }))
  },

  async audio(input) {
    confirm(input)
    const payload = audioPayload(input)
    const response = await binaryRequest('/v1/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return audioResult(new Uint8Array(await response.arrayBuffer()), response.headers.get('content-type'), payload.response_format)
  },

  async transcribe(input) {
    confirm(input)
    const { form, responseFormat } = await asrForm(input)
    return { provider: 'starrouter', model: input.model, ...(await asrRequest('/v1/audio/transcriptions', form, responseFormat)) }
  },

  async translate(input) {
    confirm(input)
    const { form, responseFormat } = await asrForm(input)
    return { provider: 'starrouter', model: input.model, ...(await asrRequest('/v1/audio/translations', form, responseFormat)) }
  },

  async music(input) {
    confirm(input)
    const data = await request('/suno/submit/MUSIC', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(musicPayload(input)), timeout: 30_000,
    })
    return { provider: 'starrouter', task_id: musicTaskId(data), media_type: 'audio', model: input.model, status: 'submitted' }
  },

  async submitVideo(input) {
    confirm(input)
    if (!VIDEO_MODELS.includes(input.model)) throw new Error(`未注册的视频模型：${input.model}`)
    if (!input.prompt?.trim()) throw new Error('prompt 必填')
    if (H3_MODELS.has(input.model)) {
      const data = await request('/v1/videos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(h3Payload(input)), timeout: 30_000 })
      const taskId = data?.task_id || data?.id
      if (!taskId) throw new Error('STARROUTER_VIDEO_TASK_ID_MISSING')
      return { provider: 'starrouter', task_id: taskId, media_type: 'video', status: 'submitted' }
    }
    if (!SEEDANCE2_MODELS.has(input.model) && (input.prompt_profile !== 'generic' || input.input_mode !== 'generic')) throw new Error('Seedance 1.x 模型必须使用 generic/generic 协议')
    enumValue(input.resolution, VIDEO_RESOLUTIONS, 'resolution')
    enumValue(input.ratio, VIDEO_RATIOS, 'ratio')
    const frameUrl = input.frame_url ? assertHttps(input.frame_url, 'frame_url') : ''
    const images = validatedUrls(input.reference_image_urls || input.reference_urls, 'reference_image_urls')
    const videos = validatedUrls(input.reference_video_urls, 'reference_video_urls')
    const audios = validatedUrls(input.reference_audio_urls, 'reference_audio_urls')
    const counts = { image: images.length + (frameUrl ? 1 : 0), video: videos.length, audio: audios.length }
    const seedanceManifest = validateSeedance2Contract(input, counts)
    const multimodal = MULTIMODAL_VIDEO_MODELS.has(input.model)
    if ((images.length > 1 || videos.length || audios.length) && !multimodal) {
      throw new Error('当前模型不支持多参考素材')
    }
    if (counts.image > 9 || counts.video > 3 || counts.audio > 3 || counts.image + counts.video + counts.audio > 12) throw new Error('视频参考素材数量超限')
    if (audios.length && counts.image + videos.length === 0) throw new Error('参考音频必须同时提供视觉参考')
    if ((videos.length || audios.length) && frameUrl) throw new Error('首帧不能与视频/音频参考同时使用')
    if (input.reference_only === true && counts.image + videos.length + audios.length === 0) throw new Error('reference_only 需要参考素材')
    // ponytail: 视频端点只接受公网 HTTPS；插件不承担本地文件发布，需由用户提供已授权地址。
    const content = SEEDANCE2_MODELS.has(input.model)
      ? seedanceContent(input, frameUrl, images, videos, audios, seedanceManifest)
      : [{ type: 'text', text: input.prompt }, ...(frameUrl ? [{ type: 'image_url', image_url: { url: frameUrl }, role: 'first_frame' }] : []), ...images.map((url) => ({ type: 'image_url', image_url: { url }, role: images.length > 1 || input.reference_only ? 'reference_image' : 'first_frame' })), ...videos.map((url) => ({ type: 'video_url', video_url: { url }, role: 'reference_video' })), ...audios.map((url) => ({ type: 'audio_url', audio_url: { url }, role: 'reference_audio' }))]
    const extra = input.extra_options && typeof input.extra_options === 'object' && !Array.isArray(input.extra_options) ? input.extra_options : {}
    const data = await request('/volcengine/doubao/contents/generations/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...extra,
        model: input.model,
        content,
        duration: input.duration,
        resolution: input.resolution,
        ratio: input.ratio,
        generate_audio: input.generate_audio,
        watermark: input.watermark ?? false,
        seed: input.seed,
        fps: input.fps,
        n: input.n,
        response_format: input.response_format,
        user: input.user,
        ...(input.metadata ? { metadata: input.metadata } : {}),
      }),
      timeout: 30_000,
    })
    const taskId = data?.data?.task_id || data?.data?.id || data?.task_id || data?.id
    if (!taskId) throw new Error('STARROUTER_VIDEO_TASK_ID_MISSING')
    return { provider: 'starrouter', task_id: taskId, media_type: 'video', status: 'submitted' }
  },

  async task(input) {
    if (!input.task_id?.trim()) throw new Error('task_id 必填')
    if (input.task_id.startsWith('music:')) {
      const data = await request(`/suno/fetch/${encodeURIComponent(input.task_id.slice(6))}`, { timeout: 30_000 })
      const status = String(data?.data?.status || data?.status || data?.state || 'PENDING').toUpperCase()
      if (['FAILED', 'ERROR'].includes(status)) return { provider: 'starrouter', status: 'failed', error: data?.data?.error_message || data?.message || data?.error?.message }
      if (['SUCCEEDED', 'SUCCESS', 'DONE', 'COMPLETED', 'FINISHED'].includes(status)) {
        const urls = findMusicUrls(data)
        return urls.length ? { provider: 'starrouter', status: 'completed', outputs: urls.map((url) => ({ url, media_type: 'audio' })) } : { provider: 'starrouter', status: 'failed', error: '任务完成但未返回音乐 URL' }
      }
      return { provider: 'starrouter', status: 'pending' }
    }
    const path = input.task_id.startsWith('task_') ? `/v1/videos/${encodeURIComponent(input.task_id)}` : `/volcengine/doubao/contents/generations/tasks/${encodeURIComponent(input.task_id)}`
    const data = await request(path, { timeout: 30_000 })
    const rawStatus = data?.data?.status || data?.status || data?.state || 'PENDING'
    const status = String(rawStatus).toUpperCase()
    if (['FAILED', 'ERROR'].includes(status)) return { provider: 'starrouter', status: 'failed', error: data?.data?.error_message || data?.message || data?.error?.message }
    if (['SUCCEEDED', 'SUCCESS', 'DONE', 'COMPLETED', 'FINISHED'].includes(status)) {
      const urls = findVideoUrls(data)
      return urls.length ? { provider: 'starrouter', status: 'completed', outputs: urls.map((url) => ({ url, media_type: 'video' })) } : { provider: 'starrouter', status: 'failed', error: '任务完成但未返回视频 URL' }
    }
    return { provider: 'starrouter', status: 'pending' }
  },
}

export function selfCheck() {
  if (findVideoUrls({ data: [{ output_url: 'https://example.com/a.mp4' }, { output_url: 'https://example.com/b.mp4' }] }).length !== 2) throw new Error('findVideoUrls 自检失败')
  if (imageSize({ resolution: '1K', aspect_ratio: '16:9' }) !== '1408x768') throw new Error('imageSize 自检失败')
  if (imageResult({ data: [{ url: 'https://example.com/a.png' }] }).outputs[0].media_type !== 'image') throw new Error('图片结果归一化失败')
  const audio = audioPayload({ model: 'speech-2.8-hd', input: '你好', voice: 'male-qn-qingse', response_format: 'mp3', speed: 1, metadata: { output_format: 'hex' } })
  if (audio.input !== '你好' || audioResult(Buffer.from('audio'), 'audio/mpeg', 'mp3').outputs[0].media_type !== 'audio') throw new Error('语音请求或结果归一化失败')
  audioPayload({ model: 'speech-2.8-hd', input: '你好', voice: 'voice-id', metadata: { voice_setting: { emotion: 'future-emotion' }, language_boost: 'Future-Language' } })
  try { audioPayload({ model: 'speech-2.8-hd', input: '你好', voice: 'male-qn-qingse', metadata: { stream: true } }); throw new Error('语音流式校验失败') } catch (error) { if (!String(error.message).includes('stream=true')) throw error }
  if (asrOptions({ model: 'whisper-1', response_format: 'verbose_json', temperature: 0 }).response_format !== 'verbose_json') throw new Error('语音识别参数自检失败')
  const openAiAudio = audioPayload({ model: 'tts-1', input: '你好', voice: 'alloy', instructions: '清晰地说话', metadata: { trace_id: 'trace-test' } })
  if (openAiAudio.instructions !== '清晰地说话' || openAiAudio.metadata.trace_id !== 'trace-test') throw new Error('OpenAI 兼容语音参数自检失败')
  validateSeedance2Contract({ model: 'dreamina-seedance-2-0-260128', prompt_profile: 'seedance2', input_mode: 'first-last-frame', duration: 5, prompt: '@图片1', reference_manifest: [{ type: 'image', order: 1, asset_key: 'board-1', version_id: 'v001', role: 'first_frame', real_person_face: false }] }, { image: 1, video: 0, audio: 0 })
  const seedanceFrames = [{ type: 'image', order: 1, asset_key: 'board-1', version_id: 'v001', role: 'first_frame' }, { type: 'image', order: 2, asset_key: 'board-2', version_id: 'v001', role: 'last_frame' }]
  if (seedanceContent({ prompt: 'A' }, '', ['https://example.com/1.png', 'https://example.com/2.png'], [], [], seedanceFrames).at(-1).role !== 'last_frame') throw new Error('Seedance 首尾帧角色映射失败')
  const h3 = h3Payload({ model: 'MiniMax-H3', prompt_profile: 'h3', input_mode: 'T2VA', prompt: 'A circle moves.', duration: 4, size: '2K', ratio: '16:9' })
  if (h3.size !== '2K' || h3.metadata.content[0].type !== 'text') throw new Error('MiniMax H3 请求自检失败')
  try { h3Payload({ model: 'MiniMax-H3', prompt_profile: 'h3', input_mode: 'FL2VA', prompt: 'A', duration: 4, size: '768P', images: ['https://example.com/1.png', 'https://example.com/2.png', 'https://example.com/3.png'] }); throw new Error('H3 图片上限自检失败') } catch (error) { if (!String(error.message).includes('最多两张')) throw error }
  try { validateSeedance2Contract({ model: 'dreamina-seedance-2-0-260128', prompt_profile: 'seedance2', input_mode: 'full-reference', duration: 5, reference_manifest: Array.from({ length: 10 }, (_, index) => ({ type: 'image', order: index + 1 })) }, { image: 10, video: 0, audio: 0 }); throw new Error('Seedance 素材上限自检失败') } catch (error) { if (!String(error.message).includes('超过图片')) throw error }
  try { h3Payload({ model: 'MiniMax-H3-Max', prompt_profile: 'h3', input_mode: 'Ref2VA', prompt: 'A', reference_video_urls: ['https://example.com/a.mp4'] }); throw new Error('H3-Max 参考素材校验失败') } catch (error) { if (!String(error.message).includes('不支持参考素材')) throw error }
  if (musicPayload({ model: 'suno_music', prompt: '电影感片尾曲', make_instrumental: true }).make_instrumental !== true) throw new Error('音乐请求自检失败')
  if (musicTaskId({ data: 'abc' }) !== 'music:abc' || findMusicUrls({ data: [{ audio_url: 'https://example.com/a.mp3' }] }).length !== 1) throw new Error('音乐任务归一化失败')
}
