import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { credential } from './credentials.mjs'

const BASE_URL = (process.env.RUNNINGHUB_BASE_URL || 'https://www.runninghub.ai').replace(/\/+$/, '')
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024
const H3_MODEL = 'minimax-h3-reference-to-video'
const H3_WORKFLOW_ID = process.env.RUNNINGHUB_H3_WORKFLOW_ID || '2086743729407733762'
const H3_TEMPLATE = JSON.parse(await readFile(new URL('./minimax-h3-workflow.json', import.meta.url), 'utf8'))
const KREA2_MODEL = 'krea2-normal-v1'
const KREA2_WORKFLOW_ID = process.env.RUNNINGHUB_KREA2_WORKFLOW_ID || '2096515700701929473'
const KREA2_TEMPLATE = JSON.parse(await readFile(new URL('./krea2-normal-v1-workflow.json', import.meta.url), 'utf8'))
const SEEDVR25_MODEL = 'seedvr2.5-video-upscale'
const SEEDVR25_WORKFLOW_ID = '2099866760106491906'
const SEEDVR25_MAPPING = JSON.parse(await readFile(new URL('./seedvr2.5-video-upscale.mapping.json', import.meta.url), 'utf8'))
const TRANSFORM_WORKFLOW_ENVS = { 'lip-sync': 'RUNNINGHUB_LIP_SYNC_WORKFLOW_ID', 'video-inpaint': 'RUNNINGHUB_VIDEO_INPAINT_WORKFLOW_ID', 'video-upscale': 'RUNNINGHUB_VIDEO_UPSCALE_WORKFLOW_ID' }
const transformWorkflow = (operation) => operation === 'video-upscale' ? SEEDVR25_WORKFLOW_ID : process.env[TRANSFORM_WORKFLOW_ENVS[operation]] || null
const transformWorkflows = () => Object.fromEntries(Object.keys(TRANSFORM_WORKFLOW_ENVS).map((operation) => [operation, transformWorkflow(operation)]))
const KREA2_DIMENSIONS = {
  '1K': { '1:1': [1024, 1024], '16:9': [1024, 576], '9:16': [576, 1024], '3:4': [768, 1024], '4:3': [1024, 768], '2:3': [680, 1024], '3:2': [1024, 680] },
  '2K': { '1:1': [2048, 2048], '16:9': [2048, 1152], '9:16': [1152, 2048], '3:4': [1536, 2048], '4:3': [2048, 1536], '2:3': [1360, 2048], '3:2': [2048, 1360] },
}
const H3_RATIOS = { '16:9': '16:9 (Widescreen)', '9:16': '9:16 (Portrait Widescreen)' }
const H3_MEGAPIXELS = { '480p': 0.4, '720p': 0.9, '1K': 1, '2K': 2 }
const MAX_CONCURRENT_SUBMISSIONS = 2
// ponytail: 当前按 MCP 进程内的 API Key 限流；多进程共享密钥时再升级为跨进程信号量。
const submissionStates = new Map()

async function withSubmissionSlot(key, action) {
  let state = submissionStates.get(key)
  if (!state) submissionStates.set(key, state = { active: 0, waiting: [] })
  await new Promise((ready) => {
    if (state.active < MAX_CONCURRENT_SUBMISSIONS) { state.active += 1; ready() }
    else state.waiting.push(ready)
  })
  try { return await action() }
  finally {
    const next = state.waiting.shift()
    if (next) next()
    else {
      state.active -= 1
      if (state.active === 0) submissionStates.delete(key)
    }
  }
}

function apiKey() {
  const value = credential('RUNNINGHUB_API_KEY')
  if (!value) throw new Error('RUNNINGHUB_API_KEY 未配置')
  return value
}

function confirm(input) {
  if (input.confirmed !== true) throw new Error('付费生成前必须取得用户确认，并传 confirmed=true')
}

async function responseJson(response) {
  const raw = await response.text()
  let data
  try { data = raw ? JSON.parse(raw) : {} } catch { throw new Error('RUNNINGHUB_RESPONSE_INVALID_JSON') }
  if (!response.ok) throw new Error(`RUNNINGHUB_REQUEST_FAILED(${response.status}): ${String(data?.msg || data?.message || raw).slice(0, 500)}`)
  return data
}

