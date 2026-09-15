#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import { credential } from './credentials.mjs'

const DASHSCOPE_BASE = (process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com').replace(/\/$/, '')
const MULTIMODAL_TTS_PATH = '/api/v1/services/aigc/multimodal-generation/generation'
const COSYVOICE_TTS_PATH = '/api/v1/services/audio/tts/SpeechSynthesizer'
const CUSTOMIZATION_PATH = '/api/v1/services/audio/tts/customization'

export const QWEN_TTS_MODEL = 'qwen3-tts-vd-2026-01-26'
export const COSYVOICE_MODELS = ['cosyvoice-v3.5-plus', 'cosyvoice-v3.5-flash', 'cosyvoice-v3-plus', 'cosyvoice-v3-flash', 'cosyvoice-v2']
export const BAILIAN_AUDIO_MODELS = [...COSYVOICE_MODELS, QWEN_TTS_MODEL]
export const BAILIAN_COSYVOICE_LANGUAGE_HINTS = ['zh', 'en', 'fr', 'de', 'ja', 'ko', 'ru', 'pt', 'th', 'id', 'vi']
const SEVEN_LANGUAGE_HINTS = ['zh', 'en', 'fr', 'de', 'ja', 'ko', 'ru']
const TWO_LANGUAGE_HINTS = ['zh', 'en']
const INSTRUCTION_MODELS = new Set(['cosyvoice-v3.5-plus', 'cosyvoice-v3.5-flash', 'cosyvoice-v3-flash'])
const CUSTOM_VOICE_ONLY_MODELS = new Set(['cosyvoice-v3.5-plus', 'cosyvoice-v3.5-flash'])
const COSYVOICE_FORMATS = new Set(['wav', 'mp3', 'pcm', 'opus'])
const SAMPLE_RATES = new Set([8000, 16000, 22050, 24000, 44100, 48000])
export const COSYVOICE_MAX_CHARS = 280
export const QWEN_MAX_CHARS = 600
export const AUDIO_MIME = { wav: 'audio/wav', mp3: 'audio/mpeg', pcm: 'audio/L16', opus: 'audio/opus' }

const trim = (value) => (typeof value === 'string' ? value.trim() : '')

function clamp(value, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(max, Math.max(min, value))
}

export function weightedLength(text) {
  return Array.from(String(text ?? '')).reduce((total, ch) => total + (/\p{Script=Han}/u.test(ch) ? 2 : 1), 0)
}
export const isCosyVoiceModel = (model) => COSYVOICE_MODELS.includes(model)
export function languageHintsFor(model) {
  if (model === 'cosyvoice-v2') return TWO_LANGUAGE_HINTS
  if (model === 'cosyvoice-v3-plus') return SEVEN_LANGUAGE_HINTS
  return isCosyVoiceModel(model) ? BAILIAN_COSYVOICE_LANGUAGE_HINTS : []
}
export const supportsInstruction = (model) => INSTRUCTION_MODELS.has(model)
export function inferModelFromVoiceId(voiceId) {
  const id = trim(voiceId)
  return COSYVOICE_MODELS.find((model) => id === model || id.startsWith(`${model}-`)) || ''
}
// WHATWG URL 会把 hex/八进制/整数/短写 IPv4 规范化为点分十进制；这里只接受规范形式，异常即闭合拒绝
function parseIpv4Octets(host) {
  const parts = String(host).split('.')
  if (parts.length !== 4) return null
  const octets = []
  for (const part of parts) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(part)) return null
    const number = Number(part)
    if (number > 255) return null
    octets.push(number)
  }
  return octets
}
function isNonPublicIPv4([a, b, c]) {
  return a === 0 // 0.0.0.0/8 本机网络/未指定
    || a === 10 // RFC1918
    || a === 127 // loopback
    || (a === 100 && b >= 64 && b <= 127) // CGNAT 100.64.0.0/10
    || (a === 169 && b === 254) // link-local（含云元数据 169.254.169.254）
    || (a === 172 && b >= 16 && b <= 31) // RFC1918
    || (a === 192 && b === 0 && (c === 0 || c === 2)) // 192.0.0.0/24、TEST-NET-1
    || (a === 192 && b === 88 && c === 99) // 6to4 任播遗留
    || (a === 192 && b === 168) // RFC1918
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) // benchmark / TEST-NET-2
    || (a === 203 && b === 0 && c === 113) // TEST-NET-3
    || a >= 224 // 224/4 组播、240/4 保留、255.255.255.255
}
function parseIpv6Bytes(raw) {
  let addr = String(raw).toLowerCase()
  if (!addr || addr.includes(':::') || addr.includes('%')) return null
  let embedded = null
  if (addr.includes('.')) {
    const colon = addr.lastIndexOf(':')
    if (colon < 0) return null
    embedded = parseIpv4Octets(addr.slice(colon + 1))
    if (!embedded) return null
    addr = addr.slice(0, colon)
  }
  let head = []
  let tail = []
  if (addr.includes('::')) {
    if (addr.indexOf('::') !== addr.lastIndexOf('::')) return null
    const [left, right] = addr.split('::')
    head = left ? left.split(':') : []
    tail = right ? right.split(':') : []
  } else {
    head = addr.split(':')
  }
  if (embedded) tail.push(((embedded[0] << 8) | embedded[1]).toString(16), ((embedded[2] << 8) | embedded[3]).toString(16))
  const groups = addr.includes('::') ? [...head, ...new Array(8 - head.length - tail.length).fill('0'), ...tail] : head
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null
  const bytes = new Uint8Array(16)
  groups.forEach((group, index) => {
    const value = parseInt(group, 16)
    bytes[index * 2] = value >> 8
    bytes[index * 2 + 1] = value & 255
  })
  return bytes
}
function isNonPublicIPv6(bytes) {
  // ::1 回环与 :: 未指定天然落入“内嵌 IPv4”判定（0.0.0.1 / 0.0.0.0 均非公网）
  if (bytes.subarray(0, 10).every((byte) => byte === 0)) return isNonPublicIPv4([bytes[12], bytes[13], bytes[14], bytes[15]])
  if (bytes[0] === 0xff) return true // ff00::/8 组播
  if (bytes[0] === 0xfe && ((bytes[1] & 0xc0) === 0x80 || (bytes[1] & 0xc0) === 0xc0)) return true // fe80::/10 链路本地、fec0::/10 废弃站点本地
  if ((bytes[0] & 0xfe) === 0xfc) return true // fc00::/7 唯一本地地址
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return true // 2001:db8::/32 文档保留
  return false
}
export function assertPublicHttps(value, field = 'url') {
  let url
  try { url = new URL(typeof value === 'string' ? value : String(value ?? '')) }
  catch { throw new Error(`${field} 必须是公网 HTTPS URL`) }
  if (url.protocol !== 'https:') throw new Error(`${field} 必须是公网 HTTPS URL`)
  const hostname = url.hostname
  if (!hostname) throw new Error(`${field} 必须是公网 HTTPS URL`)
  const bare = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname
  const lower = bare.toLowerCase().replace(/\.$/, '') // 去掉根标签尾点：localhost. 仍是本机
  if (lower === 'localhost' || lower.endsWith('.localhost')) throw new Error(`${field} 必须是公网 HTTPS URL`)
  const kind = isIP(bare)
  if (kind === 4) {
    const octets = parseIpv4Octets(bare)
    if (!octets || isNonPublicIPv4(octets)) throw new Error(`${field} 必须是公网 HTTPS URL`)
  } else if (kind === 6) {
    const bytes = parseIpv6Bytes(bare)
    if (!bytes || isNonPublicIPv6(bytes)) throw new Error(`${field} 必须是公网 HTTPS URL`)
  }
  return value
}

