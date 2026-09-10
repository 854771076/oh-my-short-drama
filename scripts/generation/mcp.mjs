#!/usr/bin/env node
import { createInterface } from 'node:readline'
import { readFile, realpath } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { adapter, normalizeModelParameters, providerCatalog, providerNames, selfCheck as checkProviders } from './providers.mjs'
import { selfCheck as checkStarRouter } from './starrouter.mjs'
import { selfCheck as checkRunningHub } from './runninghub.mjs'
import { selfCheck as checkComfly } from './comfly.mjs'
import { createRequestSnapshot, reserveTask, settleReservedTask } from '../task-ledger.mjs'
import { validateGenerationDocumentReference } from '../document-reference.mjs'
import { mediaHostCatalog, mediaHostNames } from '../media-hosting/providers.mjs'
import { listReferenceUploads, publishReferenceImage } from '../media-hosting/publish.mjs'
import { selfCheck as checkLitterbox } from '../media-hosting/litterbox.mjs'
import { validateVideoReferenceBindings } from '../reference-bindings.mjs'

checkStarRouter()
checkRunningHub()
checkComfly()
checkLitterbox()
checkProviders()

const provider = { type: 'string', enum: providerNames }
const mediaType = { type: 'string', enum: ['image', 'video', 'audio'] }
const imageResolution = { type: 'string', enum: ['1K', '2K', '4K'] }
const imageAspectRatio = { type: 'string', enum: ['1:1', '16:9', '9:16', '4:3', '3:4', '2:3', '3:2'] }
const audioMetadata = {
  type: 'object',
  properties: {
    voice_setting: { type: 'object' }, audio_setting: { type: 'object' }, pronunciation_dict: { type: 'object' }, timbre_weights: { type: 'array', items: { type: 'object' } },
    language_boost: { type: 'string', minLength: 1 },
    voice_modify: { type: 'object' }, subtitle_enable: { type: 'boolean' }, aigc_watermark: { type: 'boolean' }, output_format: { type: 'string', enum: ['hex', 'url'] }, stream: { const: false }, stream_options: { type: 'object' },
  },
  additionalProperties: false,
}
const workflow = {
  workflow_id: { type: 'string' },
  node_info_list: { type: 'array', items: { type: 'object' } },
  reference_paths: { type: 'array', items: { type: 'string' } },
  reference_image_paths: { type: 'array', maxItems: 9, items: { type: 'string' } },
  reference_video_paths: { type: 'array', maxItems: 2, items: { type: 'string' } },
  reference_audio_paths: { type: 'array', maxItems: 2, items: { type: 'string' } },
}
const projectTracking = {
  project_root: { type: 'string', description: '短剧项目绝对路径；生成请求和任务会自动保存在项目内。' },
  target: { type: 'string', description: '本次生成对应的本地资产 key。' },
  prompt_document: { type: ['object', 'null'], description: '制作文档版本引用：视频镜号、audio-plan 行、storyboard 镜号或 asset-plan 资产；仅 other 辅助资产可为 null。' },
}
const tools = [
  ['list_generation_providers', '列出已注册生成 Provider 与模态能力。', {}, []],
  ['list_media_hosts', '列出把本地参考素材临时转换为公网 URL 的托管服务与时效。', {}, []],
  ['list_reference_uploads', '列出项目内临时发布收据及当前有效状态。', {
    project_root: { type: 'string' }, service: { type: 'string', enum: mediaHostNames }, asset_key: { type: 'string' }, version_id: { type: 'string', pattern: '^v\\d{3}$' }, state: { type: 'string', enum: ['active', 'expired'] },
  }, ['project_root']],
  ['publish_reference_image', '把项目内 selected 图片临时发布为公开 HTTPS URL；上传前必须确认权利、公开风险和商业使用许可。', {
    service: { type: 'string', enum: mediaHostNames }, project_root: { type: 'string' }, asset_key: { type: 'string' }, version_id: { type: 'string', pattern: '^v\\d{3}$' }, expires_in: { type: 'string', enum: ['1h', '12h', '24h', '72h'] }, usage_scope: { type: 'string', enum: ['non-commercial', 'commercial-authorized'] }, force_reupload: { type: 'boolean' }, confirmed: { const: true }, rights_confirmed: { const: true }, public_exposure_confirmed: { const: true }, usage_terms_confirmed: { const: true },
  }, ['service', 'project_root', 'asset_key', 'version_id', 'expires_in', 'usage_scope', 'confirmed', 'rights_confirmed', 'public_exposure_confirmed', 'usage_terms_confirmed']],
  ['list_models', '读取指定 Provider 的模型或工作流目录。', { provider }, ['provider']],
  ['generate_image', '使用用户选择的 Provider 生成图片；付费和上传本地参考文件前必须确认。', {
    provider, model: { type: 'string' }, prompt: { type: 'string' }, size: { type: 'string' }, resolution: imageResolution, aspect_ratio: imageAspectRatio, seed: { type: 'integer', minimum: 1 }, n: { type: 'integer', minimum: 1, maximum: 4 }, quality: { type: 'string', enum: ['auto', 'low', 'medium', 'high'] }, style: { type: 'string' }, background: { type: 'string', enum: ['auto', 'opaque', 'transparent'] }, moderation: { type: 'string', enum: ['auto', 'low'] }, output_format: { type: 'string', enum: ['png', 'jpeg', 'webp'] }, output_compression: { type: 'integer', minimum: 1 }, partial_images: { type: 'integer', minimum: 1 }, user: { type: 'string' }, reference_manifest: { type: 'array', maxItems: 9, items: { type: 'object' } }, confirmed: { const: true }, ...workflow, ...projectTracking,
  }, ['provider', 'prompt', 'reference_manifest', 'confirmed', 'project_root', 'target', 'prompt_document']],
  ['generate_audio', '使用用户选择的 Provider 生成语音或提交音频工作流。StarRouter 使用 model/input/voice，RunningHub 使用 prompt/workflow。', {
    provider, model: { type: 'string' }, input: { type: 'string' }, voice: { type: 'string' }, speed: { type: 'number', minimum: 0.5, maximum: 2 }, response_format: { type: 'string', enum: ['mp3', 'pcm', 'flac'] }, metadata: audioMetadata, prompt: { type: 'string' }, confirmed: { const: true }, ...workflow, ...projectTracking,
  }, ['provider', 'confirmed', 'project_root', 'target', 'prompt_document']],
  ['generate_music', '使用 StarRouter 异步生成 OP、ED、BGM 或音乐短视频配乐。', {
    provider, model: { type: 'string' }, prompt: { type: 'string' }, title: { type: 'string' }, tags: { type: 'string' }, lyrics: { type: 'string' }, make_instrumental: { type: 'boolean' }, confirmed: { const: true }, ...projectTracking,
  }, ['provider', 'model', 'prompt', 'confirmed', 'project_root', 'target', 'prompt_document']],
  ['submit_video', '使用用户选择的 Provider 提交异步视频任务。', {
    provider, model: { type: 'string' }, prompt_profile: { type: 'string', enum: ['seedance2', 'h3', 'generic'] }, input_mode: { type: 'string', enum: ['first-last-frame', 'full-reference', 'T2VA', 'I2VA', 'FL2VA', 'L2VA', 'Ref2VA', 'generic'] }, prompt_version: { type: 'string' }, prompt: { type: 'string' }, frame_url: { type: 'string' }, images: { type: 'array', maxItems: 9, items: { type: 'string' } }, input_reference: { type: 'string' }, reference_urls: { type: 'array', items: { type: 'string' } }, reference_image_urls: { type: 'array', maxItems: 9, items: { type: 'string' } }, reference_video_urls: { type: 'array', maxItems: 3, items: { type: 'string' } }, reference_audio_urls: { type: 'array', maxItems: 3, items: { type: 'string' } }, reference_manifest: { type: 'array', maxItems: 12, items: { type: 'object' } }, reference_only: { type: 'boolean' }, duration: { type: 'integer', minimum: 1, maximum: 15 }, size: { type: 'string', enum: ['480P', '768P', '2K'] }, resolution: { type: 'string', enum: ['480p', '720p', '1080p', '480P', '768P', '1K', '2K'] }, ratio: { type: 'string', enum: ['21:9', '16:9', '9:16', '1:1', '4:3', '3:4'] }, generate_audio: { type: 'boolean' }, watermark: { type: 'boolean' }, seed: { type: 'integer', minimum: 1 }, fps: { type: 'integer', minimum: 1 }, n: { type: 'integer', minimum: 1 }, response_format: { type: 'string' }, user: { type: 'string' }, metadata: { type: 'object' }, extra_options: { type: 'object' }, confirmed: { const: true }, ...workflow, ...projectTracking,
  }, ['provider', 'prompt_profile', 'input_mode', 'prompt_version', 'prompt', 'confirmed', 'project_root', 'target', 'prompt_document']],
  ['get_generation_task', '查询指定 Provider 的异步任务并归一化状态和输出列表。', { provider, task_id: { type: 'string' }, media_type: mediaType }, ['provider', 'task_id', 'media_type']],
].map(([name, description, properties, required]) => ({
  name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false },
}))

