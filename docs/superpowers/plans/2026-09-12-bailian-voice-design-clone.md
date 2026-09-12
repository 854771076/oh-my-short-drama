# 百炼声音设计/克隆接入插件 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把阿里云百炼（DashScope）作为默认推荐配音 Provider 接入短剧插件：6 个 TTS 模型走现有 `generate_audio`，新增 `design_voice`/`clone_voice`/`list_voices`/`delete_voice` 四个 MCP 工具与项目级音色登记。

**Architecture:** 仿 `starrouter.mjs` 新增纯 ESM adapter `scripts/generation/bailian.mjs`（HTTP + 纯函数算法，无项目文件操作），注册进 `providers.mjs`；新增 `scripts/voice-ledger.mjs`（`.short-drama/voices.json`）和 `scripts/generation/voice-tools.mjs`（项目校验 + 托管 + 账本编排）；克隆参考音频复用 litterbox 收据体系，发布逻辑在 `media-hosting/publish.mjs` 泛化出音频分支；四个工具在 `mcp.mjs` 声明 schema 并分发，不走阶段门禁和任务账本。

**Tech Stack:** Node 内置 `fetch`/`FormData`/`Buffer`，零 npm 依赖；仓库测试约定为每模块导出纯函数 `selfCheck()` + 底部 `--self-check` CLI 守卫，统一由 `node scripts/integration-self-check.mjs --self-check` 汇总。

**Spec:** `docs/superpowers/specs/2026-09-12-bailian-voice-design-clone-design.md`（实现时同时阅读 spec 与本计划；API 合同以 spec §3 为准）

## Global Constraints

- 不引入任何 npm 依赖，只用 Node 内置模块；脚本为 ESM（`.mjs`）。
- 凭证只从环境变量或 `~/.config/oh-my-short-drama/credentials.json` 读取（走 `credentials.mjs` 的 `credential(name)`），新增凭证名固定 `BAILIAN_API_KEY`；绝不写入项目。
- 面向用户的错误信息用中文，Provider 错误归一化为 `BAILIAN_REQUEST_FAILED(<status>): <code>: <message>`（截断 500 字符）。
- 付费操作（audio/design/clone/delete）必须校验 `confirmed === true`；克隆额外强制 `rights_confirmed/public_exposure_confirmed/usage_terms_confirmed` 三个 const true 和显式 `usage_scope`。
- 出站给百炼的 URL 必须是公网 HTTPS（拒绝 localhost/127.0.0.1/::1）；本地文件只能来自当前项目 `assets/`（realpath containment）。
- 每个新模块必须导出 `selfCheck()` 并加 `--self-check` CLI 守卫；selfCheck 不得发起真实网络请求。
- TDD 节奏：每个任务先写 selfCheck 断言并跑出失败，再写实现；提交粒度为一个任务一次 commit，消息用 `feat:`/`refactor:` 前缀，结尾加 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。
- 模型推荐顺序：`cosyvoice-v3.5-plus` → `cosyvoice-v3.5-flash` → `cosyvoice-v3-plus` → `cosyvoice-v3-flash` → `cosyvoice-v2` → `qwen3-tts-vd-2026-01-26`。

---

### Task 1: bailian.mjs 纯函数核心（模型矩阵、校验、WAV 合并、分段、请求体构造）

**Files:**
- Create: `scripts/generation/bailian.mjs`

**Interfaces:**
- Consumes: `scripts/generation/credentials.mjs` 的 `credential(name)`（本任务仅 import，不实际取 key）。
- Produces（后续任务与 selfCheck 依赖，名称/签名冻结）：
  - 常量：`QWEN_TTS_MODEL`、`COSYVOICE_MODELS`(5 元素数组)、`BAILIAN_AUDIO_MODELS`(6 元素数组)、`BAILIAN_COSYVOICE_LANGUAGE_HINTS`(11 元素数组)
  - `isCosyVoiceModel(model: string): boolean`
  - `languageHintsFor(model: string): string[]`（v2 返回 zh/en；v3-plus 返回 7 种；其余 cosy 模型返回 11 种；非 cosy 返回 `[]`）
  - `supportsInstruction(model: string): boolean`
  - `inferModelFromVoiceId(voiceId: string): string`（voiceId 等于模型或以 `<model>-` 开头则返回该模型，否则 `''`）
  - `weightedLength(text: string): number`（汉字计 2，其余计 1）
  - `validateVoicePrompt(value): {valid, error?}`、`validatePreviewText(value): {valid, error?}`、`validateVoicePrefix(value): {valid, error?}`
  - `assertPublicHttps(value: string, field?: string): string`
  - WAV：`decodeWavBuffer(buf): {format, data}`、`buildWavBuffer(format, pcm): Buffer`、`mergeWavBuffers(buffers: Buffer[]): Buffer`、`wavDurationMs(buf): number`
  - `splitTextByLimit(text: string, maxChars: number): string[]`
  - `buildCosyTtsBody(input): object`、`buildQwenTtsBody(input): object`
  - `buildDesignRequest(input): {flavor, body}`、`buildCloneRequest(input): {flavor, body}`、`buildDeleteRequest(voiceId): {flavor, body}`
  - `selfCheck(): void`

- [ ] **Step 1: 创建文件，先写 selfCheck（此时全部失败）**

创建 `scripts/generation/bailian.mjs`，先放 import、常量和完整 selfCheck：

```js
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
```

- [ ] **Step 2: 运行，确认失败**

Run: `node scripts/generation/bailian.mjs --self-check`
Expected: 失败（`ReferenceError: languageHintsFor is not defined` 等）。

- [ ] **Step 3: 在 selfCheck 之前实现全部纯函数**

```js
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
  if (buffer.length < 44) throw new Error('BAILIAN_TTS_WAV_TOO_SHORT')
  if (buffer.subarray(0, 4).toString('ascii') !== 'RIFF' || buffer.subarray(8, 12).toString('ascii') !== 'WAVE') throw new Error('BAILIAN_TTS_WAV_INVALID_HEADER')
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
  output.writeUInt16(format.audioFormat, 20)
  output.writeUInt16(format.numChannels, 22)
  output.writeUInt32LE(format.sampleRate, 24)
  output.writeUInt32LE(format.byteRate, 28)
  output.writeUInt16(format.blockAlign, 32)
  output.writeUInt16(format.bitsPerSample, 34)
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
```

- [ ] **Step 4: 运行 selfCheck，确认通过**

Run: `node scripts/generation/bailian.mjs --self-check`
Expected: 输出 `ok`。

- [ ] **Step 5: Commit**