export function validateVoicePrompt(value) {
  const voicePrompt = String(value ?? '')
  if (!voicePrompt.trim()) return { valid: false, error: '声音提示词不能为空' }
  if (Array.from(voicePrompt).length > 500) return { valid: false, error: '声音提示词不能超过500个字符' }
  return { valid: true }
}
export function validatePreviewText(value) {
  const previewText = String(value ?? '')
  if (!previewText.trim()) return { valid: false, error: '预览文本不能为空' }
  if (Array.from(previewText).length < 5) return { valid: false, error: '预览文本至少需要5个字符' }
  if (Array.from(previewText).length > 200) return { valid: false, error: '预览文本不能超过200个字符' }
  return { valid: true }
}
export function validateVoicePrefix(value) {
  if (!/^[A-Za-z0-9]{1,10}$/.test(String(value ?? ''))) return { valid: false, error: '音色前缀为 1-10 位字母或数字' }
  return { valid: true }
}
export function requireValid(result) { if (!result.valid) throw new Error(result.error) }

// ---- WAV 工具（移植自 waoowaoo cosyvoice-tts.ts，两个 TTS 端点共用一份）----
function decodeWavBuffer(buffer) {
  if (buffer.subarray(0, 4).toString('ascii') !== 'RIFF' || buffer.subarray(8, 12).toString('ascii') !== 'WAVE') throw new Error('BAILIAN_TTS_WAV_INVALID_HEADER')
  if (buffer.length < 44) throw new Error('BAILIAN_TTS_WAV_TOO_SHORT')
  let fmt = null
  let pcmData = null
  let offset = 12
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.subarray(offset, offset + 4).toString('ascii')
    const chunkSize = buffer.readUInt32LE(offset + 4)
    const chunkStart = offset + 8
    const chunkEnd = chunkStart + chunkSize
    if (chunkEnd > buffer.length) throw new Error('BAILIAN_TTS_WAV_CHUNK_OUT_OF_RANGE')
    if (chunkId === 'fmt ') {
      if (chunkSize < 16) throw new Error('BAILIAN_TTS_WAV_FMT_INVALID')
      fmt = { audioFormat: buffer.readUInt16LE(chunkStart), numChannels: buffer.readUInt16LE(chunkStart + 2), sampleRate: buffer.readUInt32LE(chunkStart + 4), byteRate: buffer.readUInt32LE(chunkStart + 8), blockAlign: buffer.readUInt16LE(chunkStart + 12), bitsPerSample: buffer.readUInt16LE(chunkStart + 14) }
    } else if (chunkId === 'data') {
      pcmData = buffer.subarray(chunkStart, chunkEnd)
    }
    offset = chunkEnd + (chunkSize % 2)
  }
  if (!fmt || !pcmData) throw new Error('BAILIAN_TTS_WAV_MISSING_CHUNKS')
  return { format: fmt, data: Buffer.from(pcmData) }
}
function buildWavBuffer(format, pcmData) {
  const output = Buffer.allocUnsafe(44 + pcmData.length)
  output.write('RIFF', 0, 'ascii')
  output.writeUInt32LE(36 + pcmData.length, 4)
  output.write('WAVE', 8, 'ascii')
  output.write('fmt ', 12, 'ascii')
  output.writeUInt32LE(16, 16)
  output.writeUInt16LE(format.audioFormat, 20)
  output.writeUInt16LE(format.numChannels, 22)
  output.writeUInt32LE(format.sampleRate, 24)
  output.writeUInt32LE(format.byteRate, 28)
  output.writeUInt16LE(format.blockAlign, 32)
  output.writeUInt16LE(format.bitsPerSample, 34)
  output.write('data', 36, 'ascii')
  output.writeUInt32LE(pcmData.length, 40)
  pcmData.copy(output, 44)
  return output
}
function isWavFormatEqual(left, right) {
  return left.audioFormat === right.audioFormat && left.numChannels === right.numChannels && left.sampleRate === right.sampleRate && left.byteRate === right.byteRate && left.blockAlign === right.blockAlign && left.bitsPerSample === right.bitsPerSample
}
function mergeWavBuffers(buffers) {
  if (buffers.length === 0) throw new Error('BAILIAN_TTS_SEGMENTS_EMPTY')
  if (buffers.length === 1) return buffers[0]
  const decoded = buffers.map((buffer) => decodeWavBuffer(buffer))
  const [first, ...rest] = decoded
  for (const item of rest) if (!isWavFormatEqual(first.format, item.format)) throw new Error('BAILIAN_TTS_SEGMENT_WAV_FORMAT_MISMATCH')
  return buildWavBuffer(first.format, Buffer.concat(decoded.map((item) => item.data)))
}
function wavDurationMs(buffer) {
  try {
    const decoded = decodeWavBuffer(buffer)
    if (decoded.format.byteRate <= 0) return 0
    return Math.round((decoded.data.length / decoded.format.byteRate) * 1000)
  } catch { return 0 }
}

