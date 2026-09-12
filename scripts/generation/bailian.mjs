#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
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
export function assertPublicHttps(value, field = 'url') {
  const url = new URL(value)
  if (url.protocol !== 'https:' || ['localhost', '127.0.0.1', '::1'].includes(url.hostname)) throw new Error(`${field} 必须是公网 HTTPS URL`)
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

export function selfCheck() {
  // 模型矩阵
  if (BAILIAN_AUDIO_MODELS.length !== 6 || BAILIAN_AUDIO_MODELS[0] !== 'cosyvoice-v3.5-plus') throw new Error('百炼模型目录或推荐顺序错误')
  if (languageHintsFor('cosyvoice-v2').join() !== 'zh,en') throw new Error('v2 语言矩阵错误')
  if (languageHintsFor('cosyvoice-v3-plus').length !== 7 || languageHintsFor('cosyvoice-v3.5-plus').length !== 11) throw new Error('语言矩阵错误')
  if (!supportsInstruction('cosyvoice-v3.5-plus') || supportsInstruction('cosyvoice-v3-plus') || !supportsInstruction('cosyvoice-v3-flash')) throw new Error('instruction 支持矩阵错误')
  if (inferModelFromVoiceId('cosyvoice-v3.5-plus-abc123') !== 'cosyvoice-v3.5-plus' || inferModelFromVoiceId('cosyvoice-v2') !== 'cosyvoice-v2' || inferModelFromVoiceId('longxiaochun') !== '') throw new Error('voiceId 前缀推断错误')
  if (weightedLength('a你') !== 3) throw new Error('instruction 加权长度错误')

  // 校验器
  if (validateVoicePrompt('  ').valid || !validateVoicePrompt('低沉女声').valid || validateVoicePrompt('a'.repeat(501)).valid) throw new Error('声音提示词校验错误')
  if (validatePreviewText('1234').valid || !validatePreviewText('你好，很高兴认识你。').valid || validatePreviewText('a'.repeat(201)).valid) throw new Error('预览文本校验错误')
  if (validateVoicePrefix('cv_1').valid || validateVoicePrefix('').valid || !validateVoicePrefix('cv01').valid) throw new Error('音色前缀校验错误')
  try { assertPublicHttps('http://x.com/a'); throw new Error('私网 URL 校验失败') } catch (error) { if (!String(error.message).includes('公网 HTTPS')) throw error }
  try { assertPublicHttps('https://127.0.0.1/a'); throw new Error('localhost URL 校验失败') } catch (error) { if (!String(error.message).includes('公网 HTTPS')) throw error }

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
}

if (import.meta.url === `file://${process.argv[1]}`) { selfCheck(); console.log('ok') }