```bash
git add scripts/generation/bailian.mjs
git commit -m "feat: 新增百炼 adapter 纯函数核心（模型矩阵/WAV/分段/请求体）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: bailian.mjs HTTP 层——语音合成 audio()、models()、testConnection()

**Files:**
- Modify: `scripts/generation/bailian.mjs`

**Interfaces:**
- Consumes: Task 1 的常量与纯函数；`credential('BAILIAN_API_KEY')`。
- Produces：
  - `bailian` adapter 对象（本任务先含 `label/credentialEnv/catalog/capabilities/models/testConnection/audio`；Task 3 再加声音管理方法）
  - `postJson(path, body, options?)`（模块内函数，Task 3 复用）

- [ ] **Step 1: 扩展 selfCheck——audio 结果归一化与缺凭证保护**

在 `selfCheck()` 末尾（CLI 守卫之前）追加：

```js
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
```

- [ ] **Step 2: 运行，确认失败**

Run: `node scripts/generation/bailian.mjs --self-check`
Expected: `ReferenceError: normalizeAudioResult is not defined`。

- [ ] **Step 3: 实现 HTTP 基础设施与 audio()**

在 Task 1 的纯函数之后、`selfCheck` 之前追加：

```js
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
  try { data = raw ? JSON.parse(raw) : {} } catch { throw new Error('BAILIAN_RESPONSE_INVALID_JSON') }
  if (!response.ok) throw normalizeHttpError(response.status, data, raw)
  return data
}
async function fetchAudioBuffer(audio) {
  const b64 = trim(audio?.data)
  const url = trim(audio?.url)
  if (b64) return { buffer: Buffer.from(b64, 'base64'), url: url || undefined }
  if (!url) throw new Error('BAILIAN_TTS_AUDIO_MISSING')
  const response = await fetch(url)
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

export const bailian = {
  label: '阿里云百炼',
  credentialEnv: 'BAILIAN_API_KEY',
  catalog: { image: [], video: [], audio: BAILIAN_AUDIO_MODELS, music: [], asr: [] },
  capabilities: { text: false, image: false, video: false, audio: true, music: false, transcription: false, translation: false, voice_design: true },
  async models() { return { catalog: bailian.catalog } },
  async testConnection() {
    await postJson(CUSTOMIZATION_PATH, { model: 'voice-enrollment', input: { action: 'list_voice', page_size: 1 } }, { timeout: 20000 })
    return { ok: true }
  },
  async audio(input) {
    confirm(input)
    return synthesize(input)
  },
}
```

- [ ] **Step 4: 运行 selfCheck，确认通过**

Run: `node scripts/generation/bailian.mjs --self-check`
Expected: `ok`。

- [ ] **Step 5: Commit**

```bash
git add scripts/generation/bailian.mjs
git commit -m "feat: 百炼 adapter 接入 CosyVoice/qwen TTS 同步合成

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: bailian.mjs 声音管理——设计/克隆/列表/删除

**Files:**
- Modify: `scripts/generation/bailian.mjs`

**Interfaces:**
- Produces（`bailian` 对象上的新方法，Task 6 直接调用）：
  - `bailian.createVoiceDesign(input): Promise<{success:true, voice_id, target_model, status, preview?: {data_base64, sample_rate, format}, request_id, flavor}>`
  - `bailian.createVoiceClone(input): Promise<同上>`（preview 可缺；非 2xx 由 postJson 抛 `BAILIAN_REQUEST_FAILED`）
  - `bailian.listCloudVoices(): Promise<Array<{voice_id, prefix?, target_model?, status?, create_time?, update_time?, source:'cosyvoice'|'qwen'}>>`
  - `bailian.deleteCloudVoice(voiceId): Promise<{flavor:'cosyvoice'|'qwen', request_id?}>`；HTTP 非 2xx 改写为 `BAILIAN_VOICE_DELETE_FAILED(<status>): …`，其它错误原样抛

- [ ] **Step 1: 扩展 selfCheck——响应归一化**

在 `selfCheck()` 末尾追加：

```js
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
```

- [ ] **Step 2: 运行，确认失败**

Run: `node scripts/generation/bailian.mjs --self-check`
Expected: `ReferenceError: normalizeCustomizationResult is not defined`。

- [ ] **Step 3: 实现四个方法并挂到 bailian 对象**

在 `normalizeAudioResult` 之后、`export const bailian` 之前插入：

```js
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
```

在 `bailian` 对象内 `audio` 方法之后追加四个方法（注意在对象字面量里加逗号）：

```js
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
```

- [ ] **Step 4: 运行 selfCheck，确认通过**

Run: `node scripts/generation/bailian.mjs --self-check`
Expected: `ok`。

- [ ] **Step 5: Commit**

```bash
git add scripts/generation/bailian.mjs
git commit -m "feat: 百炼 adapter 支持声音设计/克隆/列表/删除

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 项目级音色登记 voice-ledger.mjs

**Files:**
- Create: `scripts/voice-ledger.mjs`

**Interfaces:**
- Consumes: `scripts/file-lock.mjs` 的 `withFileLock(target, action, opts)`（target 是文件路径，锁为 `<target>.lock`）。
- Produces：
  - `readVoiceLedger(rootArg): Promise<{version:1, voices: VoiceEntry[]}>`（文件不存在返回空骨架；JSON 损坏抛错）
  - `addVoiceEntry(rootArg, entry): Promise<VoiceEntry>`（同 voice_id 覆盖更新）
  - `removeVoiceEntry(rootArg, voiceId): Promise<VoiceEntry | null>`
  - `findVoiceEntry(rootArg, voiceId): Promise<VoiceEntry | null>`（spec §4.4 要求的只读查询）
  - `safeVoiceFileId(voiceId): string`
  - `previewRelativePath(voiceId, format?): string`（返回 `.short-drama/voice-previews/<safe>.<format||'wav'>`）
  - `VoiceEntry = {voice_id, flavor, target_model, prefix, name, source:'design'|'clone', preview_path: string|null, upload_receipt_id: string|null, request_id: string|null, created_at: string}`
  - `selfCheck()`

- [ ] **Step 1: 创建文件，先写 selfCheck**

```js
#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { withFileLock } from './file-lock.mjs'

const LEDGER_RELATIVE = '.short-drama/voices.json'
const REQUIRED_FIELDS = ['voice_id', 'flavor', 'target_model', 'source', 'created_at']

function ledgerPath(root) { return resolve(root, LEDGER_RELATIVE) }
function emptyLedger() { return { version: 1, voices: [] } }
export function safeVoiceFileId(voiceId) { return String(voiceId).replace(/[^A-Za-z0-9._-]/g, '_') }
export function previewRelativePath(voiceId, format) { return `.short-drama/voice-previews/${safeVoiceFileId(voiceId)}.${format || 'wav'}` }

export async function readVoiceLedger(rootArg) {
  const root = await realpath(resolve(rootArg))
  let raw
  try { raw = await readFile(ledgerPath(root), 'utf8') } catch (error) { if (error?.code === 'ENOENT') return emptyLedger(); throw error }
  const data = JSON.parse(raw)
  if (!data || typeof data !== 'object' || data.version !== 1 || !Array.isArray(data.voices)) throw new Error('voices.json 形状损坏')
  return data
}
async function writeVoiceLedger(root, data) {
  const path = ledgerPath(root)
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`)
  await rename(temporary, path)
}
function normalizeEntry(entry) {
  for (const field of REQUIRED_FIELDS) if (!entry?.[field]) throw new Error(`音色登记缺少字段：${field}`)
  if (!['design', 'clone'].includes(entry.source)) throw new Error('音色来源无效')
  return {
    voice_id: String(entry.voice_id),
    flavor: String(entry.flavor),
    target_model: String(entry.target_model),
    prefix: entry.prefix ? String(entry.prefix) : null,
    name: entry.name ? String(entry.name) : null,
    source: entry.source,
    preview_path: entry.preview_path ? String(entry.preview_path) : null,
    upload_receipt_id: entry.upload_receipt_id ? String(entry.upload_receipt_id) : null,
    request_id: entry.request_id ? String(entry.request_id) : null,
    created_at: entry.created_at,
  }
}
export async function addVoiceEntry(rootArg, entry) {
  const root = await realpath(resolve(rootArg))
  const normalized = normalizeEntry(entry)
  const lockKey = createHash('sha256').update('voice-ledger').digest('hex')
  await withFileLock(resolve(root, '.short-drama', 'locks', `voice-ledger-${lockKey}`), async () => {
    const ledger = await readVoiceLedger(root)
    ledger.voices = ledger.voices.filter((item) => item.voice_id !== normalized.voice_id)
    ledger.voices.push(normalized)
    await writeVoiceLedger(root, ledger)
  })
  return normalized
}
export async function removeVoiceEntry(rootArg, voiceId) {
  const root = await realpath(resolve(rootArg))
  let removed = null
  const lockKey = createHash('sha256').update('voice-ledger').digest('hex')
  await withFileLock(resolve(root, '.short-drama', 'locks', `voice-ledger-${lockKey}`), async () => {
    const ledger = await readVoiceLedger(root)
    const match = ledger.voices.find((item) => item.voice_id === voiceId)
    if (match) {
      removed = match
      ledger.voices = ledger.voices.filter((item) => item.voice_id !== voiceId)
      await writeVoiceLedger(root, ledger)
    }
  })
  return removed
}
export async function findVoiceEntry(rootArg, voiceId) {
  return (await readVoiceLedger(rootArg)).voices.find((item) => item.voice_id === voiceId) || null
}

export async function selfCheck() {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), 'short-drama-voice-ledger-')))
  try {
    await mkdir(resolve(root, '.short-drama'), { recursive: true })
    const empty = await readVoiceLedger(root)
    if (empty.version !== 1 || empty.voices.length !== 0) throw new Error('空账本形状错误')
    const now = new Date().toISOString()
    const entry = { voice_id: 'cosyvoice-v3.5-plus-a/b', flavor: 'cosyvoice-design', target_model: 'cosyvoice-v3.5-plus', prefix: 'cv', name: 'cv', source: 'design', preview_path: null, upload_receipt_id: null, request_id: 'r1', created_at: now }
    await addVoiceEntry(root, entry)
    if (safeVoiceFileId('cosyvoice-v3.5-plus-a/b') !== 'cosyvoice-v3.5-plus-a_b') throw new Error('文件名消毒错误')
    if (previewRelativePath('x', 'mp3') !== '.short-drama/voice-previews/x.mp3') throw new Error('预览路径错误')
    if ((await readVoiceLedger(root)).voices.length !== 1) throw new Error('音色登记写入失败')
    await addVoiceEntry(root, { ...entry, request_id: 'r2' })
    if ((await readVoiceLedger(root)).voices.length !== 1 || (await readVoiceLedger(root)).voices[0].request_id !== 'r2') throw new Error('同 voice_id 覆盖失败')
    const removed = await removeVoiceEntry(root, entry.voice_id)
    if (removed?.voice_id !== entry.voice_id || (await readVoiceLedger(root)).voices.length !== 0) throw new Error('音色登记删除失败')
    if (await removeVoiceEntry(root, 'missing') !== null) throw new Error('删除不存在音色应返回 null')
    await addVoiceEntry(root, entry)
    if ((await findVoiceEntry(root, entry.voice_id))?.voice_id !== entry.voice_id || await findVoiceEntry(root, 'missing') !== null) throw new Error('findVoiceEntry 查询错误')
    await writeFile(resolve(root, '.short-drama', 'voices.json'), '{broken json\n')
    let corruptRejected = false
    try { await readVoiceLedger(root) } catch (error) { if (!String(error.message).includes('形状损坏')) throw error; corruptRejected = true }
    if (!corruptRejected) throw new Error('损坏 JSON 未被拒绝')
    await writeFile(resolve(root, '.short-drama', 'voices.json'), `${JSON.stringify({ version: 1, voices: [] })}\n`)
    await removeVoiceEntry(root, entry.voice_id)
    let missingRejected = false
    try { await addVoiceEntry(root, { voice_id: 'x' }) } catch (error) { if (!String(error.message).includes('缺少字段')) throw error; missingRejected = true }
    if (!missingRejected) throw new Error('缺字段登记未被拒绝')
  } finally { await rm(root, { recursive: true, force: true }) }
}

if (import.meta.url === `file://${process.argv[1]}`) { selfCheck().then(() => console.log('ok')) }
```

- [ ] **Step 2: 运行 selfCheck 确认通过**

Run: `node scripts/voice-ledger.mjs --self-check`
Expected: `ok`。

- [ ] **Step 3: Commit**

```bash
git add scripts/voice-ledger.mjs
git commit -m "feat: 新增项目级音色登记账本 voices.json

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 媒体托管支持音频（litterbox 能力 + publish.mjs 音频分支）

**Files:**
- Modify: `scripts/media-hosting/litterbox.mjs:8`
- Modify: `scripts/media-hosting/publish.mjs`

**Interfaces:**
- Consumes: `mediaHost(input.service)` 返回的 host，其 `capabilities.media_types` 将包含 `'image'|'audio'`；`host.upload(path, expiry, fetchImpl)`。
- Produces：
  - `publishReferenceMedia(rootArg, input, mediaType: 'image'|'audio', fetchImpl?): Promise<receipt>`（image 行为与现 `publishReferenceImage` 完全一致；audio 入参为 `{service, local_path(绝对路径), expires_in, usage_scope, confirmed, rights_confirmed, public_exposure_confirmed, usage_terms_confirmed}`，收据 `media_type:'audio'`，无 asset_key/version_id）
  - `publishReferenceImage` 保留导出，变为薄包装。
  - `sniffAudioKind(path): Promise<string>`（模块内函数，返回扩展名或抛错）

- [ ] **Step 1: litterbox 能力加 audio**

`scripts/media-hosting/litterbox.mjs:8` 改为：

```js
export const capabilities = { media_types: ['image', 'audio'], anonymous: true, free: true, expiries: [...EXPIRIES], max_bytes: 1024 ** 3, permanent: false }
```

同文件 `selfCheck` 中能力合同断言改为：

```js
  if (capabilities.media_types.join() !== 'image,audio' || capabilities.expiries.join(',') !== '1h,12h,24h,72h' || capabilities.permanent !== false) throw new Error('Litterbox 能力合同自检失败')
```

Run: `node scripts/media-hosting/litterbox.mjs --self-check`
Expected: `ok`。

- [ ] **Step 2: 在 publish.mjs 写音频嗅探函数与 selfCheck（先失败）**

现有 import 已含 `open`（第 3 行）与 `relative`（第 4 行），只需把第 4 行的 node:path import 并入 `extname`：

```js
import { dirname, extname, relative, resolve, sep } from 'node:path'
```

文件顶部再补两个 selfCheck 用的同步 import：

```js
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir as osTmpdir } from 'node:os'
```

在 `assertImage` 函数之后新增常量与导出的嗅探函数（魔数与扩展名必须一致；ftyp 同时接受 .m4a/.aac）：

```js
const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.flac', '.webm'])
const AUDIO_SNIFF_MATCH = { '.wav': new Set(['.wav']), '.mp3': new Set(['.mp3']), '.ogg': new Set(['.ogg']), '.flac': new Set(['.flac']), '.webm': new Set(['.webm']), '.m4a': new Set(['.m4a', '.aac']) }

export async function sniffAudioKind(path) {
  const handle = await open(path, 'r')
  try {
    const bytes = Buffer.alloc(12)
    const { bytesRead } = await handle.read(bytes, 0, 12, 0)
    const head = bytes.subarray(0, bytesRead)
    const ascii = head.toString('ascii')
    if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE') return '.wav'
    if (ascii.startsWith('fLaC')) return '.flac'
    if (ascii.startsWith('OggS')) return '.ogg'
    if (ascii.startsWith('ID3') || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) return '.mp3'
    if (ascii.slice(4, 8) === 'ftyp') return '.m4a'
    if (head.subarray(0, 4).toString('hex') === '1a45dfa3') return '.webm'
    throw new Error('待发布文件内容不是受支持的 WAV/MP3/M4A/AAC/OGG/FLAC/WebM 音频')
  } finally { await handle.close() }
}
```

文件末尾追加（该文件目前没有 selfCheck/CLI 守卫，本步新增）：

```js
export async function selfCheck() {
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(32)])
  const ogg = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(8)])
  const id3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(9)])
  const ftyp = Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.alloc(8)])
  const dir = mkdtempSync(resolve(osTmpdir(), 'short-drama-audio-sniff-'))
  try {
    for (const [name, buffer, expected] of [['a.wav', wav, '.wav'], ['a.ogg', ogg, '.ogg'], ['a.mp3', id3, '.mp3'], ['a.aac', ftyp, '.m4a']]) {
      const path = resolve(dir, name)
      writeFileSync(path, buffer)
      if (await sniffAudioKind(path) !== expected) throw new Error('音频魔数嗅探错误')
    }
    const bad = resolve(dir, 'bad.mp3')
    writeFileSync(bad, Buffer.from('this is not audio at all, padding'))
    try { await sniffAudioKind(bad); throw new Error('非音频未被拒绝') } catch (error) { if (!String(error.message).includes('不是受支持')) throw error }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

if (process.argv.includes('--self-check')) selfCheck().then(() => console.log('ok')).catch((error) => { console.error(error.message); process.exitCode = 1 })
```

Run: `node scripts/media-hosting/publish.mjs --self-check`
Expected: `ok`。

- [ ] **Step 3: 把 publishReferenceImage 主体泛化为 publishReferenceMedia**

整体删除现有 `publishReferenceImage` 函数（第 35-67 行），替换为下面的薄包装 + 泛化实现。image 分支逐行保留原有校验顺序与错误文案（version_id 正则前置、assets.json selected/未失效校验、assets/ containment、能力+大小、assertImage、上传前 sha/size 比对、收据复用、上传后再比对）；audio 分支为新增：

```js
export function publishReferenceImage(rootArg, input, fetchImpl = fetch) {
  return publishReferenceMedia(rootArg, input, 'image', fetchImpl)
}

export async function publishReferenceMedia(rootArg, input, mediaType = 'image', fetchImpl = fetch) {
  if (!['image', 'audio'].includes(mediaType)) throw new Error('不支持的临时媒体类型')
  rejectSecrets(input)
  if (input.confirmed !== true) throw new Error(mediaType === 'image' ? '公开上传参考图前必须 confirmed=true' : '公开上传参考音频前必须 confirmed=true')
  if (input.rights_confirmed !== true || input.public_exposure_confirmed !== true || input.usage_terms_confirmed !== true || !['non-commercial', 'commercial-authorized'].includes(input.usage_scope)) throw new Error('必须确认素材权利、公开暴露风险、使用范围及服务条款')
  if (mediaType === 'image' && !/^v\d{3}$/.test(input.version_id || '')) throw new Error('version_id 必须是 v001 格式')
  const root = await realpath(resolve(rootArg))
  const lockMaterial = mediaType === 'image' ? `${input.service}:${input.asset_key}:${input.version_id}` : `${input.service}:audio:${input.local_path}`
  const lockKey = createHash('sha256').update(lockMaterial).digest('hex')
  return withFileLock(resolve(root, '.short-drama', 'locks', `publish-${lockKey}`), async () => {
    const host = mediaHost(input.service)
    const assetsRoot = await realpath(resolve(root, 'assets'))
    let path
    let receiptBase
    let reusableReceipts
    if (mediaType === 'image') {
      const ledger = JSON.parse(await readFile(resolve(root, '.short-drama/assets.json'), 'utf8'))
      const asset = ledger.assets?.[input.asset_key]
      const version = asset?.versions?.find((item) => item.id === input.version_id)
      if (!asset || !IMAGE_TYPES.has(asset.type) || asset.selectedVersionId !== input.version_id || asset.staleVersionIds?.includes(input.version_id) || !version) throw new Error('只能上传 selected、未失效的本地图片资产版本')
      path = await realpath(resolve(root, version.localPath))
      if (path !== assetsRoot && !path.startsWith(`${assetsRoot}${sep}`)) throw new Error('只能上传当前项目 assets/ 内文件')
      const file = await stat(path)
      if (!host.capabilities.media_types.includes('image') || file.size > host.capabilities.max_bytes) throw new Error('图片类型或大小超出托管服务能力')
      await assertImage(path)
      if (await sha256(path) !== version.sha256 || file.size !== version.sizeBytes) throw new Error('本地图片已变化，拒绝公开上传')
      receiptBase = { asset_key: asset.key, version_id: version.id, local_path: version.localPath, sha256: version.sha256, size_bytes: version.sizeBytes }
      reusableReceipts = await listReferenceUploads(root, { service: input.service, asset_key: asset.key, version_id: version.id, state: 'active' })
    } else {
      path = await realpath(resolve(input.local_path))
      if (path !== assetsRoot && !path.startsWith(`${assetsRoot}${sep}`)) throw new Error('只能上传当前项目 assets/ 内文件')
      const extension = extname(path).toLowerCase()
      if (!AUDIO_EXTENSIONS.has(extension)) throw new Error(`音频格式不支持：${extension}`)
      if (!host.capabilities.media_types.includes('audio')) throw new Error('托管服务不支持音频')
      const detected = await sniffAudioKind(path)
      if (!AUDIO_SNIFF_MATCH[detected]?.has(extension)) throw new Error(`音频魔数与扩展名不一致：${extension}`)
      const file = await stat(path)
      if (!file.isFile() || file.size === 0) throw new Error('音频文件为空或不是有效文件')
      if (file.size > host.capabilities.max_bytes) throw new Error('音频大小超出托管服务能力')
      receiptBase = { local_path: relative(root, path), sha256: await sha256(path), size_bytes: file.size }
      reusableReceipts = await listReferenceUploads(root, { service: input.service, state: 'active' })
    }
    const reusable = reusableReceipts.find((item) => item.media_type === mediaType && item.sha256 === receiptBase.sha256 && item.usage_scope === input.usage_scope)
    if (reusable && input.force_reupload !== true) return { ...reusable, reused: true }
    const url = await host.upload(path, input.expires_in, fetchImpl)
    const createdAt = new Date()
    const receipt = { version: 1, id: `upload-${randomUUID()}`, service: input.service, media_type: mediaType, ...receiptBase, url, expires_in: input.expires_in, usage_scope: input.usage_scope, confirmations: { rights: true, public_exposure: true, terms_of_use: true }, created_at: createdAt.toISOString(), expires_at: new Date(createdAt.getTime() + EXPIRY_MS[input.expires_in]).toISOString(), permanent: false }
    const changedMessage = mediaType === 'image' ? '上传期间本地图片发生变化，拒绝登记公开链接' : '上传期间本地音频发生变化，拒绝登记公开链接'
    if (await sha256(path) !== receipt.sha256 || (await stat(path)).size !== receipt.size_bytes) throw new Error(changedMessage)
    const target = resolve(root, '.short-drama', 'uploads', `${receipt.id}.json`)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' })
    return { ...receipt, receipt_path: relative(root, target), reused: false }
  }, { timeoutMs: 130000, staleMs: 180000 })
}
```

注意：image 分支的锁 key 原料与旧实现完全一致（`service:asset_key:version_id`），错误文案一条未改；删除旧的 `publishReferenceImage` 整个函数体，避免重复定义。

- [ ] **Step 4: 运行两个 selfCheck**

Run: `node scripts/media-hosting/publish.mjs --self-check && node scripts/media-hosting/litterbox.mjs --self-check`
Expected: 均输出 `ok`。

- [ ] **Step 5: Commit**

```bash
git add scripts/media-hosting/litterbox.mjs scripts/media-hosting/publish.mjs
git commit -m "feat: 临时媒体托管支持音频，发布逻辑泛化 image/audio 两分支

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: voice-tools.mjs 编排（项目校验 + 自动托管 + 账本）

**Files:**
- Create: `scripts/generation/voice-tools.mjs`

**Interfaces:**
- Consumes:
  - `bailian`（Task 2/3）的 `createVoiceDesign/createVoiceClone/listCloudVoices/deleteCloudVoice`
  - Task 4 的 `readVoiceLedger/addVoiceEntry/removeVoiceEntry/previewRelativePath`
  - Task 5 的 `publishReferenceMedia`
  - `scripts/project-store.mjs` 的 `validateProject(project)`
- Produces（Task 8 的 mcp.mjs 直接 import）：
  - `designVoice(args): Promise<VoiceEntry>`（args 为 MCP 蛇形参数）
  - `cloneVoice(args): Promise<VoiceEntry & {upload_receipt_id}>`
  - `listVoices(args): Promise<{provider:'bailian', voices: Array<cloud & {local: VoiceEntry|null}>, local_only: VoiceEntry[]}>`
  - `deleteVoice(args): Promise<{voice_id, flavor, request_id, local_removed, preview_deleted}>`
  - `validateCloneChoice(args): {mode:'path'|'url'}`、`selfCheck()`

- [ ] **Step 1: 创建文件并实现**

```js
#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, extname, resolve, sep } from 'node:path'
import { validateProject } from '../project-store.mjs'
import { bailian, QWEN_TTS_MODEL, validatePreviewText, validateVoicePrefix, validateVoicePrompt, requireValid, assertPublicHttps } from './bailian.mjs'
import { addVoiceEntry, readVoiceLedger, removeVoiceEntry, previewRelativePath } from '../voice-ledger.mjs'
import { publishReferenceMedia } from '../media-hosting/publish.mjs'

const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.flac', '.webm'])
const MAX_REFERENCE_AUDIO_BYTES = 20 * 1024 * 1024

export function validateCloneChoice(args) {
  const hasPath = typeof args?.reference_audio_path === 'string' && args.reference_audio_path.trim()
  const hasUrl = typeof args?.audio_url === 'string' && args.audio_url.trim()
  if (hasPath === hasUrl) throw new Error('reference_audio_path 与 audio_url 必须二选一')
  return { mode: hasPath ? 'path' : 'url' }
}
async function assertProject(rootArg) {
  const root = await realpath(resolve(rootArg))
  validateProject(JSON.parse(await readFile(resolve(root, '.short-drama', 'project.json'), 'utf8')))
  return root
}
function targetModelOf(flavor, result, requested) {
  if (result.target_model) return result.target_model
  if (flavor === 'qwen') return QWEN_TTS_MODEL
  return requested || 'cosyvoice-v3.5-plus'
}

export async function designVoice(args) {
  const root = await assertProject(args.project_root)
  // MCP stdio 服务端不跑 JSON Schema 校验，付费门必须在代码里强制
  if (args.confirmed !== true) throw new Error('设计音色前必须取得用户确认，并传 confirmed=true')
  const flavor = args.flavor === 'qwen' ? 'qwen' : 'cosyvoice-design'
  requireValid(validateVoicePrompt(args.voice_prompt))
  requireValid(validatePreviewText(args.preview_text))
  requireValid(validateVoicePrefix(args.prefix))
  const result = await bailian.createVoiceDesign({
    flavor,
    voice_prompt: String(args.voice_prompt).trim(),
    preview_text: String(args.preview_text).trim(),
    prefix: args.prefix,
    target_model: args.target_model,
    language_hints: args.language_hints,
    preferred_name: args.preferred_name,
    language: args.language,
    confirmed: true,
  })
  if (!result.voice_id) throw new Error('BAILIAN_VOICE_INVALID_RESULT: 设计成功响应缺少 voice_id')
  let previewPath = null
  if (result.preview?.data_base64) {
    previewPath = previewRelativePath(result.voice_id, result.preview.format)
    const target = resolve(root, previewPath)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, Buffer.from(result.preview.data_base64, 'base64'))
  }
  const entry = {
    voice_id: result.voice_id,
    flavor,
    target_model: targetModelOf(flavor, result, args.target_model),
    prefix: args.prefix,
    name: args.preferred_name ? String(args.preferred_name) : String(args.prefix),
    source: 'design',
    preview_path: previewPath,
    upload_receipt_id: null,
    request_id: result.request_id || null,
    created_at: new Date().toISOString(),
  }
  // spec §6：云端已成功时本地账本写失败不谎称失败，带 warning 返回 voice_id
  try { return await addVoiceEntry(root, entry) }
  catch (error) {
    if (previewPath) await rm(resolve(root, previewPath), { force: true }).catch(() => {})
    return { ...entry, preview_path: null, warning: `云端音色已创建，但本地登记写入失败：${String(error.message).slice(0, 200)}；可用 list_voices/delete_voice 收敛` }
  }
}

export async function cloneVoice(args) {
  const root = await assertProject(args.project_root)
  if (args.confirmed !== true) throw new Error('克隆音色前必须取得用户确认，并传 confirmed=true')
  if (args.rights_confirmed !== true || args.public_exposure_confirmed !== true || args.usage_terms_confirmed !== true || !['non-commercial', 'commercial-authorized'].includes(args.usage_scope)) throw new Error('必须确认素材权利、公开暴露风险、使用范围及服务条款')
  requireValid(validateVoicePrefix(args.prefix))
  const { mode } = validateCloneChoice(args)
  let url
  let receiptId = null
  if (mode === 'url') {
    url = assertPublicHttps(String(args.audio_url).trim(), 'audio_url')
  } else {
    const assetsRoot = await realpath(resolve(root, 'assets'))
    const path = await realpath(resolve(String(args.reference_audio_path)))
    if (path !== assetsRoot && !path.startsWith(`${assetsRoot}${sep}`)) throw new Error('参考音频只能来自当前项目 assets/ 内文件')
    const extension = extname(path).toLowerCase()
    if (!AUDIO_EXTENSIONS.has(extension)) throw new Error(`参考音频格式不支持：${extension}`)
    const file = await stat(path)
    if (!file.isFile() || file.size === 0) throw new Error('参考音频不是有效文件')
    if (file.size > MAX_REFERENCE_AUDIO_BYTES) throw new Error('参考音频不能超过 20MiB')
    const receipt = await publishReferenceMedia(root, {
      service: 'litterbox',
      local_path: path,
      expires_in: '72h',
      usage_scope: args.usage_scope,
      confirmed: true,
      rights_confirmed: true,
      public_exposure_confirmed: true,
      usage_terms_confirmed: true,
    }, 'audio')
    url = receipt.url
    receiptId = receipt.id
  }
  const result = await bailian.createVoiceClone({
    url,
    prefix: args.prefix,
    target_model: args.target_model,
    language_hints: args.language_hints,
    max_prompt_audio_length: args.max_prompt_audio_length,
    enable_preprocess: args.enable_preprocess,
    confirmed: true,
  })
  if (!result.voice_id) throw new Error('BAILIAN_VOICE_INVALID_RESULT: 克隆成功响应缺少 voice_id')
  const entry = {
    voice_id: result.voice_id,
    flavor: 'cosyvoice-clone',
    target_model: targetModelOf('cosyvoice-clone', result, args.target_model),
    prefix: args.prefix,
    name: String(args.prefix),
    source: 'clone',
    preview_path: null,
    upload_receipt_id: receiptId,
    request_id: result.request_id || null,
    created_at: new Date().toISOString(),
  }
  try { return await addVoiceEntry(root, entry) }
  catch (error) {
    return { ...entry, warning: `云端音色已创建，但本地登记写入失败：${String(error.message).slice(0, 200)}；可用 list_voices/delete_voice 收敛` }
  }
}

export async function listVoices(args) {
  const root = await assertProject(args.project_root)
  const [cloud, ledger] = await Promise.all([bailian.listCloudVoices(), readVoiceLedger(root)])
  const localById = new Map(ledger.voices.map((item) => [item.voice_id, item]))
  const voices = cloud.map((item) => ({ ...item, local: localById.get(item.voice_id) || null }))
  const cloudIds = new Set(cloud.map((item) => item.voice_id))
  return { provider: 'bailian', voices, local_only: ledger.voices.filter((item) => !cloudIds.has(item.voice_id)) }
}

export async function deleteVoice(args) {
  const root = await assertProject(args.project_root)
  if (args.confirmed !== true) throw new Error('删除音色前必须取得用户确认，并传 confirmed=true')
  const result = await bailian.deleteCloudVoice(args.voice_id)
  const removed = await removeVoiceEntry(root, args.voice_id)
  let previewDeleted = false
  if (removed?.preview_path) {
    await rm(resolve(root, removed.preview_path), { force: true })
    previewDeleted = true
  }
  return { voice_id: args.voice_id, flavor: result.flavor, request_id: result.request_id || null, local_removed: Boolean(removed), preview_deleted: previewDeleted }
}

export async function selfCheck() {
  try { validateCloneChoice({}); throw new Error('空克隆参数未被拒绝') } catch (error) { if (!String(error.message).includes('二选一')) throw error }
  try { validateCloneChoice({ reference_audio_path: '/tmp/a.wav', audio_url: 'https://x/a.wav' }); throw new Error('双来源未被拒绝') } catch (error) { if (!String(error.message).includes('二选一')) throw error }
  if (validateCloneChoice({ audio_url: 'https://x/a.wav' }).mode !== 'url' || validateCloneChoice({ reference_audio_path: '/tmp/a.wav' }).mode !== 'path') throw new Error('克隆来源判定错误')
  // 项目外/损坏项目必须在访问 Provider 前被拒绝（标志位，不能吞掉哨兵错误）
  const outside = await realpath(await mkdtemp(resolve(tmpdir(), 'short-drama-voice-tools-')))
  try {
    await mkdir(resolve(outside, '.short-drama'), { recursive: true })
    await writeFile(resolve(outside, '.short-drama', 'project.json'), '{}')
    let rejected = false
    try { await listVoices({ project_root: outside }) } catch (error) { if (!error || typeof error.message !== 'string' || !error.message) throw error; rejected = true }
    if (!rejected) throw new Error('非法项目未被拒绝')
  } finally { await rm(outside, { recursive: true, force: true }) }
}

if (import.meta.url === `file://${process.argv[1]}`) { selfCheck().then(() => console.log('ok')) }
```

- [ ] **Step 2: 运行 selfCheck**

Run: `node scripts/generation/voice-tools.mjs --self-check`
Expected: `ok`。

- [ ] **Step 3: 跑既有全套，确认无回归**

Run: `node scripts/generation/bailian.mjs --self-check && node scripts/voice-ledger.mjs --self-check && node scripts/media-hosting/publish.mjs --self-check`
Expected: 三个均 `ok`。

- [ ] **Step 4: Commit**

```bash
git add scripts/generation/voice-tools.mjs
git commit -m "feat: 声音设计/克隆编排（项目校验、litterbox 自动托管、账本登记）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: 注册百炼 provider、参数目录、generate_audio schema 扩展

**Files:**
- Modify: `scripts/generation/providers.mjs`
- Modify: `scripts/generation/mcp.mjs`（imports/启动自检/generate_audio schema）

**Interfaces:**
- Consumes: Task 2/3 的 `bailian` adapter。
- Produces：`adapters` 键顺序变为 `{ bailian, starrouter, runninghub, comfly }`；`normalizeModelParameters` 支持 `type:'string'` + `maxLength`（加权长度）。

- [ ] **Step 1: providers.mjs 注册 adapter**

`scripts/generation/providers.mjs:1-6` 改为：

```js
import { bailian, BAILIAN_COSYVOICE_LANGUAGE_HINTS, weightedLength } from './bailian.mjs'
import { starrouter } from './starrouter.mjs'
import { runninghub } from './runninghub.mjs'
import { comfly } from './comfly.mjs'
import { credential } from './credentials.mjs'

export const adapters = { bailian, starrouter, runninghub, comfly }
```

- [ ] **Step 2: 参数目录加 bailian 段**

在 `parameterCatalog` 声明（`const parameterCatalog = {`）内、`starrouter:` 之前插入：

```js
  bailian: {
    'cosyvoice-v3.5-plus': [
      { key: 'speed', label: '语速', type: 'number', min: 0.5, max: 2, step: 0.1, default: 1 },
      { key: 'response_format', label: '格式', type: 'select', options: ['wav', 'mp3', 'pcm', 'opus'], default: 'wav' },
      { key: 'sample_rate', label: '采样率', type: 'select', options: [8000, 16000, 22050, 24000, 44100, 48000], default: 24000 },
      { key: 'volume', label: '音量', type: 'number', min: 0, max: 100, default: 50 },
      { key: 'pitch', label: '音调', type: 'number', min: 0.5, max: 2, step: 0.1, default: 1 },
      { key: 'language_hints', label: '语言', type: 'select', options: BAILIAN_COSYVOICE_LANGUAGE_HINTS, default: 'zh' },
      { key: 'instruction', label: '风格指令', type: 'string', maxLength: 100, default: '' },
    ],
    'cosyvoice-v3.5-flash': [
      { key: 'speed', label: '语速', type: 'number', min: 0.5, max: 2, step: 0.1, default: 1 },
      { key: 'response_format', label: '格式', type: 'select', options: ['wav', 'mp3', 'pcm', 'opus'], default: 'wav' },
      { key: 'sample_rate', label: '采样率', type: 'select', options: [8000, 16000, 22050, 24000, 44100, 48000], default: 24000 },
      { key: 'volume', label: '音量', type: 'number', min: 0, max: 100, default: 50 },
      { key: 'pitch', label: '音调', type: 'number', min: 0.5, max: 2, step: 0.1, default: 1 },
      { key: 'language_hints', label: '语言', type: 'select', options: BAILIAN_COSYVOICE_LANGUAGE_HINTS, default: 'zh' },
      { key: 'instruction', label: '风格指令', type: 'string', maxLength: 100, default: '' },
    ],
    'cosyvoice-v3-plus': [
      { key: 'speed', label: '语速', type: 'number', min: 0.5, max: 2, step: 0.1, default: 1 },
      { key: 'response_format', label: '格式', type: 'select', options: ['wav', 'mp3', 'pcm', 'opus'], default: 'wav' },
      { key: 'sample_rate', label: '采样率', type: 'select', options: [8000, 16000, 22050, 24000, 44100, 48000], default: 24000 },
      { key: 'volume', label: '音量', type: 'number', min: 0, max: 100, default: 50 },
      { key: 'pitch', label: '音调', type: 'number', min: 0.5, max: 2, step: 0.1, default: 1 },
      { key: 'language_hints', label: '语言', type: 'select', options: ['zh', 'en', 'fr', 'de', 'ja', 'ko', 'ru'], default: 'zh' },
    ],
    'cosyvoice-v3-flash': [
      { key: 'speed', label: '语速', type: 'number', min: 0.5, max: 2, step: 0.1, default: 1 },
      { key: 'response_format', label: '格式', type: 'select', options: ['wav', 'mp3', 'pcm', 'opus'], default: 'wav' },
      { key: 'sample_rate', label: '采样率', type: 'select', options: [8000, 16000, 22050, 24000, 44100, 48000], default: 24000 },
      { key: 'volume', label: '音量', type: 'number', min: 0, max: 100, default: 50 },
      { key: 'pitch', label: '音调', type: 'number', min: 0.5, max: 2, step: 0.1, default: 1 },
      { key: 'language_hints', label: '语言', type: 'select', options: BAILIAN_COSYVOICE_LANGUAGE_HINTS, default: 'zh' },
      { key: 'instruction', label: '风格指令', type: 'string', maxLength: 100, default: '' },
    ],
    'cosyvoice-v2': [
      { key: 'speed', label: '语速', type: 'number', min: 0.5, max: 2, step: 0.1, default: 1 },
      { key: 'response_format', label: '格式', type: 'select', options: ['wav', 'mp3', 'pcm'], default: 'wav' },
      { key: 'sample_rate', label: '采样率', type: 'select', options: [8000, 16000, 22050, 24000, 44100, 48000], default: 24000 },
      { key: 'volume', label: '音量', type: 'number', min: 0, max: 100, default: 50 },
      { key: 'pitch', label: '音调', type: 'number', min: 0.5, max: 2, step: 0.1, default: 1 },
      { key: 'language_hints', label: '语言', type: 'select', options: ['zh', 'en'], default: 'zh' },
    ],
    'qwen3-tts-vd-2026-01-26': [
      { key: 'language_type', label: '语言', type: 'select', options: ['Chinese', 'English'], default: 'Chinese' },
    ],
  },
```

- [ ] **Step 3: normalizeModelParameters 支持 string 类型**

现有取值行是 `let value = values[field.key] ?? field.default`（第 78 行，不要改动）。在它之后、`field.type === 'number'` 分支之后插入：

```js
    if (field.type === 'string') {
      if (value === '' && field.default !== undefined) value = field.default
      if (typeof value !== 'string') throw new Error(`${field.label} 必须是字符串`)
      if (field.maxLength && weightedLength(value) > field.maxLength) throw new Error(`${field.label} 不能超过 ${field.maxLength} 个加权字符`)
    }
```

空字符串按 spec §4.2 视为未提供→取 default；空 instruction 最终被 adapter 当作无 instruction。

- [ ] **Step 4: providers selfCheck 增补百炼用例**

在 `selfCheck()` 末尾追加：

```js
  const bailianVoice = normalizeModelParameters('bailian', 'cosyvoice-v3.5-plus')
  if (bailianVoice.speed !== 1 || bailianVoice.response_format !== 'wav' || bailianVoice.sample_rate !== 24000 || bailianVoice.volume !== 50 || bailianVoice.language_hints !== 'zh' || bailianVoice.instruction !== '') throw new Error('百炼参数默认值自检失败')
  const bailianV2 = normalizeModelParameters('bailian', 'cosyvoice-v2', { language_hints: 'en' })
  if (bailianV2.language_hints !== 'en') throw new Error('百炼 v2 语言参数自检失败')
  try { normalizeModelParameters('bailian', 'cosyvoice-v2', { language_hints: 'ja' }); throw new Error('百炼 v2 非法语言未被拒绝') } catch (error) { if (!String(error.message).includes('选项无效')) throw error }
  try { normalizeModelParameters('bailian', 'cosyvoice-v3-plus', { instruction: '说' }); throw new Error('百炼无 instruction 字段未被拒绝') } catch (error) { if (!String(error.message).includes('不受支持')) throw error }
  try { normalizeModelParameters('bailian', 'cosyvoice-v3.5-plus', { instruction: 'a'.repeat(101) }); throw new Error('百炼 instruction 超长未被拒绝') } catch (error) { if (!String(error.message).includes('加权字符')) throw error }
  if (Object.keys(adapters)[0] !== 'bailian') throw new Error('百炼必须是注册顺序第一个 Provider')
```

Run: `node -e "import('./scripts/generation/providers.mjs').then(m => m.selfCheck()).then(() => console.log('ok'))"`
Expected: `ok`（selfCheck 成功本身不打印内容，由 then 补打）。

- [ ] **Step 5: mcp.mjs 挂百炼自检**

`scripts/generation/mcp.mjs` 顶部 import 区（第 6-8 行附近）加：

```js
import { selfCheck as checkBailian } from './bailian.mjs'
```

启动自检区（`checkStarRouter()` 附近，第 21-25 行）加：

```js
checkBailian()
```

- [ ] **Step 6: generate_audio schema 扩展**

把 `generate_audio` 工具声明（mcp.mjs 第 89-91 行）替换为：

```js
  ['generate_audio', '使用用户选择的 Provider 生成语音或提交音频工作流。StarRouter 使用 model/input/voice，RunningHub 使用 prompt/workflow，百炼使用 CosyVoice/qwen TTS 与已登记音色。', {
    provider, model: { type: 'string' }, input: { type: 'string' }, voice: { type: 'string' }, instructions: { type: 'string' }, speed: { type: 'number', minimum: 0.5, maximum: 2 }, response_format: { type: 'string', enum: ['mp3', 'pcm', 'flac', 'wav', 'opus'] }, language_hints: { type: 'string' }, sample_rate: { type: 'integer' }, volume: { type: 'number', minimum: 0, maximum: 100 }, pitch: { type: 'number', minimum: 0.5, maximum: 2 }, instruction: { type: 'string', maxLength: 100 }, metadata: audioMetadata, prompt: { type: 'string' }, confirmed: { const: true }, ...workflow, ...projectTracking,
  }, ['provider', 'confirmed', 'project_root', 'target', 'prompt_document']],
```

（`language_type` 不进共享 schema：它由 project.json parameters 经 `applyConfiguredModelParameters` 自动注入 qwen 请求；如确需临时覆盖，模型参数目录已覆盖该键。）

Run: `node -e "import('./scripts/generation/mcp.mjs').then(m => { const t = m.tools.find(x => x.name === 'generate_audio'); if (!t.inputSchema.properties.language_hints || !t.inputSchema.properties.instruction) throw new Error('schema 缺少百炼字段'); console.log('ok') })"`
Expected: `ok`。

- [ ] **Step 7: Commit**

```bash
git add scripts/generation/providers.mjs scripts/generation/mcp.mjs
git commit -m "feat: 注册百炼为首选配音 Provider 并扩展语音参数合同

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: 四个声音管理 MCP 工具（schema + 分发 + 环境变量登记）

**Files:**
- Modify: `scripts/generation/mcp.mjs`
- Modify: `.mcp.json`

**Interfaces:**
- Consumes: Task 6 的 `designVoice/cloneVoice/listVoices/deleteVoice`。
- Produces：MCP 工具 `design_voice`、`clone_voice`、`list_voices`、`delete_voice`；工具均不经过阶段门禁/快照/账本。

- [ ] **Step 1: mcp.mjs import voice-tools**

在 Task 7 加的 bailian import 旁加：

```js
import { designVoice, cloneVoice, listVoices, deleteVoice } from './voice-tools.mjs'
```

- [ ] **Step 2: 加共享 schema 片段**

在 `const asrInput = {...}`（约第 73-75 行）之后加：

```js
const bailianProvider = { type: 'string', enum: ['bailian'] }
const cosyVoiceTargetModel = { type: 'string', enum: ['cosyvoice-v3.5-plus', 'cosyvoice-v3.5-flash', 'cosyvoice-v3-plus', 'cosyvoice-v3-flash', 'cosyvoice-v2'] }
const voicePrefix = { type: 'string', pattern: '^[A-Za-z0-9]{1,10}$' }
const voiceConfirmation = {
  confirmed: { const: true },
  rights_confirmed: { const: true },
  public_exposure_confirmed: { const: true },
  usage_terms_confirmed: { const: true },
}
```

- [ ] **Step 3: 在 tools 数组中注册四个工具**

在 `generate_music` 条目之后、`submit_video` 之前插入四个数组元素：

```js
  ['design_voice', '在百炼账号下用文本描述设计自定义音色（默认 cosyvoice-design；qwen 为旧版）。付费操作；成功后音色登记到项目并可在 generate_audio 中作为 voice 使用。', {
    provider: bailianProvider, project_root: { type: 'string' }, flavor: { type: 'string', enum: ['cosyvoice-design', 'qwen'] },
    voice_prompt: { type: 'string', minLength: 1, maxLength: 500 }, preview_text: { type: 'string', minLength: 5, maxLength: 200 }, prefix: voicePrefix,
    target_model: cosyVoiceTargetModel, language_hints: { type: 'string' }, preferred_name: { type: 'string' }, language: { type: 'string', enum: ['zh', 'en'] },
    confirmed: { const: true },
  }, ['provider', 'project_root', 'flavor', 'voice_prompt', 'preview_text', 'prefix', 'confirmed']],
  ['clone_voice', '用一段参考音频在百炼账号下克隆音色（cosyvoice-clone）。本地音频由服务端临时公网发布（litterbox 72h），必须确认权利、公开风险与使用范围；audio_url 与 reference_audio_path 二选一。', {
    provider: bailianProvider, project_root: { type: 'string' }, prefix: voicePrefix,
    reference_audio_path: { type: 'string' }, audio_url: { type: 'string' },
    target_model: cosyVoiceTargetModel, language_hints: { type: 'string' },
    max_prompt_audio_length: { type: 'integer', minimum: 3, maximum: 30 }, enable_preprocess: { type: 'boolean' },
    usage_scope: { type: 'string', enum: ['non-commercial', 'commercial-authorized'] },
    ...voiceConfirmation,
  }, ['provider', 'project_root', 'prefix', 'confirmed', 'rights_confirmed', 'public_exposure_confirmed', 'usage_terms_confirmed', 'usage_scope']],
  ['list_voices', '列出百炼账号下已有自定义音色（CosyVoice 与 qwen 两路合并），并叠加项目本地音色登记标记。只读。', {
    provider: bailianProvider, project_root: { type: 'string' },
  }, ['provider', 'project_root']],
  ['delete_voice', '删除百炼账号下的自定义音色（按 voice_id 前缀自动分流接口），同时清理项目本地登记与预览文件。付费/破坏性操作。', {
    provider: bailianProvider, project_root: { type: 'string' }, voice_id: { type: 'string', minLength: 1 }, confirmed: { const: true },
  }, ['provider', 'project_root', 'voice_id', 'confirmed']],
```

- [ ] **Step 4: call() 分发——在通用 adapter 分发之前**

在 `call(name, args)` 中 `const selected = adapter(args.provider)`（约第 213 行）**之前**插入：

```js
  if (name === 'design_voice') return designVoice(args)
  if (name === 'clone_voice') return cloneVoice(args)
  if (name === 'list_voices') return listVoices(args)
  if (name === 'delete_voice') return deleteVoice(args)
```

- [ ] **Step 5: .mcp.json 登记凭证环境变量**

`.mcp.json` 的 `env_vars` 数组末尾（`"COMFLY_APP_ID"` 后）加：

```json
"BAILIAN_API_KEY"
```

（即把原结尾 `"COMFLY_APP_ID"]` 改为 `"COMFLY_APP_ID", "BAILIAN_API_KEY"]`。）

- [ ] **Step 6: 验证 schema 与分发接线**

Run:

```bash
node -e "import('./scripts/generation/mcp.mjs').then(async m => { for (const name of ['design_voice','clone_voice','list_voices','delete_voice']) if (!m.tools.find(t => t.name === name)) throw new Error('缺少工具 ' + name); let rejected = false; try { await m.call('list_voices', { provider: 'bailian', project_root: '/nonexistent-project' }) } catch (e) { if (!String(e?.message)) throw e; rejected = true }; if (!rejected) throw new Error('非法项目未被拒绝'); console.log('ok') })"
```

Expected: `ok`（不存在的项目在发起百炼网络请求前即被拒绝）。

- [ ] **Step 7: Commit**

```bash
git add scripts/generation/mcp.mjs .mcp.json
git commit -m "feat: 新增 design_voice/clone_voice/list_voices/delete_voice MCP 工具

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: 集成自检覆盖百炼

