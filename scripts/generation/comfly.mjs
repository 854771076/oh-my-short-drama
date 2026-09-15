import { randomUUID } from 'node:crypto'
import { credential } from './credentials.mjs'

const BASE_URL = (process.env.COMFLY_BASE_URL || 'https://vvicat-comfly-prod.vvicat.dev').replace(/\/+$/, '')
const MODEL = 'minimax-h3'

function formatRemoteError(value, fallback = 'COMFLY_TASK_FAILED') {
  if (value == null || value === '') return fallback
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message || fallback
  try { return JSON.stringify(value) } catch { return Object.prototype.toString.call(value) }
}

function config() {
  const token = credential('COMFLY_TOKEN')
  if (!token) throw new Error('COMFLY_TOKEN 未配置')
  const appId = Number(process.env.COMFLY_APP_ID || 0)
  if (!Number.isSafeInteger(appId) || appId < 0) throw new Error('COMFLY_APP_ID 必须是非负整数')
  return { token, appId }
}

function confirm(input) {
  if (input.confirmed !== true) throw new Error('付费生成前必须取得用户确认，并传 confirmed=true')
}

async function request(path, init) {
  const { token } = config()
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...(init?.headers || {}) },
    signal: AbortSignal.timeout(30_000),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`COMFLY_REQUEST_FAILED(${response.status})`)
  if (!payload || Number(payload.code) !== 0 || payload.data === undefined) throw new Error(`COMFLY_RESPONSE_INVALID: ${formatRemoteError(payload?.msg, 'COMFLY_RESPONSE_INVALID')}`)
  return payload.data
}

function urls(values) {
  return (values || []).filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim())
}

async function validateRemoteImage(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, { method: 'GET', headers: { Range: 'bytes=0-15' }, signal: AbortSignal.timeout(15000) })
  const contentType = response.headers.get('content-type') || ''
  const reader = response.body?.getReader()
  const first = reader ? (await reader.read()).value : new Uint8Array(await response.arrayBuffer())
  try { await reader?.cancel() } catch {}
  const bytes = Buffer.from(first || [])
  const image = bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) || bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')) || bytes.subarray(0, 4).toString() === 'RIFF' || bytes.subarray(0, 6).toString() === 'GIF87a' || bytes.subarray(0, 6).toString() === 'GIF89a'
  if (!response.ok || !image || (!contentType.startsWith('image/') && contentType !== 'application/octet-stream')) throw new Error(`Comfly 参考图 URL 不是有效图片流：HTTP ${response.status}，Content-Type ${contentType || 'missing'}`)
}

function publicUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || ['localhost', '127.0.0.1', '::1'].includes(url.hostname)) throw new Error('Comfly 参考素材必须是可公开读取的 HTTPS URL；本地文件需先上传到用户确认的存储')
  return url.href
}

function validateH3(input) {
  if (input.input_mode !== 'Ref2VA') throw new Error('Comfly MiniMax H3 只接受 input_mode=Ref2VA')
  if (!Number.isInteger(input.duration) || input.duration < 5 || input.duration > 15) throw new Error('Comfly MiniMax H3 duration 必须为 5–15 秒整数')
  const sections = ['subject_definitions:', 'summary:', 'retention_analysis:', 'detailed_description:', 'overall_soundscape:', 'non_diegetic_music:']
  const positions = sections.map((section) => input.prompt?.indexOf(section) ?? -1)
  if (positions.some((position) => position < 0) || positions.some((position, index) => index > 0 && position <= positions[index - 1])) throw new Error('Comfly MiniMax H3 提示词段落结构无效')
  const images = urls([input.frame_url, input.input_reference, ...(input.images || []), ...(input.reference_image_urls || [])])
  const videos = urls(input.reference_video_urls)
  const manifest = Array.isArray(input.reference_manifest) ? input.reference_manifest : []
  if (manifest.length !== images.length + videos.length) throw new Error('Comfly reference_manifest 与实际素材数量不一致')
  for (const [type, count] of [['image', images.length], ['video', videos.length]]) {
    const items = manifest.filter((item) => item?.type === type)
    if (items.length !== count || items.some((item, index) => item.order !== index + 1 || typeof item.role !== 'string' || !item.role.trim())) throw new Error(`Comfly ${type} 参考素材顺序或角色无效`)
  }
}

function dimensions(input) {
  if (!input.resolution && !input.ratio) return null
  if (!['16:9', '9:16'].includes(input.ratio)) throw new Error('Comfly ratio 只能是 16:9 或 9:16')
  const long = input.resolution === '1K' ? 1024 : input.resolution === '2K' ? 2048 : input.resolution === '720p' ? null : undefined
  if (long === undefined) throw new Error('Comfly resolution 只能是 720p、1K 或 2K')
  if (long) return input.ratio === '16:9' ? { width: long, height: Math.round(long * 9 / 16) } : { width: Math.round(long * 9 / 16), height: long }
  return input.ratio === '16:9' ? { width: 1280, height: 720 } : { width: 720, height: 1280 }
}