const SPLIT_HINT_CHARS = new Set(['。', '！', '？', '；', '，', '、', '.', '!', '?', ';', ',', ':', '：', '\n'])
function splitTextByLimit(text, maxChars) {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return []
  const chars = Array.from(trimmed)
  if (chars.length <= maxChars) return [trimmed]
  const segments = []
  let cursor = 0
  while (cursor < chars.length) {
    const hardEnd = Math.min(cursor + maxChars, chars.length)
    if (hardEnd === chars.length) {
      const segment = chars.slice(cursor, hardEnd).join('').trim()
      if (segment) segments.push(segment)
      break
    }
    let splitPoint = hardEnd
    for (let index = hardEnd - 1; index > cursor; index -= 1) {
      if (SPLIT_HINT_CHARS.has(chars[index])) { splitPoint = index + 1; break }
    }
    const segment = chars.slice(cursor, splitPoint).join('').trim()
    if (!segment) throw new Error('BAILIAN_TTS_SPLIT_FAILED')
    segments.push(segment)
    cursor = splitPoint
    while (cursor < chars.length && /\s/.test(chars[cursor])) cursor += 1
  }
  return segments
}

// ---- 请求体构造 ----
export function buildCosyTtsBody(input) {
  const format = trim(input.format) || 'wav'
  if (!COSYVOICE_FORMATS.has(format)) throw new Error('response_format 仅支持 wav、mp3、pcm、opus')
  const sampleRate = input.sampleRate ?? 24000
  if (!SAMPLE_RATES.has(sampleRate)) throw new Error(`sample_rate 不受支持：${sampleRate}`)
  const languageHints = trim(input.languageHints)
  if (languageHints && !languageHintsFor(input.model).includes(languageHints)) throw new Error(`language_hints 不受 ${input.model} 支持：${languageHints}`)
  const instruction = trim(input.instruction)
  if (instruction) {
    if (!supportsInstruction(input.model)) throw new Error(`COSYVOICE_TTS_INSTRUCTION_UNSUPPORTED:${input.model}`)
    if (weightedLength(instruction) > 100) throw new Error('COSYVOICE_TTS_INSTRUCTION_TOO_LONG')
  }
  if (CUSTOM_VOICE_ONLY_MODELS.has(input.model) && inferModelFromVoiceId(input.voice) !== input.model) throw new Error(`COSYVOICE_TTS_CUSTOM_VOICE_REQUIRED:${input.model}`)
  return {
    model: input.model,
    input: {
      text: input.text, voice: input.voice, format, sample_rate: sampleRate,
      volume: clamp(input.volume, 0, 100) ?? 50,
      rate: clamp(input.rate, 0.5, 2) ?? 1,
      pitch: clamp(input.pitch, 0.5, 2) ?? 1,
      ...(languageHints ? { language_hints: [languageHints] } : {}),
      ...(instruction ? { instruction } : {}),
    },
  }
}
export function buildQwenTtsBody(input) {
  const languageType = trim(input.languageType) || 'Chinese'
  if (!['Chinese', 'English'].includes(languageType)) throw new Error('language_type 仅支持 Chinese、English')
  return { model: input.model, input: { text: input.text, voice: input.voice, language_type: languageType } }
}
export function buildDesignRequest(input) {
  if (input.flavor === 'qwen') {
    return {
      flavor: 'qwen',
      body: {
        model: 'qwen-voice-design',
        input: { action: 'create', target_model: QWEN_TTS_MODEL, voice_prompt: input.voice_prompt, preview_text: input.preview_text, preferred_name: trim(input.preferred_name) || 'custom_voice', language: input.language === 'en' ? 'en' : 'zh' },
        parameters: { sample_rate: 24000, response_format: 'wav' },
      },
    }
  }
  const targetModel = COSYVOICE_MODELS.includes(input.target_model) ? input.target_model : 'cosyvoice-v3.5-plus'
  const languageHints = trim(input.language_hints)
  return {
    flavor: 'cosyvoice-design',
    body: {
      model: 'voice-enrollment',
      input: { action: 'create_voice', target_model: targetModel, voice_prompt: input.voice_prompt, preview_text: input.preview_text, prefix: trim(input.prefix) || 'cv', ...(languageHints ? { language_hints: [languageHints] } : {}) },
      parameters: { sample_rate: 24000, response_format: 'wav' },
    },
  }
}
export function buildCloneRequest(input) {
  const targetModel = COSYVOICE_MODELS.includes(input.target_model) ? input.target_model : 'cosyvoice-v3.5-plus'
  const languageHints = trim(input.language_hints)
  const maxLength = input.max_prompt_audio_length === undefined ? 10 : Math.min(30, Math.max(3, Math.trunc(input.max_prompt_audio_length)))
  return {
    flavor: 'cosyvoice-clone',
    body: {
      model: 'voice-enrollment',
      input: { action: 'create_voice', target_model: targetModel, url: input.url, prefix: trim(input.prefix) || 'clone', ...(languageHints ? { language_hints: [languageHints] } : {}), max_prompt_audio_length: maxLength, ...(input.enable_preprocess === true ? { enable_preprocess: true } : {}) },
    },
  }
}
export function buildDeleteRequest(voiceId) {
  return voiceId.startsWith('cosyvoice-v')
    ? { flavor: 'cosyvoice', body: { model: 'voice-enrollment', input: { action: 'delete_voice', voice_id: voiceId } } }
    : { flavor: 'qwen', body: { model: 'qwen-voice-design', input: { action: 'delete', voice: voiceId } } }
}