**Files:**
- Modify: `scripts/integration-self-check.mjs`

**Interfaces:**
- Consumes: Task 1-8 全部模块。

- [ ] **Step 1: 脚本级 selfCheck 循环登记新文件**

第 2 行的 node:fs/promises import 加 `mkdir`：

```js
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
```

把第 106 行 `for (const script of [...])` 数组末尾（`'workflow-gates.mjs'` 后）加入三个新条目（路径相对 `scripts/`，`run()` 会 resolve 子目录）：

```js
'generation/bailian.mjs', 'generation/voice-tools.mjs', 'voice-ledger.mjs'
```

- [ ] **Step 2: 启动期 import selfCheck 增加百炼与 publish**

在第 12 行 `checkLitterbox` import 之后加：

```js
import { selfCheck as checkBailian } from './generation/bailian.mjs'
```

把第 13 行的 publish.mjs import 改为（新增 `selfCheck as checkPublish`，其余三个名字保持）：

```js
import { listReferenceUploads, publishReferenceImage, selfCheck as checkPublish, validateTemporaryReferenceUrl } from './media-hosting/publish.mjs'
```

把第 107 行替换为（publish 的 selfCheck 是 async，必须 await，否则断言失败会变成未处理拒绝而漏检）：

```js
  for (const check of [checkComfly, checkRunningHub, checkStarRouter, checkProviders, checkLitterbox, checkBailian, checkPublish]) await check()
```