async function request(path, init) {
  return responseJson(await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey()}`, ...(init?.headers || {}) },
    signal: AbortSignal.timeout(init?.timeout ?? 120_000),
  }))
}

async function upload(path) {
  if ((await stat(path)).size > MAX_UPLOAD_BYTES) throw new Error(`RunningHub 参考素材超过 200MB：${path}`)
  const form = new FormData()
  form.append('file', new Blob([await readFile(path)]), basename(path))
  const payload = await request('/openapi/v2/media/upload/binary', { method: 'POST', body: form })
  if (![0, 200, '0', '200', undefined].includes(payload.code)) throw new Error(`RUNNINGHUB_UPLOAD_FAILED: ${String(payload.msg || payload.code)}`)
  const filename = payload?.data?.filename || payload?.data?.fileName
  if (!filename) throw new Error('RUNNINGHUB_UPLOAD_FILENAME_MISSING')
  return filename
}

function replaceMarkers(value, prompt, assets) {
  if (value === '@prompt') return prompt
  const match = typeof value === 'string' && /^@asset:(\d+)$/.exec(value)
  if (match) {
    const asset = assets[Number(match[1])]
    if (!asset) throw new Error(`RunningHub 素材占位不存在：${value}`)
    return asset
  }
  if (Array.isArray(value)) return value.map((item) => replaceMarkers(item, prompt, assets))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replaceMarkers(child, prompt, assets)]))
  return value
}

function validateVideoPrompt(input) {
  if (input.prompt_profile !== 'h3') return
  if (!['T2VA', 'I2VA', 'FL2VA', 'L2VA', 'Ref2VA'].includes(input.input_mode)) throw new Error('MiniMax H3 input_mode 无效')
  if (input.prompt.includes('@图片') || input.prompt.includes('@视频') || input.prompt.includes('@音频')) throw new Error('MiniMax H3 提示词不得混入 Seedance 引用语法')
  const sections = input.input_mode === 'Ref2VA'
    ? ['subject_definitions:', 'summary:', 'retention_analysis:', 'detailed_description:', 'overall_soundscape:', 'non_diegetic_music:']
    : ['integrated_multimodal_description:', 'overall_soundscape:', 'non_diegetic_music:']
  const positions = sections.map((section) => input.prompt.indexOf(section))
  if (positions.some((position) => position < 0) || positions.some((position, index) => index > 0 && position <= positions[index - 1])) throw new Error('MiniMax H3 提示词段落结构无效')
}

function h3Paths(input, key, fallback = []) {
  const values = input[key] ?? fallback
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string' || !value.trim())) throw new Error(`RunningHub H3 ${key} 必须是本地文件路径数组`)
  return values
}

function validateH3References(input, groups) {
  const counts = Object.fromEntries(groups.map(([name, paths]) => [name, paths.length]))
  const manifest = Array.isArray(input.reference_manifest) ? input.reference_manifest : []
  if (manifest.length !== counts.images + counts.videos + counts.audios) throw new Error('RunningHub H3 reference_manifest 与实际素材数量不一致')
  for (const [name, paths] of groups) {
    const type = name.slice(0, -1)
    const items = manifest.filter((item) => item?.type === type)
    if (items.length !== paths.length || items.some((item, index) => item.order !== index + 1)) throw new Error(`RunningHub H3 ${type} 素材顺序无效`)
  }
  const keyframes = manifest.filter((item) => ['first_frame', 'last_frame'].includes(item.role))
  const references = manifest.filter((item) => ['reference_image', 'reference_video', 'reference_audio'].includes(item.role))
  if (keyframes.length + references.length !== manifest.length || keyframes.some((item) => item.type !== 'image')) throw new Error('RunningHub H3 reference_manifest 包含无效素材角色')
  const expected = { T2VA: [0, 0], I2VA: [1, 0], FL2VA: [2, 0], L2VA: [1, 0], Ref2VA: [0, 1] }[input.input_mode]
  if (!expected || keyframes.length !== expected[0] || (expected[1] ? references.length < expected[1] : references.length !== 0)) throw new Error(`RunningHub H3 素材与 ${input.input_mode} 不匹配`)
  if (input.input_mode === 'I2VA' && keyframes[0]?.role !== 'first_frame') throw new Error('RunningHub H3 I2VA 必须使用 first_frame')
  if (input.input_mode === 'FL2VA' && keyframes.map((item) => item.role).join() !== 'first_frame,last_frame') throw new Error('RunningHub H3 FL2VA 必须依次使用 first_frame、last_frame')
  if (input.input_mode === 'L2VA' && keyframes[0]?.role !== 'last_frame') throw new Error('RunningHub H3 L2VA 必须使用 last_frame')
  const roles = { image: 'reference_image', video: 'reference_video', audio: 'reference_audio' }
  if (references.some((item) => item.role !== roles[item.type])) throw new Error('RunningHub H3 参考素材 role 与类型不匹配')
}

async function submitH3(input) {
  confirm(input)
  const duration = Math.max(5, Math.round(input.duration || 5))
  const ratio = input.ratio || '16:9'
  const resolution = input.resolution || '1K'
  if (duration > 15) throw new Error('RunningHub H3 duration 必须为 1–15 秒，1–4 秒会归一为 5 秒')
  if (!H3_RATIOS[ratio]) throw new Error('RunningHub H3 ratio 只能是 16:9 或 9:16')
  if (!H3_MEGAPIXELS[resolution]) throw new Error('RunningHub H3 resolution 只能是 480p、720p、1K 或 2K')
  const groups = [
    ['images', h3Paths(input, 'reference_image_paths', input.reference_paths || []), 9, 100, 'LoadImage', 'ref_images.ref_image_'],
    ['videos', h3Paths(input, 'reference_video_paths'), 2, 120, 'VHS_LoadVideo', 'ref_videos.ref_video_'],
    ['audios', h3Paths(input, 'reference_audio_paths'), 2, 140, 'LoadAudio', 'ref_audios.ref_audio_'],
  ]
  for (const [name, paths, maximum] of groups) if (paths.length > maximum) throw new Error(`RunningHub H3 ${name} 数量超过 ${maximum}`)
  validateH3References(input, groups)
  if (!input.prompt?.trim() && groups.every(([, paths]) => paths.length === 0)) throw new Error('RunningHub H3 纯文本生成必须提供 prompt')
  const workflow = structuredClone(H3_TEMPLATE)
  workflow['25'].inputs.value = input.prompt || ''
  workflow['28'].inputs.value = duration
  workflow['26'].inputs.aspect_ratio = H3_RATIOS[ratio]
  workflow['26'].inputs.megapixels = H3_MEGAPIXELS[resolution]
  for (const [name, paths, , start, classType, slot] of groups) {
    const uploaded = []
    for (const path of paths) uploaded.push(await upload(path))
    uploaded.forEach((asset, index) => {
      const id = String(start + index)
      const inputs = name === 'videos'
        ? { video: asset, force_rate: 0, custom_width: 0, custom_height: 0, frame_load_cap: 0, skip_first_frames: 0, select_every_nth: 1 }
        : name === 'images' ? { image: asset } : { audio: asset }
      workflow[id] = { inputs, class_type: classType, _meta: { title: classType } }
      workflow['31'].inputs[`${slot}${index}`] = [id, 0]
    })
  }
  const payload = await request('/task/openapi/create', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: apiKey(), workflowId: H3_WORKFLOW_ID, workflow: JSON.stringify(workflow), addMetadata: false }),
  })
  if (Number(payload.code) !== 0 || !payload?.data?.taskId) throw new Error(`RUNNINGHUB_H3_SUBMIT_FAILED: ${String(payload.msg || payload.code)}`)
  return { task_id: payload.data.taskId, provider: 'runninghub', media_type: 'video', model: H3_MODEL, workflow_id: H3_WORKFLOW_ID, status: 'submitted' }
}

async function submitKrea2(input) {
  confirm(input)
  if (!input.prompt?.trim()) throw new Error('RunningHub Krea2 prompt 必填')
  if (input.reference_paths?.length) throw new Error('RunningHub Krea2 普通工作流暂不支持参考图')
  if (input.n !== undefined && input.n !== 1) throw new Error('RunningHub Krea2 当前每次只生成 1 张图片')
  const resolution = input.resolution || '2K'
  const ratio = input.aspect_ratio || '4:3'
  const dimensions = KREA2_DIMENSIONS[resolution]?.[ratio]
  if (!dimensions) throw new Error('RunningHub Krea2 仅支持 1K/2K 与 1:1、16:9、9:16、3:4、4:3、2:3、3:2')
  const workflow = structuredClone(KREA2_TEMPLATE)
  workflow['5'].inputs.text = input.prompt
  ;[workflow['8'].inputs.width, workflow['8'].inputs.height] = dimensions
  if (Number.isInteger(input.seed) && input.seed > 0) workflow['51'].inputs.seed = input.seed
  const payload = await request('/task/openapi/create', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: apiKey(), workflowId: KREA2_WORKFLOW_ID, workflow: JSON.stringify(workflow), addMetadata: false }),
  })
  if (Number(payload.code) !== 0 || !payload?.data?.taskId) throw new Error(`RUNNINGHUB_KREA2_SUBMIT_FAILED: ${String(payload.msg || payload.code)}`)
  return { task_id: payload.data.taskId, provider: 'runninghub', media_type: 'image', model: KREA2_MODEL, workflow_id: KREA2_WORKFLOW_ID, status: 'submitted' }
}

async function submit(input, modality) {
  confirm(input)
  if (modality === 'video') validateVideoPrompt(input)
  const workflowEnv = { image: 'RUNNINGHUB_IMAGE_WORKFLOW_ID', video: 'RUNNINGHUB_VIDEO_WORKFLOW_ID', audio: 'RUNNINGHUB_AUDIO_WORKFLOW_ID' }
  const workflowId = input.workflow_id || process.env[workflowEnv[modality]]
  if (!workflowId?.trim()) throw new Error(`RunningHub ${modality} workflow_id 未配置`)
  if (!Array.isArray(input.node_info_list) || input.node_info_list.length === 0) throw new Error('RunningHub node_info_list 必填')
  const paths = Array.isArray(input.reference_paths) ? input.reference_paths : []
  const assets = []
  for (const path of paths) assets.push(await upload(path))
  const nodeInfoList = replaceMarkers(input.node_info_list, input.prompt || '', assets)
  const payload = await request('/task/openapi/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: apiKey(), workflowId, nodeInfoList, addMetadata: true }),
  })
  if (Number(payload.code) !== 0) throw new Error(`RUNNINGHUB_SUBMIT_FAILED: ${String(payload.msg || payload.code)}`)
  const taskId = payload?.data?.taskId
  if (!taskId) throw new Error('RUNNINGHUB_TASK_ID_MISSING')
  return { task_id: taskId, provider: 'runninghub', media_type: modality, status: 'submitted' }
}

export async function submitSeedVr25(input) {
  confirm(input)
  if (input.operation !== 'video-upscale' || input.model !== SEEDVR25_MODEL) throw new Error('SeedVR2.5 只支持 video-upscale')
  if (input.workflow_id && String(input.workflow_id) !== SEEDVR25_WORKFLOW_ID) throw new Error('SeedVR2.5 必须使用固定工作流 2099866760106491906')
  if (!input.source_video_path?.trim()) throw new Error('SeedVR2.5 source_video_path 必填')
  const fileName = await upload(input.source_video_path)
  const nodeInfoList = [{ nodeId: SEEDVR25_MAPPING.video_input.node_id, fieldName: SEEDVR25_MAPPING.video_input.field_name, fieldValue: fileName }]
  const payload = await request('/task/openapi/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: apiKey(), workflowId: SEEDVR25_WORKFLOW_ID, nodeInfoList, addMetadata: false }),
  })
  if (Number(payload.code) !== 0 || !payload?.data?.taskId) throw new Error(`RUNNINGHUB_SEEDVR25_SUBMIT_FAILED: ${String(payload.msg || payload.code)}`)
  return { task_id: payload.data.taskId, provider: 'runninghub', media_type: 'video', model: SEEDVR25_MODEL, workflow_id: SEEDVR25_WORKFLOW_ID, status: 'submitted' }
}

function outputUrls(data, found = []) {
  if (!data || typeof data !== 'object') return found
  for (const name of ['url', 'fileUrl', 'videoUrl', 'video_url', 'downloadUrl', 'download_url']) {
    const value = data[name]
    if (typeof value === 'string' && /^https?:\/\//.test(value)) found.push(value)
  }
  for (const child of Object.values(data)) if (child && typeof child === 'object') outputUrls(child, found)
  return [...new Set(found)]
}

function taskResult(payload) {
  const data = payload?.data ?? payload
  const status = String(data?.status || '').toUpperCase()
  if (['QUEUED', 'RUNNING', 'PENDING'].includes(status) || [804, 813].includes(Number(payload?.code))) return { provider: 'runninghub', status: 'pending' }
  if (['FAILED', 'ERROR'].includes(status) || Number(payload?.code) === 805) return { provider: 'runninghub', status: 'failed', error: String(data?.errorMessage || data?.failedReason?.message || payload?.msg || '任务失败') }
  const urls = outputUrls(data?.results ?? data)
  if (['SUCCESS', 'SUCCEEDED', 'COMPLETED'].includes(status) || urls.length) return urls.length
    ? { provider: 'runninghub', status: 'completed', outputs: urls.map((url) => ({ url })) }
    : { provider: 'runninghub', status: 'pending' }
  if (![0, 200].includes(Number(payload?.code))) return { provider: 'runninghub', status: 'failed', error: String(payload?.msg || payload?.code || status || '未知任务状态') }
  return { provider: 'runninghub', status: 'pending' }
}

export const runninghub = {
  label: 'RunningHub', credentialEnv: 'RUNNINGHUB_API_KEY',
  catalog: { image: [...new Set([KREA2_MODEL, process.env.RUNNINGHUB_IMAGE_WORKFLOW_ID].filter(Boolean))], video: [H3_MODEL, process.env.RUNNINGHUB_VIDEO_WORKFLOW_ID].filter(Boolean), audio: [process.env.RUNNINGHUB_AUDIO_WORKFLOW_ID].filter(Boolean), get transform() { return [SEEDVR25_MODEL, ...Object.entries(transformWorkflows()).filter(([operation, workflow]) => operation !== 'video-upscale' && workflow).map(([, workflow]) => workflow)] } },
  capabilities: { text: false, image: true, video: true, audio: true, 'video.native-audio': true, get 'transform.lip-sync'() { return Boolean(transformWorkflow('lip-sync')) }, get 'transform.video-inpaint'() { return Boolean(transformWorkflow('video-inpaint')) }, get 'transform.video-upscale'() { return Boolean(transformWorkflow('video-upscale')) } },
  async models() {
    return { provider: 'runninghub', image_models: [KREA2_MODEL], video_models: [H3_MODEL], workflows: { image: process.env.RUNNINGHUB_IMAGE_WORKFLOW_ID || null, krea2_image: KREA2_WORKFLOW_ID, video: process.env.RUNNINGHUB_VIDEO_WORKFLOW_ID || null, h3_video: H3_WORKFLOW_ID, audio: process.env.RUNNINGHUB_AUDIO_WORKFLOW_ID || null, transforms: transformWorkflows() } }
  },
  async testConnection() {
    const value = apiKey()
    const payload = await request('/uc/openapi/accountStatus', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apikey: value }), timeout: 20_000 })
    if (Number(payload.code) !== 0) throw new Error(`RUNNINGHUB_REQUEST_FAILED(${payload.code}): ${String(payload.msg || '认证失败')}`)
  },
  async text() { throw new Error('RunningHub 不提供通用文本生成') },
  async image(input) {
    confirm(input)
    return withSubmissionSlot(apiKey(), () => input.model === KREA2_MODEL ? submitKrea2(input) : submit(input, 'image'))
  },
  async submitVideo(input) {
    confirm(input); validateVideoPrompt(input)
    return withSubmissionSlot(apiKey(), () => input.model === H3_MODEL ? submitH3(input) : submit(input, 'video'))
  },
  async audio(input) {
    confirm(input)
    return withSubmissionSlot(apiKey(), () => submit(input, 'audio'))
  },
  async transform(input) {
    confirm(input)
    if (input.operation === 'video-upscale') {
      if (input.model !== SEEDVR25_MODEL) throw new Error(`RunningHub video-upscale 必须使用 ${SEEDVR25_MODEL}`)
      return withSubmissionSlot(apiKey(), () => submitSeedVr25(input))
    }
    const workflowId = transformWorkflow(input.operation)
    if (!workflowId) throw new Error(`RunningHub 未配置 ${input.operation} 变换工作流`)
    if (input.workflow_id && input.workflow_id !== workflowId) throw new Error(`RunningHub ${input.operation} 必须使用已配置工作流`)
    return withSubmissionSlot(apiKey(), () => submit({ ...input, workflow_id: workflowId }, 'video'))
  },
  async task(input) {
    if (!input.task_id?.trim()) throw new Error('task_id 必填')
    const payload = await request('/openapi/v2/query', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: input.task_id }), timeout: 30_000,
    })
    const result = taskResult(payload)
    if (result.outputs) result.outputs = result.outputs.map((item) => ({ ...item, media_type: input.media_type }))
    return result
  },
}

export async function selfCheck() {
  if (replaceMarkers({ text: '@prompt', image: '@asset:0' }, 'hello', ['a.png']).image !== 'a.png') throw new Error('RunningHub marker 自检失败')
  if (outputUrls([{ url: 'https://example.com/a.png' }, { fileUrl: 'https://example.com/b.png' }]).length !== 2) throw new Error('RunningHub 输出归一化失败')
  if (taskResult({ taskId: '1', status: 'RUNNING', results: null }).status !== 'pending') throw new Error('RunningHub 新版任务状态兼容自检失败')
  if (taskResult({ taskId: '1', status: 'SUCCESS', results: [{ url: 'https://example.com/a.mp4' }] }).status !== 'completed') throw new Error('RunningHub 新版任务结果兼容自检失败')
  validateVideoPrompt({ prompt_profile: 'h3', input_mode: 'T2VA', prompt: 'integrated_multimodal_description: A\noverall_soundscape: A\nnon_diegetic_music: N/A' })
  validateH3References({ input_mode: 'FL2VA', reference_manifest: [{ type: 'image', order: 1, role: 'first_frame' }, { type: 'image', order: 2, role: 'last_frame' }] }, [['images', ['a', 'b']], ['videos', []], ['audios', []]])
  try { validateH3References({ input_mode: 'I2VA', reference_manifest: [] }, [['images', []], ['videos', []], ['audios', []]]); throw new Error('RunningHub H3 模式自检失败') } catch (error) { if (!String(error.message).includes('I2VA')) throw error }
  if (H3_TEMPLATE['31']?.class_type !== 'MiniMaxH3ReferenceToVideo') throw new Error('RunningHub H3 内置工作流无效')
  if (KREA2_TEMPLATE['5']?.class_type !== 'CLIPTextEncode' || KREA2_DIMENSIONS['2K']['9:16'].join('x') !== '1152x2048') throw new Error('RunningHub Krea2 内置工作流无效')
  if (SEEDVR25_MAPPING.workflow_id !== SEEDVR25_WORKFLOW_ID || SEEDVR25_MAPPING.video_input?.node_id !== '25' || SEEDVR25_MAPPING.video_output?.node_id !== '27') throw new Error('RunningHub SeedVR2.5 内置映射无效')
  let active = 0, maximum = 0
  await Promise.all([1, 2, 3, 4].map(() => withSubmissionSlot('self-check-a', async () => {
    active += 1
    maximum = Math.max(maximum, active)
    await new Promise((done) => setTimeout(done, 5))
    active -= 1
  })))
  if (maximum !== 2) throw new Error('RunningHub 单 key 并发上限自检失败')
}