function send(message) { process.stdout.write(`${JSON.stringify(message)}\n`) }
function ok(id, result) { send({ jsonrpc: '2.0', id, result }) }
function fail(id, error) { send({ jsonrpc: '2.0', id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } }) }

async function validateProjectInputs(projectRoot, type, target, promptDocument, providerName, args, configuredType = type) {
  const root = await realpath(resolve(projectRoot))
  const assetRoot = await realpath(resolve(root, 'assets'))
  const prefixes = { image: ['char-', 'scene-', 'prop-', 'board-', 'other-'], video: ['shot-'], audio: ['audio-'] }
  if (!prefixes[type].some((prefix) => target?.startsWith(prefix))) throw new Error(`${type} target 资产 key 无效`)
  for (const field of ['reference_paths', 'reference_image_paths', 'reference_video_paths', 'reference_audio_paths']) {
    for (const value of args[field] || []) {
      const path = await realpath(resolve(value))
      if (path !== assetRoot && !path.startsWith(`${assetRoot}${sep}`)) throw new Error(`${field} 只能上传当前项目 assets/ 内文件`)
    }
  }
  const project = JSON.parse(await readFile(resolve(root, '.short-drama/project.json'), 'utf8'))
  const configured = project.providers?.[configuredType]
  const requestedModel = args.model || args.workflow_id
  if (!configured?.provider || configured.provider !== providerName) throw new Error(`${configuredType} Provider 必须与 project.json 已确认配置一致`)
  if (!requestedModel) throw new Error(`${configuredType} 模型或工作流必须显式解析并写入请求`)
  if (configured.model_or_workflow && configured.model_or_workflow !== requestedModel) throw new Error(`${configuredType} 模型或工作流必须与 project.json 已确认配置一致`)
  const parameters = configured.parameters === undefined ? {} : normalizeModelParameters(providerName, requestedModel, configured.parameters)
  for (const [key, value] of Object.entries(parameters)) {
    if (args[key] !== undefined && JSON.stringify(args[key]) !== JSON.stringify(value)) throw new Error(`${configuredType} 参数 ${key} 必须与 project.json 已确认配置一致`)
    args[key] = value
  }
  if (type === 'image') {
    if ([...(args.reference_image_paths || []), ...(args.reference_video_paths || []), ...(args.reference_audio_paths || [])].length) throw new Error('图片生成本地参考只使用 reference_paths')
    const paths = args.reference_paths || []
    const manifest = args.reference_manifest
    if (!Array.isArray(manifest) || manifest.length !== paths.length) throw new Error('图片 reference_manifest 必须与 reference_paths 等长')
    const assets = manifest.length ? JSON.parse(await readFile(resolve(root, '.short-drama/assets.json'), 'utf8')) : { assets: {} }
    for (const [index, item] of manifest.entries()) {
      if (item?.type !== 'image' || item.order !== index + 1 || typeof item.role !== 'string' || !item.role.trim()) throw new Error(`图片 reference_manifest 第 ${index + 1} 项无效`)
      const asset = assets.assets?.[item.asset_key]
      const version = asset?.versions?.find((entry) => entry.id === item.version_id)
      if (!version || asset.selectedVersionId !== item.version_id || asset.staleVersionIds?.includes(item.version_id)) throw new Error(`图片参考不是 selected 未失效版本：${item.asset_key}@${item.version_id}`)
      if (await realpath(resolve(root, version.localPath)) !== await realpath(resolve(paths[index]))) throw new Error(`图片参考路径与清单版本不一致：${item.asset_key}@${item.version_id}`)
    }
  }
  if (type !== 'video') return validateGenerationDocumentReference(root, type, target, promptDocument, args, providerName, requestedModel)
  if (!promptDocument || !/^ep-\d{3}$/.test(promptDocument.episode_key) || !/^v\d{3}$/.test(promptDocument.version_id) || !Number.isInteger(promptDocument.shot_number) || promptDocument.shot_number <= 0) throw new Error('视频生成必须引用有效的 episode/version/shot 提示词文档')
  const expectedTarget = `shot-${promptDocument.episode_key.replace('-', '')}-${String(promptDocument.shot_number).padStart(3, '0')}`
  if (target !== expectedTarget) throw new Error(`视频 target 必须为 ${expectedTarget}`)
  if (args.prompt_version !== promptDocument.version_id) throw new Error('prompt_version 必须与提示词文档版本一致')
  const selectedPath = resolve(root, 'episodes', promptDocument.episode_key, 'video-prompts', 'selected.json')
  const selected = JSON.parse(await readFile(selectedPath, 'utf8'))
  if (selected.versionId !== promptDocument.version_id) throw new Error('视频生成必须引用当前 selected 提示词版本')
  const documentPath = resolve(root, 'episodes', promptDocument.episode_key, 'video-prompts', `${promptDocument.version_id}.json`)
  if (resolve(root, selected.path) !== documentPath) throw new Error('selected 视频提示词路径无效')
  const document = JSON.parse(await readFile(documentPath, 'utf8'))
  const shot = document.approved === true && !document.unresolved?.length && document.shots?.find((item) => item.shot_number === promptDocument.shot_number)
  if (!shot || shot.errors?.length) throw new Error('视频提示词镜头不存在、未批准或仍有错误')
  for (const [field, actual] of Object.entries({ provider: providerName, model_or_workflow: requestedModel, prompt_profile: args.prompt_profile, input_mode: args.input_mode, prompt: args.prompt, duration: args.duration })) {
    if (shot[field] !== actual) throw new Error(`实际视频参数与提示词文档 ${field} 不一致`)
  }
  const manifest = Array.isArray(args.reference_manifest) ? args.reference_manifest : []
  if (manifest.length !== shot.references.length) throw new Error('实际参考素材与提示词文档数量不一致')
  const assets = JSON.parse(await readFile(resolve(root, '.short-drama/assets.json'), 'utf8'))
  for (const [index, reference] of shot.references.entries()) {
    const actual = manifest[index]
    for (const field of ['type', 'order', 'asset_key', 'version_id', 'role']) if (actual?.[field] !== reference[field]) throw new Error(`实际参考素材 ${index + 1} 与提示词文档不一致`)
    const asset = assets.assets?.[reference.asset_key]
    if (asset?.selectedVersionId !== reference.version_id || asset.staleVersionIds?.includes(reference.version_id) || !asset.versions?.some((item) => item.id === reference.version_id)) throw new Error(`参考素材不是当前 selected 未失效版本：${reference.asset_key}@${reference.version_id}`)
  }
  await validateVideoReferenceBindings(root, providerName, args, manifest)
}