- [ ] **Step 3: MCP schema/能力合同断言**

在第 105 行 transcribe/translate 循环之后加：

```js
  for (const name of ['design_voice', 'clone_voice', 'list_voices', 'delete_voice']) if (!generationTools.find((tool) => tool.name === name)) throw new Error(`${name} MCP 工具缺失`)
  const cloneSchema = generationTools.find((tool) => tool.name === 'clone_voice')?.inputSchema
  for (const field of ['confirmed', 'rights_confirmed', 'public_exposure_confirmed', 'usage_terms_confirmed', 'usage_scope']) if (!cloneSchema?.required?.includes(field)) throw new Error(`clone_voice 缺少必填确认字段：${field}`)
  const audioSchema = generationTools.find((tool) => tool.name === 'generate_audio')?.inputSchema?.properties
  if (!audioSchema.language_hints || !audioSchema.instruction || audioSchema.response_format.enum.join() !== 'mp3,pcm,flac,wav,opus') throw new Error('generate_audio 百炼字段缺失')
```

第 124 行现有 Litterbox 能力断言扩展音频能力（复用同一次 `list_media_hosts` 调用，不新增请求）：

```js
    if (!mediaHosts.litterbox?.free || mediaHosts.litterbox?.permanent || mediaHosts.litterbox?.expiries?.join(',') !== '1h,12h,24h,72h' || !mediaHosts.litterbox?.media_types?.includes('audio')) throw new Error('Litterbox MCP 能力目录无效')
```