function workflow(input) {
  if (input.model !== MODEL) throw new Error(`Comfly 只支持 ${MODEL}`)
  const inputValues = { input_duration: input.duration, input_prompt: input.prompt.trim() }
  const audios = urls(input.reference_audio_urls)
  if (audios.length) throw new Error('Comfly MiniMax H3 不支持参考音频')
  const videos = urls(input.reference_video_urls)
  const images = urls([input.frame_url, input.input_reference, ...(input.images || []), ...(input.reference_image_urls || [])])
  if (videos.length > 1) throw new Error('Comfly MiniMax H3 最多一个参考视频')
  if (videos.length) {
    if (images.length) throw new Error('Comfly MiniMax H3 参考视频不能与参考图片混用')
    inputValues.input_video = publicUrl(videos[0])
    return { id: 1521, inputValues }
  }
  if (images.length < 1 || images.length > 3) throw new Error('Comfly MiniMax H3 需要 1–3 张参考图片')
  const names = images.length === 1 ? ['input_image'] : images.length === 2 ? ['input_image_l', 'input_image_r'] : ['input_image_l', 'input_image_m', 'input_image_r']
  images.forEach((value, index) => { inputValues[names[index]] = publicUrl(value) })
  const size = dimensions(input)
  if (size) { inputValues.input_width = size.width; inputValues.input_height = size.height }
  return { id: (size ? 1539 : 1517) + images.length, inputValues }
}

export const comfly = {
  label: 'Comfly', credentialEnv: 'COMFLY_TOKEN', catalog: { image: [], video: [MODEL], audio: [] },
  capabilities: { text: false, image: false, video: true, audio: false, 'video.native-audio': true, 'transform.lip-sync': false, 'transform.video-inpaint': false, 'transform.video-upscale': false },
  async models() { return { provider: 'comfly', video_models: [MODEL], constraints: { images: '1..3', videos: '0..1', audios: 0, duration: '5..15', ratios: ['16:9', '9:16'], resolutions: ['720p', '1K', '2K'] } } },
  async testConnection() { await request('/internal/comfly/input-fields?model=comfyui&type=1518', { method: 'GET' }) },
  async text() { throw new Error('Comfly 不提供通用文本生成') },
  async image() { throw new Error('Comfly 当前未接入图片生成') },
  async audio() { throw new Error('Comfly 当前未接入音频生成') },
  async submitVideo(input) {
    confirm(input)
    if (input.prompt_profile !== 'h3') throw new Error('Comfly MiniMax H3 必须使用 prompt_profile=h3')
    validateH3(input)
    for (const url of urls([input.frame_url, input.input_reference, ...(input.images || []), ...(input.reference_image_urls || [])])) await validateRemoteImage(url)
    const { id, inputValues } = workflow(input)
    const { appId } = config()
    const data = await request(`/internal/comfly/tasks?model=comfyui&type=${id}`, { method: 'POST', body: JSON.stringify({ app_id: appId, app_task_id: randomUUID(), input_values: inputValues, workflow: id }) })
    const taskId = String(data.task_id ?? '').trim()
    if (!taskId) throw new Error('COMFLY_TASK_ID_MISSING')
    return { task_id: taskId, provider: 'comfly', media_type: 'video', model: MODEL, status: 'submitted' }
  },
  async task(input) {
    if (!input.task_id?.trim()) throw new Error('task_id 必填')
    const data = await request(`/internal/comfly/tasks/${encodeURIComponent(input.task_id)}`)
    const status = String(data.status || '').toLowerCase()
    if (['pending', 'running'].includes(status)) return { provider: 'comfly', status: 'pending' }
    if (['failed', 'canceled'].includes(status)) return { provider: 'comfly', status: 'failed', error: formatRemoteError(data.error ?? data.msg ?? data.reason), error_details: typeof (data.error ?? data.msg ?? data.reason) === 'object' ? (data.error ?? data.msg ?? data.reason) : undefined }
    if (status === 'success') {
      const url = (data.files || []).find((value) => typeof value === 'string' && value.trim())
      return url ? { provider: 'comfly', status: 'completed', outputs: [{ url, media_type: 'video' }] } : { provider: 'comfly', status: 'failed', error: 'COMFLY_OUTPUT_MISSING' }
    }
    return { provider: 'comfly', status: 'failed', error: `COMFLY_TASK_STATUS_INVALID: ${status || 'empty'}` }
  },
}

export function selfCheck() {
  if (!formatRemoteError({ code: 'E', message: '失败' }).includes('"message":"失败"')) throw new Error('Comfly 远端错误序列化自检失败')
  const prompt = 'subject_definitions:\nA\nsummary:\nA\nretention_analysis:\nA\ndetailed_description:\nA\noverall_soundscape:\nA\nnon_diegetic_music:\nN/A'
  const oneInput = { model: MODEL, prompt, prompt_profile: 'h3', input_mode: 'Ref2VA', duration: 5, reference_image_urls: ['https://example.com/a.png'], reference_manifest: [{ type: 'image', order: 1, role: '人物身份与服装连续性' }] }
  validateH3(oneInput)
  const one = workflow(oneInput)
  if (one.id !== 1518 || one.inputValues.input_image !== 'https://example.com/a.png') throw new Error('Comfly 工作流映射自检失败')
  const threeInput = { ...oneInput, ratio: '16:9', resolution: '2K', reference_image_urls: ['https://example.com/a.png', 'https://example.com/b.png', 'https://example.com/c.png'], reference_manifest: [1, 2, 3].map((order) => ({ type: 'image', order, role: 'reference_image' })) }
  validateH3(threeInput)
  const three = workflow(threeInput)
  if (three.id !== 1542 || three.inputValues.input_width !== 2048) throw new Error('Comfly 三图尺寸工作流映射自检失败')
}