export async function call(name, args = {}) {
  if (name === 'list_generation_providers') return providerCatalog()
  if (name === 'list_media_hosts') return mediaHostCatalog()
  if (name === 'list_reference_uploads') {
    const { project_root: projectRoot, ...filters } = args
    return listReferenceUploads(projectRoot, filters)
  }
  if (name === 'publish_reference_image') {
    const { project_root: projectRoot, ...input } = args
    return publishReferenceImage(projectRoot, input)
  }
  const selected = adapter(args.provider)
  const actions = { list_models: 'models', generate_image: 'image', generate_audio: 'audio', generate_music: 'music', submit_video: 'submitVideo', get_generation_task: 'task' }
  const action = actions[name]
  if (!action) throw new Error(`未知工具：${name}`)
  if (!['generate_image', 'generate_audio', 'generate_music', 'submit_video'].includes(name)) return selected[action](args)
  if (typeof selected[action] !== 'function') throw new Error(`${args.provider} 不支持 ${name}`)
  const { project_root: projectRoot, target, prompt_document: promptDocument, ...rawProviderArgs } = args
  const providerArgs = { ...rawProviderArgs }
  if (args.provider === 'runninghub') {
    const workflowEnv = name === 'generate_image' ? 'RUNNINGHUB_IMAGE_WORKFLOW_ID' : name === 'generate_audio' ? 'RUNNINGHUB_AUDIO_WORKFLOW_ID' : 'RUNNINGHUB_VIDEO_WORKFLOW_ID'
    if (providerArgs.model === 'minimax-h3-reference-to-video') {
      providerArgs.workflow_id ||= process.env.RUNNINGHUB_H3_WORKFLOW_ID || '2086743729407733762'
      if (Number.isInteger(providerArgs.duration) && providerArgs.duration < 5) providerArgs.duration = 5
    }
    else if (providerArgs.model !== 'krea2-normal-v1') providerArgs.workflow_id ||= process.env[workflowEnv]
  }
  const type = name === 'generate_image' ? 'image' : ['generate_audio', 'generate_music'].includes(name) ? 'audio' : 'video'
  await validateProjectInputs(projectRoot, type, target, promptDocument, args.provider, providerArgs, name === 'generate_music' ? 'music' : type)
  const snapshot = await createRequestSnapshot(projectRoot, { tool: name, target, type, provider: args.provider, modelOrWorkflow: providerArgs.model || providerArgs.workflow_id, promptDocument, arguments: providerArgs })
  await reserveTask(projectRoot, { taskId: snapshot.requestId, target, type, provider: args.provider, requestPath: snapshot.requestPath })
  let result
  try {
    result = await selected[action](providerArgs)
  } catch (error) {
    await settleReservedTask(projectRoot, snapshot.requestId, { status: 'failed' })
    throw error
  }
  const taskId = result.task_id || snapshot.requestId
  await settleReservedTask(projectRoot, snapshot.requestId, { taskId, status: result.status === 'submitted' ? 'queued' : 'running' })
  return { ...result, task_id: taskId, request_id: snapshot.requestId, request_path: snapshot.requestPath, request_sha256: snapshot.requestSha256 }
}

function serve() {
  createInterface({ input: process.stdin }).on('line', async (line) => {
    if (!line.trim()) return
    let message
    try { message = JSON.parse(line) } catch { return }
    if (message.method === 'notifications/initialized') return
    try {
      if (message.method === 'initialize') return ok(message.id, { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'drama-generation', version: '0.3.0' } })
      if (message.method === 'tools/list') return ok(message.id, { tools })
      if (message.method === 'tools/call') return ok(message.id, { content: [{ type: 'text', text: JSON.stringify(await call(message.params?.name, message.params?.arguments)) }] })
      fail(message.id, new Error(`不支持的方法：${message.method}`))
    } catch (error) { fail(message.id, error) }
  })
}

if (import.meta.url === `file://${process.argv[1]}`) serve()