- [ ] **Step 4: 新增百炼专项校验函数**

在 `checkMultiEpisodeEvidence` 函数定义之后新增一个完整函数（配置接受/非法参数拒绝 + 声音工具前置门禁 + fetch 桩端到端 design→clone→list→delete，全程无真实网络；spec §7.5）：

```js
async function checkBailianVoiceLifecycle() {
  const bailianRoot = await mkdtemp(resolve(tmpdir(), 'short-drama-bailian-'))
  const originalFetch = globalThis.fetch
  const originalKey = process.env.BAILIAN_API_KEY
  try {
    const bailianInit = await json(bailianRoot, 'initial-project.json', { key: 'bailian-drama', title: '百炼配音短剧', providers: { image: { provider: 'starrouter', model_or_workflow: 'gpt-image-2', prompt_profile: null }, video: { provider: 'starrouter', model_or_workflow: 'dreamina-seedance-2-0-260128', prompt_profile: 'seedance2', parameters: { watermark: true } }, audio: { provider: 'bailian', model_or_workflow: 'cosyvoice-v3.5-plus', prompt_profile: null, parameters: { speed: 1, response_format: 'wav', sample_rate: 24000, volume: 50, pitch: 1, language_hints: 'zh', instruction: '' } }, music: { provider: 'starrouter', model_or_workflow: 'suno_music', prompt_profile: null, parameters: { make_instrumental: true } } } })
    run('project-store.mjs', 'init', bailianRoot, bailianInit)
    // path 模式克隆门禁要求 assets/ 真实存在（realpath assetsRoot）
    await mkdir(resolve(bailianRoot, 'assets'), { recursive: true })
    const bailianProject = JSON.parse(run('project-store.mjs', 'project', bailianRoot))
    if (bailianProject.providers.audio.provider !== 'bailian' || bailianProject.providers.audio.model_or_workflow !== 'cosyvoice-v3.5-plus') throw new Error('百炼配音配置未被项目存储接受')
    const expectRejected = async (name, payload, expected) => {
      const file = await json(bailianRoot, name, payload)
      const result = spawnSync(process.execPath, [resolve(plugin, 'scripts/project-store.mjs'), 'update-project', bailianRoot, file], { encoding: 'utf8' })
      if (result.status === 0 || !result.stderr.includes(expected)) throw new Error(`百炼非法配置未被拒绝（应含：${expected}）：${result.stderr}`)
    }
    await expectRejected('invalid-hint.json', { providers: { audio: { model_or_workflow: 'cosyvoice-v2', prompt_profile: null, parameters: { language_hints: 'ja' } } } }, '选项无效')
    await expectRejected('v3-plus-instruction.json', { providers: { audio: { model_or_workflow: 'cosyvoice-v3-plus', prompt_profile: null, parameters: { language_hints: 'zh', instruction: '冷静地说' } } } }, '模型参数不受支持')
    await expectRejected('unknown-model.json', { providers: { audio: { provider: 'bailian', model_or_workflow: 'not-a-model', prompt_profile: null } } }, '不受 bailian 支持')

    // 前置门禁：全部必须在到达百炼网络前被拒绝（此时尚未设置 BAILIAN_API_KEY）
    const rights = { usage_scope: 'non-commercial', confirmed: true, rights_confirmed: true, public_exposure_confirmed: true, usage_terms_confirmed: true }
    try { await callGeneration('clone_voice', { provider: 'bailian', project_root: bailianRoot, prefix: 'cl', audio_url: 'http://127.0.0.1/a.wav', ...rights }); throw new Error('私网克隆 URL 未被拒绝') }
    catch (error) { if (!String(error.message).includes('公网 HTTPS')) throw error }
    try { await callGeneration('clone_voice', { provider: 'bailian', project_root: bailianRoot, prefix: 'cl', reference_audio_path: '/etc/hosts', ...rights }); throw new Error('项目外参考音频未被拒绝') }
    catch (error) { if (!String(error.message).includes('assets/ 内文件')) throw error }
    try { await callGeneration('clone_voice', { provider: 'bailian', project_root: bailianRoot, prefix: 'cl', audio_url: 'https://example.com/a.wav', usage_scope: 'non-commercial' }); throw new Error('缺确认未被拒绝') }
    catch (error) { if (!/confirmed=true|确认/.test(String(error.message))) throw error }
    try { await callGeneration('design_voice', { provider: 'bailian', project_root: bailianRoot, flavor: 'cosyvoice-design', voice_prompt: '低沉女声', preview_text: '你好', prefix: 'cv', confirmed: true }); throw new Error('过短预览文本未被拒绝') }
    catch (error) { if (!String(error.message).includes('预览文本')) throw error }
    try { await callGeneration('delete_voice', { provider: 'bailian', project_root: bailianRoot, voice_id: 'cosyvoice-v2-x' }); throw new Error('未确认删除未被拒绝') }
    catch (error) { if (!String(error.message).includes('confirmed=true')) throw error }

    // fetch 桩端到端：litterbox 上传 + customization 四个 action 全部本地桩接
    process.env.BAILIAN_API_KEY = 'self-check-key'
    const jsonResponse = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
    globalThis.fetch = async (url, options = {}) => {
      const href = String(url)
      if (href.includes('litterbox.catbox.moe')) return new Response('https://litter.catbox.moe/ref.wav', { status: 200 })
      if (!href.includes('/audio/tts/customization')) throw new Error(`未桩接的请求：${href}`)
      const body = JSON.parse(options.body || '{}')
      const action = body.input?.action
      if (body.model === 'voice-enrollment' && action === 'list_voice') return jsonResponse({ output: { voices: [{ voice_id: 'cosyvoice-v3.5-plus-t1', target_model: 'cosyvoice-v3.5-plus', status: 'OK' }, { voice_id: 'cosyvoice-v3.5-plus-cl1', target_model: 'cosyvoice-v3.5-plus', status: 'OK' }] }, request_id: 'r-list-c' })
      if (body.model === 'qwen-voice-design' && action === 'list') return jsonResponse({ output: { voices: [{ voice: 'qwen-old-1' }] } })
      if (action === 'create_voice') return body.input.url
        ? jsonResponse({ output: { voice_id: 'cosyvoice-v3.5-plus-cl1', target_model: 'cosyvoice-v3.5-plus', status: 'OK' }, request_id: 'r-clone' })
        : jsonResponse({ output: { voice_id: 'cosyvoice-v3.5-plus-t1', target_model: 'cosyvoice-v3.5-plus', status: 'OK', preview_audio: { data: Buffer.from('preview pcm').toString('base64'), sample_rate: 24000, response_format: 'wav' } }, request_id: 'r-design' })
      if (action === 'delete_voice' || action === 'delete') return jsonResponse({ request_id: 'r-delete' })
      throw new Error(`未桩接的 customization action：${action}`)
    }
    const designed = await callGeneration('design_voice', { provider: 'bailian', project_root: bailianRoot, flavor: 'cosyvoice-design', voice_prompt: '低沉女声', preview_text: '你好，这是试听。', prefix: 'cv', target_model: 'cosyvoice-v3.5-plus', confirmed: true })
    if (designed.voice_id !== 'cosyvoice-v3.5-plus-t1' || !designed.preview_path?.endsWith('.wav')) throw new Error('design_voice 端到端结果错误')
    const preview = await readFile(resolve(bailianRoot, designed.preview_path))
    if (preview.length === 0) throw new Error('音色预览音频未落盘')
    await writeFile(resolve(bailianRoot, 'assets', 'ref.wav'), Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(32)]))
    const cloned = await callGeneration('clone_voice', { provider: 'bailian', project_root: bailianRoot, prefix: 'cl', reference_audio_path: resolve(bailianRoot, 'assets', 'ref.wav'), target_model: 'cosyvoice-v3.5-plus', ...rights })
    if (cloned.voice_id !== 'cosyvoice-v3.5-plus-cl1' || !cloned.upload_receipt_id || cloned.source !== 'clone') throw new Error('clone_voice 端到端结果错误')
    const ledger = JSON.parse(await readFile(resolve(bailianRoot, '.short-drama', 'voices.json'), 'utf8'))
    if (ledger.voices.length !== 2) throw new Error('音色登记条数错误')
    const listed = await callGeneration('list_voices', { provider: 'bailian', project_root: bailianRoot })
    if (listed.provider !== 'bailian' || listed.voices.length !== 3 || listed.local_only.length !== 0) throw new Error('list_voices 云端/本地叠加错误')
    const t1Row = listed.voices.find((item) => item.voice_id === 'cosyvoice-v3.5-plus-t1')
    const cl1Row = listed.voices.find((item) => item.voice_id === 'cosyvoice-v3.5-plus-cl1')
    if (t1Row?.local?.source !== 'design' || cl1Row?.local?.source !== 'clone' || !listed.voices.some((item) => item.source === 'qwen')) throw new Error('list_voices 本地登记叠加错误')
    const receipts = await listReferenceUploads(bailianRoot, { state: 'active' })
    if (receipts.length !== 1 || receipts[0].media_type !== 'audio') throw new Error('克隆音频托管收据缺失')
    const deleted = await callGeneration('delete_voice', { provider: 'bailian', project_root: bailianRoot, voice_id: 'cosyvoice-v3.5-plus-t1', confirmed: true })
    if (!deleted.local_removed || !deleted.preview_deleted || deleted.flavor !== 'cosyvoice') throw new Error('delete_voice 收敛结果错误')
    const ledgerAfter = JSON.parse(await readFile(resolve(bailianRoot, '.short-drama', 'voices.json'), 'utf8'))
    if (ledgerAfter.voices.length !== 1 || ledgerAfter.voices[0].voice_id !== 'cosyvoice-v3.5-plus-cl1') throw new Error('删除后本地登记未收敛')
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.BAILIAN_API_KEY
    else process.env.BAILIAN_API_KEY = originalKey
    await rm(bailianRoot, { recursive: true, force: true })
  }
}
```