function apiKey() {
  const value = credential('BAILIAN_API_KEY')
  if (!value) throw new Error('BAILIAN_API_KEY 未配置')
  return value
}
function confirm(input) {
  if (input?.confirmed !== true) throw new Error('付费生成前必须取得用户确认，并传 confirmed=true')
}
function normalizeHttpError(status, data, raw) {
  const detail = [data?.code, data?.message].filter(Boolean).join(': ') || raw
  return new Error(`BAILIAN_REQUEST_FAILED(${status}): ${String(detail).slice(0, 500)}`)
}
async function postJson(path, body, { timeout = 300000 } = {}) {
  const response = await fetch(`${DASHSCOPE_BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  })
  const raw = await response.text()
  let data = {}
  let parsed = true
  if (raw) {
    try { data = JSON.parse(raw) } catch { parsed = false }
  }
  // 先判 HTTP 状态：非 2xx 即使是 HTML/纯文本网关页，也要按稳定 code + 原文回退归一化
  if (!response.ok) throw normalizeHttpError(response.status, data, raw)
  if (!parsed) throw new Error('BAILIAN_RESPONSE_INVALID_JSON')
  return data
}
async function fetchAudioBuffer(audio) {
  const b64 = trim(audio?.data)
  const url = trim(audio?.url)
  if (b64) return { buffer: Buffer.from(b64, 'base64'), url: url || undefined }
  if (!url) throw new Error('BAILIAN_TTS_AUDIO_MISSING')
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) })
  if (!response.ok) throw new Error(`BAILIAN_TTS_AUDIO_DOWNLOAD_FAILED(${response.status})`)
  return { buffer: Buffer.from(await response.arrayBuffer()), url }
}
function normalizeAudioResult(buffer, format, requestId) {
  const mime = AUDIO_MIME[format] || 'audio/wav'
  return {
    provider: 'bailian',
    task_id: `bailian-sync-${randomUUID()}`,
    status: 'completed',
    outputs: [{ b64_json: `data:${mime};base64,${buffer.toString('base64')}`, media_type: 'audio', content_type: mime, format }],
    ...(requestId ? { request_id: requestId } : {}),
  }
}
async function synthesize(input) {
  const model = trim(input.model)
  if (!BAILIAN_AUDIO_MODELS.includes(model)) throw new Error(`未注册的语音模型：${model}`)
  const voice = trim(input.voice)
  const text = trim(input.input ?? input.prompt)
  if (!voice) throw new Error('voice 必填')
  if (!text) throw new Error('input 必填')
  const cosy = isCosyVoiceModel(model)
  const segments = splitTextByLimit(text, cosy ? COSYVOICE_MAX_CHARS : QWEN_MAX_CHARS)
  const buffers = []
  let format = 'wav'
  let lastRequestId
  for (const segment of segments) {
    const body = cosy
      ? buildCosyTtsBody({ model, text: segment, voice, format: trim(input.response_format) || 'wav', sampleRate: input.sample_rate ?? 24000, volume: input.volume, rate: input.speed, pitch: input.pitch, languageHints: trim(input.language_hints) || undefined, instruction: trim(input.instruction) || undefined })
      : buildQwenTtsBody({ model, text: segment, voice, languageType: trim(input.language_type) || 'Chinese' })
    const data = await postJson(cosy ? COSYVOICE_TTS_PATH : MULTIMODAL_TTS_PATH, body)
    if (!data.output?.audio) throw new Error('BAILIAN_TTS_OUTPUT_AUDIO_MISSING')
    const got = await fetchAudioBuffer(data.output.audio)
    buffers.push(got.buffer)
    format = cosy ? body.input.format : 'wav'
    if (trim(data.request_id)) lastRequestId = trim(data.request_id)
  }
  // 非 WAV 返回编码帧流，顺序拼接保留全部分段；时长仅 wav 可计算。
  const merged = format === 'wav' ? mergeWavBuffers(buffers) : Buffer.concat(buffers)
  return normalizeAudioResult(merged, format, lastRequestId)
}

function normalizeCustomizationResult(data, flavor) {
  const output = data.output || {}
  const voiceId = trim(output.voice) || trim(output.voice_id)
  return {
    success: true,
    voice_id: voiceId || undefined,
    target_model: trim(output.target_model) || undefined,
    status: trim(output.status) || undefined,
    preview: output.preview_audio?.data ? { data_base64: output.preview_audio.data, sample_rate: output.preview_audio.sample_rate, format: trim(output.preview_audio.response_format) || 'wav' } : undefined,
    request_id: trim(data.request_id) || undefined,
    flavor,
  }
}
function toDeleteError(error) {
  const message = String(error?.message || '')
  if (!message.startsWith('BAILIAN_REQUEST_FAILED(')) return error
  return new Error(message.replace('BAILIAN_REQUEST_FAILED', 'BAILIAN_VOICE_DELETE_FAILED'))
}
function normalizeVoiceRow(row, source) {
  return {
    voice_id: trim(row.voice_id) || trim(row.voice) || trim(row.voice_name),
    prefix: trim(row.prefix) || undefined,
    target_model: trim(row.target_model) || trim(row.model) || undefined,
    status: trim(row.status) || undefined,
    create_time: trim(row.create_time) || undefined,
    update_time: trim(row.update_time) || undefined,
    source,
  }
}
async function fetchVoiceList(model, action, source) {
  try {
    const data = await postJson(CUSTOMIZATION_PATH, { model, input: { action, page_size: 100 } }, { timeout: 20000 })
    const rows = data.output?.voices ?? data.output?.voice_list ?? []
    return rows.map((row) => normalizeVoiceRow(row, source)).filter((row) => row.voice_id)
  } catch {
    // 单个端点失败不阻塞另一路（移植 waoowaoo listBailianVoices 行为）
    return []
  }
}

export const bailian = {
  label: '阿里云百炼',
  credentialEnv: 'BAILIAN_API_KEY',
  catalog: { image: [], video: [], audio: BAILIAN_AUDIO_MODELS, music: [], asr: [] },
  capabilities: { text: false, image: false, video: false, audio: true, music: false, transcription: false, translation: false, voice_design: true, 'transform.lip-sync': false, 'transform.video-inpaint': false, 'transform.video-upscale': false },
  async models() { return { catalog: bailian.catalog } },
  async testConnection() {
    await postJson(CUSTOMIZATION_PATH, { model: 'voice-enrollment', input: { action: 'list_voice', page_size: 1 } }, { timeout: 20000 })
    return { ok: true }
  },
  async audio(input) {
    confirm(input)
    return synthesize(input)
  },
  async createVoiceDesign(input) {
    confirm(input)
    requireValid(validateVoicePrompt(input.voice_prompt))
    requireValid(validatePreviewText(input.preview_text))
    requireValid(validateVoicePrefix(trim(input.prefix) || 'cv'))
    const languageHints = trim(input.language_hints)
    if (languageHints && input.flavor !== 'qwen' && !languageHintsFor(input.target_model || 'cosyvoice-v3.5-plus').includes(languageHints)) throw new Error(`language_hints 不受目标模型支持：${languageHints}`)
    const { flavor, body } = buildDesignRequest(input)
    return normalizeCustomizationResult(await postJson(CUSTOMIZATION_PATH, body), flavor)
  },
  async createVoiceClone(input) {
    confirm(input)
    assertPublicHttps(input.url, 'audio_url')
    requireValid(validateVoicePrefix(trim(input.prefix) || 'clone'))
    const languageHints = trim(input.language_hints)
    if (languageHints && !languageHintsFor(input.target_model || 'cosyvoice-v3.5-plus').includes(languageHints)) throw new Error(`language_hints 不受目标模型支持：${languageHints}`)
    const { body } = buildCloneRequest(input)
    return normalizeCustomizationResult(await postJson(CUSTOMIZATION_PATH, body), 'cosyvoice-clone')
  },
  async listCloudVoices() {
    const [cosy, qwen] = await Promise.all([
      fetchVoiceList('voice-enrollment', 'list_voice', 'cosyvoice'),
      fetchVoiceList('qwen-voice-design', 'list', 'qwen'),
    ])
    return [...cosy, ...qwen]
  },
  async deleteCloudVoice(voiceId) {
    const id = trim(voiceId)
    if (!id) throw new Error('BAILIAN_VOICE_ID_REQUIRED')
    const { flavor, body } = buildDeleteRequest(id)
    let data
    try {
      data = await postJson(CUSTOMIZATION_PATH, body, { timeout: 20000 })
    } catch (error) { throw toDeleteError(error) }
    return { flavor, request_id: trim(data.request_id) || undefined }
  },
}

export async function selfCheck() {
  // 模型矩阵
  if (BAILIAN_AUDIO_MODELS.join(',') !== 'cosyvoice-v3.5-plus,cosyvoice-v3.5-flash,cosyvoice-v3-plus,cosyvoice-v3-flash,cosyvoice-v2,qwen3-tts-vd-2026-01-26') throw new Error('百炼模型目录或推荐顺序错误')
  if (languageHintsFor('cosyvoice-v2').join() !== 'zh,en') throw new Error('v2 语言矩阵错误')
  if (languageHintsFor('cosyvoice-v3-plus').length !== 7 || languageHintsFor('cosyvoice-v3.5-plus').length !== 11) throw new Error('语言矩阵错误')
  if (!supportsInstruction('cosyvoice-v3.5-plus') || supportsInstruction('cosyvoice-v3-plus') || !supportsInstruction('cosyvoice-v3-flash')) throw new Error('instruction 支持矩阵错误')
  if (inferModelFromVoiceId('cosyvoice-v3.5-plus-abc123') !== 'cosyvoice-v3.5-plus' || inferModelFromVoiceId('cosyvoice-v2') !== 'cosyvoice-v2' || inferModelFromVoiceId('longxiaochun') !== '') throw new Error('voiceId 前缀推断错误')
  if (weightedLength('a你') !== 3 || weightedLength('声'.repeat(25)) !== 50 || weightedLength('声'.repeat(26)) !== 52) throw new Error('中文加权长度错误')

  // 校验器
  if (validateVoicePrompt('  ').valid || !validateVoicePrompt('低沉女声').valid || validateVoicePrompt('a'.repeat(501)).valid) throw new Error('声音提示词校验错误')
  if (validatePreviewText('1234').valid || !validatePreviewText('你好，很高兴认识你。').valid || validatePreviewText('a'.repeat(201)).valid) throw new Error('预览文本校验错误')
  if (validateVoicePrefix('cv_1').valid || validateVoicePrefix('').valid || !validateVoicePrefix('cv01').valid) throw new Error('音色前缀校验错误')
  // SSRF 网关：非 https、localhost/.localhost、私网/环回/链路本地/元数据/保留 IP 字面量全部拒绝（不做 DNS 解析）
  const blockedUrls = [
    'http://example.com/a.wav', 'not-a-url', '',
    'https://localhost/a.wav', 'https://LocalHost./a.wav', 'https://example.localhost/a.wav',
    'https://127.0.0.1/a.wav', 'https://0x7f000001/a.wav', 'https://2130706433/a.wav',
    'https://0.0.0.0/a.wav', 'https://10.0.0.1/a.wav', 'https://192.168.1.1/a.wav', 'https://172.16.0.1/a.wav',
    'https://169.254.169.254/latest/meta-data/', 'https://100.64.0.1/a.wav',
    'https://[::1]/a.wav', 'https://[::]/a.wav', 'https://[fe80::1]/a.wav', 'https://[fc00::1]/a.wav',
    'https://[fd12::1]/a.wav', 'https://[ff02::1]/a.wav', 'https://[::ffff:127.0.0.1]/a.wav',
    'https://[::ffff:7f00:1]/a.wav', 'https://[::ffff:a9fe:a9fe]/a.wav', 'https://[::ffff:10.0.0.1]/a.wav',
  ]
  for (const blocked of blockedUrls) {
    try { assertPublicHttps(blocked, 'audio_url'); throw new Error(`私网 URL 未被拒绝：${blocked}`) }
    catch (error) { if (!String(error.message).includes('公网 HTTPS')) throw error }
  }
  for (const allowed of ['https://dashscope.aliyuncs.com/a.wav', 'https://8.8.8.8/a.wav', 'https://[2606:4700:4700::1111]/a.wav', 'https://[::ffff:8.8.8.8]/a.wav']) assertPublicHttps(allowed)
  try { assertPublicHttps(undefined); throw new Error('空 URL 校验失败') } catch (error) { if (!String(error.message).includes('公网 HTTPS')) throw error }

  // WAV 合并：44100 单声道 16bit，两段 100 samples
  const format = { audioFormat: 1, numChannels: 1, sampleRate: 44100, byteRate: 44100 * 2, blockAlign: 2, bitsPerSample: 16 }
  const pcmA = Buffer.alloc(200, 1)
  const pcmB = Buffer.alloc(300, 2)
  const wavA = buildWavBuffer(format, pcmA)
  const wavB = buildWavBuffer(format, pcmB)
  const merged = mergeWavBuffers([wavA, wavB])
  const decoded = decodeWavBuffer(merged)
  if (decoded.data.length !== 500 || decoded.format.sampleRate !== 44100) throw new Error('WAV 分段合并不正确')
  if (wavDurationMs(merged) !== Math.round(500 / 88200 * 1000)) throw new Error('WAV 时长计算错误')
  try { mergeWavBuffers([wavA, buildWavBuffer({ ...format, sampleRate: 24000 }, pcmB)]); throw new Error('WAV 格式不一致未被拒绝') } catch (error) { if (!String(error.message).includes('FORMAT_MISMATCH')) throw error }
  try { decodeWavBuffer(Buffer.from('not a wav file!!')); throw new Error('非法 WAV 未被拒绝') } catch (error) { if (!String(error.message).includes('INVALID_HEADER')) throw error }

  // 分段：291 字符，首窗口无标点则硬切 280，尾部 11 字符
  const longText = `${'x'.repeat(280)}。${'y'.repeat(10)}`
  const parts = splitTextByLimit(longText, 280)
  if (parts.length !== 2 || parts.some((p) => Array.from(p).length > 280) || parts.join('') !== longText) throw new Error('长文本分段错误')
  // 有标点时优先在标点处切：202 个字符处的 '！' 是窗口内最后一个提示位
  const hinted = splitTextByLimit(`${'a'.repeat(100)}。${'b'.repeat(100)}！${'c'.repeat(90)}`, 280)
  if (hinted.length !== 2 || Array.from(hinted[0]).length !== 202) throw new Error('标点优先分段错误')
  if (splitTextByLimit('  ').length !== 0 || splitTextByLimit('短句', 280).join() !== '短句') throw new Error('分段边界错误')

  // 请求体
  const cosy = buildCosyTtsBody({ model: 'cosyvoice-v3.5-plus', text: '你好', voice: 'cosyvoice-v3.5-plus-x', format: 'wav', sampleRate: 24000, volume: 80, rate: 1.2, pitch: 0.9, languageHints: 'zh', instruction: '冷静地说' })
  if (cosy.input.volume !== 80 || cosy.input.rate !== 1.2 || cosy.input.language_hints[0] !== 'zh' || cosy.input.instruction !== '冷静地说') throw new Error('CosyVoice 请求体错误')
  try { buildCosyTtsBody({ model: 'cosyvoice-v3.5-plus', text: 'x', voice: 'longxiaochun', format: 'wav', sampleRate: 24000 }); throw new Error('v3.5 预置音色未被拒绝') } catch (error) { if (!String(error.message).includes('CUSTOM_VOICE_REQUIRED')) throw error }
  try { buildCosyTtsBody({ model: 'cosyvoice-v2', text: 'x', voice: 'cosyvoice-v2-x', format: 'wav', sampleRate: 24000, languageHints: 'ja' }); throw new Error('v2 日语未被拒绝') } catch (error) { if (!String(error.message).includes('language_hints 不受')) throw error }
  try { buildCosyTtsBody({ model: 'cosyvoice-v3-plus', text: 'x', voice: 'cosyvoice-v3-plus-x', format: 'wav', sampleRate: 24000, instruction: '说' }); throw new Error('v3-plus instruction 未被拒绝') } catch (error) { if (!String(error.message).includes('INSTRUCTION_UNSUPPORTED')) throw error }
  const qwen = buildQwenTtsBody({ model: QWEN_TTS_MODEL, text: '你好', voice: 'custom_voice', languageType: 'Chinese' })
  if (qwen.input.language_type !== 'Chinese') throw new Error('qwen 请求体错误')

  const design = buildDesignRequest({ flavor: 'cosyvoice-design', voice_prompt: '低沉', preview_text: '你好世界。', prefix: 'cv', target_model: 'cosyvoice-v2' })
  if (design.body.model !== 'voice-enrollment' || design.body.input.action !== 'create_voice' || design.body.input.target_model !== 'cosyvoice-v2' || design.body.input.prefix !== 'cv') throw new Error('CosyVoice 设计请求体错误')
  const qwenDesign = buildDesignRequest({ flavor: 'qwen', voice_prompt: '低沉', preview_text: '你好世界。', prefix: 'ignored', preferred_name: 'n', language: 'en' })
  if (qwenDesign.body.model !== 'qwen-voice-design' || qwenDesign.body.input.target_model !== QWEN_TTS_MODEL || qwenDesign.body.input.language !== 'en') throw new Error('qwen 设计请求体错误')
  const clone = buildCloneRequest({ url: 'https://example.com/a.wav', prefix: 'cl', max_prompt_audio_length: 25, enable_preprocess: true })
  if (clone.body.input.url !== 'https://example.com/a.wav' || clone.body.input.max_prompt_audio_length !== 25 || clone.body.input.enable_preprocess !== true) throw new Error('克隆请求体错误')
  if (buildCloneRequest({ url: 'u', prefix: 'cl' }).body.input.max_prompt_audio_length !== 10) throw new Error('克隆参考时长默认值错误')
  if (buildDeleteRequest('cosyvoice-v2-x').flavor !== 'cosyvoice' || buildDeleteRequest('qwenvoice').flavor !== 'qwen') throw new Error('删除 flavor 分流错误')

  // audio 结果归一化
  const result = normalizeAudioResult(Buffer.from([1, 2, 3]), 'mp3', 'req-1')
  if (result.provider !== 'bailian' || result.status !== 'completed' || !result.outputs[0].b64_json.startsWith('data:audio/mpeg;base64,') || result.outputs[0].format !== 'mp3' || !result.task_id.startsWith('bailian-sync-')) throw new Error('audio 结果归一化错误')
  if (!result.outputs[0].b64_json.includes(Buffer.from([1, 2, 3]).toString('base64'))) throw new Error('audio base64 内容错误')
  // HTTP 错误归一化（spec §6：稳定 code + 截断 500）
  const httpError = normalizeHttpError(401, { code: 'InvalidApiKey', message: 'bad key' }, '')
  if (httpError.message !== 'BAILIAN_REQUEST_FAILED(401): InvalidApiKey: bad key') throw new Error('HTTP 错误归一化错误')
  const truncated = normalizeHttpError(500, { message: 'x'.repeat(600) }, '')
  if (!truncated.message.startsWith('BAILIAN_REQUEST_FAILED(500): ') || truncated.message.length !== 'BAILIAN_REQUEST_FAILED(500): '.length + 500) throw new Error('HTTP 错误截断错误')
  if (normalizeHttpError(502, {}, 'raw body').message !== 'BAILIAN_REQUEST_FAILED(502): raw body') throw new Error('HTTP 错误 raw 回退错误')

  // postJson：HTTP 状态先于 JSON 校验，非 JSON 错误体回退原文（fetch 打桩，不触网）
  const previousFetch = globalThis.fetch
  const previousApiKey = process.env.BAILIAN_API_KEY
  process.env.BAILIAN_API_KEY = 'self-check-key'
  try {
    globalThis.fetch = async () => ({ ok: false, status: 502, text: async () => 'Bad Gateway page' })
    try { await postJson('/x', {}); throw new Error('502 纯文本错误体未被归一化') }
    catch (error) { if (error.message !== 'BAILIAN_REQUEST_FAILED(502): Bad Gateway page') throw error }

    globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => 'not-json{' })
    try { await postJson('/x', {}); throw new Error('2xx 非 JSON 响应体未被拒绝') }
    catch (error) { if (error.message !== 'BAILIAN_RESPONSE_INVALID_JSON') throw error }

    globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '{"request_id":"x"}' })
    const okData = await postJson('/x', {})
    if (okData.request_id !== 'x') throw new Error('postJson 正常响应解析错误')

    globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '' })
    const emptyData = await postJson('/x', {})
    if (Object.keys(emptyData).length !== 0) throw new Error('postJson 空响应体应归一化为零键对象')

    // audio() 默认付费主路径：确认门前零 fetch、双分段 WAV 合并、audio.data/audio.url 两分支（全部打桩）
    const ttsUrl = `${DASHSCOPE_BASE}${COSYVOICE_TTS_PATH}`
    const audioOkUrl = 'https://audio.example.com/seg.wav'
    const audioBadUrl = 'https://audio.example.com/bad.wav'
    let synthCalls = 0
    let fetchCalls = 0
    globalThis.fetch = async (url) => {
      fetchCalls += 1
      const href = String(url)
      if (href === audioOkUrl) return new Response(Buffer.from(wavA), { status: 200, headers: { 'content-type': 'audio/wav' } })
      if (href === audioBadUrl) return new Response('Bad Gateway', { status: 502 })
      if (href !== ttsUrl) throw new Error(`audio 自检遇到未桩接 URL：${href}`)
      synthCalls += 1
      if (synthCalls <= 2) {
        const wav = synthCalls === 1 ? wavA : wavB
        return new Response(JSON.stringify({ output: { audio: { data: wav.toString('base64') } }, request_id: `req-seg-${synthCalls}` }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (synthCalls === 3) return new Response(JSON.stringify({ output: { audio: { url: audioOkUrl } }, request_id: 'req-url-ok' }), { status: 200, headers: { 'content-type': 'application/json' } })
      return new Response(JSON.stringify({ output: { audio: { url: audioBadUrl } }, request_id: 'req-url-bad' }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    try { await bailian.audio({ model: 'cosyvoice-v3.5-plus', voice: 'cosyvoice-v3.5-plus-x', input: '不应发出的请求' }); throw new Error('audio 未确认仍被执行') }
    catch (error) { if (!String(error.message).includes('confirmed=true')) throw error }
    if (fetchCalls !== 0) throw new Error('付费确认门前不得发生任何 fetch')
    const segmented = await bailian.audio({ model: 'cosyvoice-v3.5-plus', voice: 'cosyvoice-v3.5-plus-x', input: longText, confirmed: true })
    if (synthCalls !== 2) throw new Error('长文本应触发两个 TTS 分段请求')
    const segmentedWav = decodeWavBuffer(Buffer.from(String(segmented.outputs[0].b64_json).split(',')[1], 'base64'))
    if (segmentedWav.data.length !== 500 || segmented.request_id !== 'req-seg-2') throw new Error('双分段 WAV 合并 PCM 长度或末次 request_id 错误')
    const urlOk = await bailian.audio({ model: 'cosyvoice-v3.5-plus', voice: 'cosyvoice-v3.5-plus-x', input: 'url 成功分支短句', confirmed: true })
    if (decodeWavBuffer(Buffer.from(String(urlOk.outputs[0].b64_json).split(',')[1], 'base64')).data.length !== 200 || urlOk.request_id !== 'req-url-ok') throw new Error('audio.url 成功分支结果错误')
    try {
      await bailian.audio({ model: 'cosyvoice-v3.5-plus', voice: 'cosyvoice-v3.5-plus-x', input: 'url 失败分支短句', confirmed: true })
      throw new Error('audio.url 非 2xx 未被拒绝')
    } catch (error) { if (!String(error.message).includes('BAILIAN_TTS_AUDIO_DOWNLOAD_FAILED(502)')) throw error }
  } finally {
    globalThis.fetch = previousFetch
    if (previousApiKey === undefined) delete process.env.BAILIAN_API_KEY
    else process.env.BAILIAN_API_KEY = previousApiKey
  }

  // 定制化响应归一化
  const designed = normalizeCustomizationResult({ output: { voice_id: 'cosyvoice-v3.5-plus-x', target_model: 'cosyvoice-v3.5-plus', status: 'OK', preview_audio: { data: 'AAA=', sample_rate: 24000, response_format: 'wav' } }, request_id: 'r1' }, 'cosyvoice-design')
  if (designed.success !== true || designed.voice_id !== 'cosyvoice-v3.5-plus-x' || designed.preview?.data_base64 !== 'AAA=' || designed.flavor !== 'cosyvoice-design') throw new Error('设计响应归一化错误')
  const cloned = normalizeCustomizationResult({ output: { voice: 'clone-x' } }, 'cosyvoice-clone')
  if (cloned.voice_id !== 'clone-x' || cloned.preview !== undefined) throw new Error('克隆响应归一化错误')
  if (normalizeCustomizationResult({ output: {} }, 'cosyvoice-clone').voice_id) throw new Error('空 voiceId 归一化错误')
  if (normalizeVoiceRow({ voice: 'cosyvoice-v2-a', prefix: 'p', target_model: 'cosyvoice-v2' }, 'cosyvoice').voice_id !== 'cosyvoice-v2-a') throw new Error('云端音色行归一化错误')
  // 删除失败专用 code（spec §4.1：BAILIAN_VOICE_DELETE_FAILED），非 HTTP 错误原样透传
  const deleteError = toDeleteError(new Error('BAILIAN_REQUEST_FAILED(400): InvalidVoice: gone'))
  if (deleteError.message !== 'BAILIAN_VOICE_DELETE_FAILED(400): InvalidVoice: gone') throw new Error('删除错误归一化错误')
  const networkError = new Error('fetch failed')
  if (toDeleteError(networkError) !== networkError) throw new Error('非 HTTP 删除错误不应包装')
}

if (import.meta.url === `file://${process.argv[1]}`) { selfCheck().then(() => console.log('ok')).catch((error) => { console.error(error.message); process.exitCode = 1 }) }