注意：`listReferenceUploads` 已在文件第 13 行 import，直接复用。

- [ ] **Step 5: 在 main() 中调用新函数**

在第 108 行 `await checkMultiEpisodeEvidence()` 之后加一行：

```js
  await checkBailianVoiceLifecycle()
```

- [ ] **Step 6: 跑完整集成自检**

Run: `node scripts/integration-self-check.mjs --self-check`
Expected: 退出码 0（其中原有 litterbox 真实上传环节保持通过；新增断言全部本地完成）。

- [ ] **Step 7: Commit**

```bash
git add scripts/integration-self-check.mjs
git commit -m "test: 集成自检覆盖百炼配音配置、声音工具与托管能力

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: 文档、环境变量说明与插件版本

**Files:**
- Modify: `skills/configure-generation-providers/SKILL.md`
- Modify: `skills/design-drama-audio/SKILL.md`
- Modify: `skills/drama-generation-service/SKILL.md`
- Modify: `README.md`
- Modify: `.codex-plugin/plugin.json`

- [ ] **Step 1: configure-generation-providers 增加百炼段**

frontmatter 第 3 行 description 中的 "用于选择 StarRouter、RunningHub 或 Comfly" 改为 "用于选择阿里云百炼、StarRouter、RunningHub 或 Comfly"。

在第 13 行（"## 配置生成 Provider" 内容区、StarRouter bullet `- StarRouter：...` 之前）插入百炼 bullet（排第一，作为默认推荐）：

```markdown
- **阿里云百炼（配音默认推荐）**：环境变量 `BAILIAN_API_KEY`（[DashScope 控制台](https://bailian.console.aliyun.com/) 获取），只提供语音模态。音频模型按推荐顺序为 `cosyvoice-v3.5-plus`、`cosyvoice-v3.5-flash`、`cosyvoice-v3-plus`、`cosyvoice-v3-flash`、`cosyvoice-v2`、`qwen3-tts-vd-2026-01-26`。其中 v3.5-plus/flash 只接受自定义音色，必须先用 `design_voice`（文本描述设计）或 `clone_voice`（授权参考音频克隆）取得 voice_id 并写入 audio-plan 的 `voice_bindings`；`cosyvoice-v2` 支持预置音色，可零门槛起步。模型参数：`speed`（0.5–2）、`response_format`（wav/mp3/pcm/opus，v2 无 opus）、`sample_rate`（8000/16000/22050/24000/44100/48000）、`volume`（0–100）、`pitch`（0.5–2）、`language_hints`（v3.5/flash 11 语种、v3-plus 7 语种、v2 仅 zh/en）、`instruction`（仅 v3.5-plus/flash 与 v3-flash，加权长度 ≤100）；qwen 模型仅 `language_type`（Chinese/English）。声音管理工具为 `design_voice`/`clone_voice`/`list_voices`/`delete_voice`；克隆本地音频会临时公网发布 72h，必须显式选择 `usage_scope` 并确认三项权利条款。
```

- [ ] **Step 2: design-drama-audio 改为百炼首选流程**

第 10 行段落中 "设计或克隆得到真实音色 ID 后" 之前补一句工具链说明（在该句句首加）：

```markdown
配音默认推荐阿里云百炼：先调用 `design_voice`（声音描述）或 `clone_voice`（已授权参考音频；必须传 usage_scope 与三项权利确认）取得真实音色 ID，本地登记可通过 `list_voices` 跨集查看、`delete_voice` 收敛；
```

把第 12 行段落开头 "音频通过 `drama-generation-service` 交给用户确认的 Provider。" 之后插入百炼合成约定：

```markdown
百炼路径使用 `generate_audio`（provider=bailian，model 与 audio-plan 绑定一致），推荐 `cosyvoice-v3.5-plus`；voice 必须传 `design_voice`/`clone_voice` 返回的自定义音色 ID，v3.5-plus/flash 拒绝预置音色；instruction 仅 v3.5-plus/flash 与 v3-flash 接受（加权长度 ≤100），语言 hint 必须在目标模型矩阵内；长文本自动按标点分段并合并为 wav（选 mp3/pcm/opus 时按帧流拼接），逐句结果仍登记到 `assets/audio/`。
```

原 StarRouter 句子（"StarRouter 可使用 `speech-2.8-hd`……"）保留不动，作为备选路径。

- [ ] **Step 3: drama-generation-service 工具可用性清单**

第 10 行的工具列表句中，在 `generate_audio` 之后加入四个新工具：

```markdown
`design_voice`、`clone_voice`、`list_voices`、`delete_voice`
```

即该句变为 "如果当前任务的 MCP 工具列表没有 `list_generation_providers`、`list_models`、`generate_image`、`submit_video`、`generate_audio`、`design_voice`、`clone_voice`、`list_voices`、`delete_voice` 或需要配乐时没有 `generate_music`，必须停止……"。

- [ ] **Step 4: README 更新**

第 6 行架构链路改为：

```markdown
Codex → oh-my-short-drama → drama-generation MCP → 阿里云百炼 / StarRouter / RunningHub / Comfly
```

在 "## 支持的生成 Provider" 章节描述段（第 41 行凭据说明段）之后、StarRouter 小节之前插入百炼小节（下面外层用四反引号围栏，因为内容本身含 bash 代码围栏）：

````markdown
### 阿里云百炼（配音默认推荐）

```bash
export BAILIAN_API_KEY='your-dashscope-key'
```

只提供语音模态：CosyVoice 全系列（推荐 `cosyvoice-v3.5-plus`，需先设计/克隆自定义音色；`cosyvoice-v2` 支持预置音色）与 `qwen3-tts-vd-2026-01-26`。通过 `design_voice`（文本设计音色）、`clone_voice`（参考音频克隆，本地素材自动临时发布 72h，需确认权利与使用范围）、`list_voices`、`delete_voice` 管理音色；音色登记保存在项目 `.short-drama/voices.json`，预览音频保存在 `.short-drama/voice-previews/`。
````

第 152 行附近的 MCP 工具清单（`- list_generation_providers` 所在列表）加入：

```markdown
- `design_voice` / `clone_voice` / `list_voices` / `delete_voice`
```

- [ ] **Step 5: bump 插件版本时间戳**

Run:

```bash
node -e "const fs=require('fs');const p='.codex-plugin/plugin.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));j.version=j.version.replace(/\+codex\..*$/, '+codex.' + new Date().toISOString().replace(/[-:T]/g,'').slice(0,14));fs.writeFileSync(p, JSON.stringify(j,null,2)+'\n')"
```

- [ ] **Step 6: 全量回归**

Run: `node scripts/integration-self-check.mjs --self-check`
Expected: 退出码 0。

- [ ] **Step 7: Commit**

```bash
git add skills/configure-generation-providers/SKILL.md skills/design-drama-audio/SKILL.md skills/drama-generation-service/SKILL.md README.md .codex-plugin/plugin.json
git commit -m "docs: 百炼列为默认推荐配音，补充声音设计/克隆工具与凭证说明

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 完成定义

- `node scripts/integration-self-check.mjs --self-check` 退出码 0。
- `list_generation_providers` 返回中 `bailian` 排第一且 `capabilities.audio === true`、`voice_design === true`（配置 `BAILIAN_API_KEY` 后可手工验证）。
- 有真实 key 时的可选冒烟：在测试项目内 `design_voice` → `list_voices` 看到新音色 → `generate_audio`（voice=该 voice_id）→ `delete_voice` 收敛；无 key 时不做网络验证。
