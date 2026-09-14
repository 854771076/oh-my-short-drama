#!/usr/bin/env node
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { withFileLock } from './file-lock.mjs'

const ACTIVE = new Set(['submitting', 'queued', 'running'])
const STATUSES = new Set([...ACTIVE, 'completed', 'failed', 'canceled'])
const TYPES = new Set(['image', 'video', 'audio'])
const MUTATING = new Set(['put'])
const NON_PROVENANCE_ARGUMENTS = new Set([
  'provider', 'model', 'workflow_id', 'node_info_list', 'confirmed', 'prompt', 'prompt_profile', 'input_mode', 'prompt_version',
  'frame_url', 'images', 'input_reference', 'reference_urls', 'reference_paths', 'reference_image_urls', 'reference_video_urls',
  'reference_audio_urls', 'reference_image_paths', 'reference_video_paths', 'reference_audio_paths', 'reference_manifest', 'reference_only',
  'input', 'lyrics', 'title', 'tags',
])

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  return value
}

export function canonicalPromptDocument(value, tool) {
  if (value === null || value === undefined) return null
  if (tool === 'submit_video' && value.kind === 'video-prompts') {
    const { kind, ...reference } = value
    return canonical(reference)
  }
  return canonical(value)
}

export function canonicalProvenanceParameters(request) {
  return canonical(Object.fromEntries(Object.entries(request.arguments || {}).filter(([key, value]) => value !== undefined && !NON_PROVENANCE_ARGUMENTS.has(key))))
}

export function generationProvenance(task, request) {
  return {
    origin: 'generated', created_by: 'provider', provider: task.provider, model_or_workflow: request.modelOrWorkflow,
    task_id: task.taskId, prompt_document: canonicalPromptDocument(request.promptDocument, request.tool),
    source_assets: (request.arguments?.reference_manifest || []).map((item) => ({ key: item.asset_key, version_id: item.version_id })),
    parameters: canonicalProvenanceParameters(request),
  }
}

export function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

export function rejectSecrets(value, path = '') {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key
    if (/(?:api[_-]?key|token|password|secret|authorization)/i.test(key)) throw new Error(`记录中禁止包含密钥字段：${childPath}`)
    rejectSecrets(child, childPath)
  }
}

export function validateTaskOutput(task, request, asset, version, requireCompletedLink = false) {
  const expectedType = ['character', 'scene', 'prop', 'storyboard', 'other'].includes(asset.type) ? 'image' : asset.type
  const provenance = version.provenance
  if (!['generated', 'transformed'].includes(provenance?.origin) || provenance.created_by !== 'provider') throw new Error('任务完成版本必须是 Provider 生成或变换资产')
  if (task.target !== asset.key || task.type !== expectedType || task.provider !== provenance.provider || provenance.task_id !== task.taskId) throw new Error('任务与资产 provenance 身份不一致')
  if (request.target !== task.target || request.type !== task.type || request.provider !== task.provider || request.modelOrWorkflow !== provenance.model_or_workflow) throw new Error('请求、任务与资产模型不一致')
  if (JSON.stringify(canonicalPromptDocument(request.promptDocument, request.tool)) !== JSON.stringify(canonicalPromptDocument(provenance.prompt_document, request.tool))) throw new Error('请求与资产提示词文档不一致')
  const expectedParameters = canonicalProvenanceParameters(request)
  if (JSON.stringify(expectedParameters) !== JSON.stringify(canonical(provenance.parameters || {}))) throw new Error(`资产 provenance 参数与请求不一致：实际 ${JSON.stringify(provenance.parameters || {})}，期望 ${JSON.stringify(expectedParameters)}`)
  if (request.tool === 'submit_video' || request.tool === 'generate_image') {
    const expectedSources = (request.arguments.reference_manifest || []).map((item) => ({ key: item.asset_key, version_id: item.version_id }))
    if (JSON.stringify(expectedSources) !== JSON.stringify(provenance.source_assets)) throw new Error('媒体资产上游版本与请求参考清单不一致')
  }
  if (requireCompletedLink && (task.status !== 'completed' || task.outputVersionId !== version.id)) throw new Error('生成资产未绑定任务完成版本')
}

function paths(root) {
  const directory = resolve(root, '.short-drama')
  return { directory, ledger: resolve(directory, 'tasks.json'), requests: resolve(directory, 'requests') }
}

async function sha256(path) { return createHash('sha256').update(await readFile(path)).digest('hex') }

export async function createRequestSnapshot(rootArg, input) {
  const root = resolve(rootArg)
  await access(resolve(root, '.short-drama/project.json'))
  rejectSecrets(input)
  const required = ['tool', 'target', 'type', 'provider', 'arguments']
  for (const field of required) if (input[field] === undefined || input[field] === null || input[field] === '') throw new Error(`请求快照 ${field} 必填`)
  if (!['generate_image', 'submit_video', 'generate_audio', 'generate_music'].includes(input.tool)) throw new Error(`请求工具无效：${input.tool}`)
  if (!TYPES.has(input.type)) throw new Error(`请求类型无效：${input.type}`)
  if (!input.arguments || typeof input.arguments !== 'object' || Array.isArray(input.arguments)) throw new Error('请求 arguments 必须是对象')
  const raw = JSON.stringify(input.arguments)
  if (Buffer.byteLength(raw) > 1024 * 1024) throw new Error('请求快照超过 1MB，请使用文件路径或资产版本引用代替内联媒体')
  const requestId = `req-${randomUUID()}`
  const snapshot = { version: 1, requestId, tool: input.tool, target: input.target, type: input.type, provider: input.provider, modelOrWorkflow: input.modelOrWorkflow || null, promptDocument: canonicalPromptDocument(input.promptDocument, input.tool), arguments: canonical(input.arguments), inputFingerprint: fingerprint(input.arguments), createdAt: new Date().toISOString() }
  const target = resolve(paths(root).requests, `${requestId}.json`)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: 'wx' })
  return { requestId, requestPath: relative(root, target), requestSha256: await sha256(target), inputFingerprint: snapshot.inputFingerprint }
}

function projectPath(root, value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('本地 outputPath 必填')
  const path = resolve(root, value)
  if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error('outputPath 必须位于项目目录内')
  return path
}

async function readLedger(root) {
  try { return JSON.parse(await readFile(paths(root).ledger, 'utf8')) }
  catch (error) {
    if (error?.code === 'ENOENT') return { version: 1, tasks: {} }
    throw error
  }
}

async function saveLedger(root, ledger) {
  const target = paths(root)
  await mkdir(target.directory, { recursive: true })
  const temporary = `${target.ledger}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(ledger, null, 2)}\n`, { flag: 'wx' })
  await rename(temporary, target.ledger)
}

export async function putTask(rootArg, record) {
  const root = resolve(rootArg)
  return withFileLock(paths(root).ledger, async () => {
    const ledger = await readLedger(root)
    rejectSecrets(record)
    for (const field of ['taskId', 'target', 'type', 'provider', 'status', 'requestPath']) {
      if (typeof record[field] !== 'string' || !record[field].trim()) throw new Error(`${field} 必填`)
    }
    if (!STATUSES.has(record.status)) throw new Error(`未知任务状态：${record.status}`)
    if (!TYPES.has(record.type)) throw new Error(`未知任务类型：${record.type}`)
    if (ledger.tasks[record.taskId]) throw new Error(`任务已存在：${record.taskId}`)
    const requestFile = projectPath(root, record.requestPath)
    const request = JSON.parse(await readFile(requestFile, 'utf8'))
    if (request.target !== record.target || request.type !== record.type || request.provider !== record.provider) throw new Error('任务与请求快照不一致')
    const inputFingerprint = fingerprint(request.arguments)
    const duplicate = Object.values(ledger.tasks).find((task) => task.taskId !== record.taskId && task.target === record.target && task.inputFingerprint === inputFingerprint && ACTIVE.has(task.status))
    if (duplicate) throw new Error(`存在相同目标与输入的在途任务：${duplicate.taskId}`)
    ledger.tasks[record.taskId] = { attempts: 1, submittedAt: new Date().toISOString(), ...record, requestSha256: await sha256(requestFile), inputFingerprint, updatedAt: new Date().toISOString() }
    await saveLedger(root, ledger)
    return ledger.tasks[record.taskId]
  })
}

export async function reserveTask(rootArg, record) {
  return putTask(rootArg, { ...record, status: 'submitting' })
}

export async function settleReservedTask(rootArg, reservationId, { taskId = reservationId, status }) {
  if (!['queued', 'running', 'failed'].includes(status)) throw new Error('预登记任务只能结算为 queued、running 或 failed')
  const root = resolve(rootArg)
  return withFileLock(paths(root).ledger, async () => {
    const ledger = await readLedger(root)
    const current = ledger.tasks[reservationId]
    if (!current || current.status !== 'submitting') throw new Error(`预登记任务不存在或已结算：${reservationId}`)
    if (taskId !== reservationId && ledger.tasks[taskId]) throw new Error(`远端任务已存在：${taskId}`)
    delete ledger.tasks[reservationId]
    ledger.tasks[taskId] = { ...current, taskId, status, updatedAt: new Date().toISOString() }
    await saveLedger(root, ledger)
    return ledger.tasks[taskId]
  })
}

export async function getTask(rootArg, taskId) {
  const task = (await readLedger(resolve(rootArg))).tasks[taskId]
  if (!task) throw new Error(`任务不存在：${taskId}`)
  return task
}

export async function listTasks(rootArg, { targetPrefix = '', types = null } = {}) {
  const ledger = await readLedger(resolve(rootArg))
  return Object.values(ledger.tasks)
    .filter((task) => (!targetPrefix || task.target.startsWith(targetPrefix)) && (!types || types.includes(task.type)))
}

export async function updateTaskStatus(rootArg, taskId, status, outputVersionId) {
  if (!STATUSES.has(status)) throw new Error(`未知任务状态：${status}`)
  const root = resolve(rootArg)
  return withFileLock(paths(root).ledger, async () => {
    const ledger = await readLedger(root)
    const current = ledger.tasks[taskId]
    if (!current) throw new Error(`任务不存在：${taskId}`)
    if (!ACTIVE.has(current.status) && current.status !== status) throw new Error(`终态任务不能改写：${taskId}`)
    if (status === 'completed') {
      if (outputVersionId) {
        const assets = JSON.parse(await readFile(resolve(root, '.short-drama/assets.json'), 'utf8'))
        const asset = assets.assets?.[current.target]
        const version = asset?.versions?.find((item) => item.id === outputVersionId)
        if (!version) throw new Error(`本地资产版本不存在：${current.target}/${outputVersionId}`)
        await access(projectPath(root, version.localPath))
        const request = JSON.parse(await readFile(projectPath(root, current.requestPath), 'utf8'))
        validateTaskOutput(current, request, asset, version)
      } else await access(projectPath(root, current.outputPath))
    }
    ledger.tasks[taskId] = { ...current, status, ...(outputVersionId ? { outputVersionId } : {}), updatedAt: new Date().toISOString() }
    await saveLedger(root, ledger)
    return ledger.tasks[taskId]
  })
}

async function main() {
  const [command, rootArg, ...args] = process.argv.slice(2)
  if (command === '--self-check') {
    if (fingerprint({ b: 2, a: 1 }) !== fingerprint({ a: 1, b: 2 })) throw new Error('指纹自检失败')
    const videoPrompt = { episode_key: 'ep-001', version_id: 'v001', shot_number: 1 }
    if (JSON.stringify(canonicalPromptDocument({ kind: 'video-prompts', ...videoPrompt }, 'submit_video')) !== JSON.stringify(canonical(videoPrompt)) || generationProvenance({ taskId: 'video-1', provider: 'comfly' }, { tool: 'submit_video', modelOrWorkflow: 'minimax-h3', promptDocument: videoPrompt, arguments: {} }).prompt_document.kind !== undefined) throw new Error('视频提示词引用规范化自检失败')
    try { rejectSecrets({ nested: { apiKey: 'x' } }); throw new Error('密钥自检失败') } catch (error) { if (!String(error.message).includes('禁止')) throw error }
    const task = { taskId: 'task-1', target: 'audio-ep001-a', type: 'audio', provider: 'starrouter' }
    const request = { tool: 'generate_audio', target: task.target, type: task.type, provider: task.provider, modelOrWorkflow: 'speech-2.8-hd', promptDocument: null, arguments: { speed: 1 } }
    const asset = { key: task.target, type: 'audio' }
    const version = { id: 'v001', provenance: generationProvenance(task, request) }
    validateTaskOutput(task, request, asset, version)
    const imageTask = { taskId: 'task-image', target: 'char-a', type: 'image', provider: 'starrouter' }
    const imageRequest = { tool: 'generate_image', target: 'char-a', type: 'image', provider: 'starrouter', modelOrWorkflow: 'gpt-image-2', promptDocument: { kind: 'asset-plan', episode_key: 'ep-001', version_id: 'v001', asset_key: 'char-a' }, arguments: { reference_manifest: [{ type: 'image', order: 1, asset_key: 'char-source', version_id: 'v001', role: 'identity' }] } }
    const imageAsset = { key: 'char-a', type: 'character' }
    const imageVersion = { id: 'v001', provenance: { origin: 'transformed', created_by: 'provider', provider: 'starrouter', model_or_workflow: 'gpt-image-2', task_id: 'task-image', prompt_document: imageRequest.promptDocument, source_assets: [{ key: 'char-source', version_id: 'v001' }], parameters: {} } }
    validateTaskOutput(imageTask, imageRequest, imageAsset, imageVersion)
    try { validateTaskOutput(imageTask, imageRequest, imageAsset, { ...imageVersion, provenance: { ...imageVersion.provenance, source_assets: [] } }); throw new Error('图片参考证据链自检失败') } catch (error) { if (!String(error.message).includes('上游版本')) throw error }
    try { validateTaskOutput(task, request, asset, { ...version, provenance: { ...version.provenance, model_or_workflow: 'wrong' } }); throw new Error('生成证据链自检失败') } catch (error) { if (!String(error.message).includes('模型不一致')) throw error }
    const temporary = await mkdtemp(resolve(tmpdir(), 'short-drama-task-'))
    try {
      await mkdir(resolve(temporary, '.short-drama'), { recursive: true })
      await writeFile(resolve(temporary, '.short-drama/project.json'), '{}')
      const snapshot = await createRequestSnapshot(temporary, { tool: 'generate_image', target: 'other-test', type: 'image', provider: 'starrouter', arguments: { model: 'test' } })
      await reserveTask(temporary, { taskId: snapshot.requestId, target: 'other-test', type: 'image', provider: 'starrouter', requestPath: snapshot.requestPath })
      try { await reserveTask(temporary, { taskId: 'duplicate', target: 'other-test', type: 'image', provider: 'starrouter', requestPath: snapshot.requestPath }); throw new Error('预登记去重自检失败') } catch (error) { if (!String(error.message).includes('在途任务')) throw error }
      const settled = await settleReservedTask(temporary, snapshot.requestId, { taskId: 'remote-test', status: 'queued' })
      if (settled.taskId !== 'remote-test' || settled.status !== 'queued') throw new Error('预登记结算自检失败')
      const listed = await listTasks(temporary, { targetPrefix: 'other-', types: ['image'] })
      if (listed.length !== 1 || listed[0].taskId !== 'remote-test' || (await listTasks(temporary, { types: ['video'] })).length) throw new Error('任务列表过滤自检失败')
    } finally { await rm(temporary, { recursive: true, force: true }) }
    return console.log('ok')
  }
  if (command === 'fingerprint') {
    if (!rootArg) throw new Error('用法：fingerprint <输入 JSON 文件>')
    return console.log(fingerprint(JSON.parse(await readFile(resolve(rootArg), 'utf8'))))
  }
  if (!rootArg) throw new Error('必须提供项目目录')
  const root = resolve(rootArg)
  if (command === 'snapshot') {
    if (!args[0]) throw new Error('用法：snapshot <项目目录> <请求 JSON>')
    return console.log(JSON.stringify(await createRequestSnapshot(root, JSON.parse(await readFile(resolve(args[0]), 'utf8'))), null, 2))
  }
  const operate = async () => {
  const ledger = await readLedger(root)
  if (command === 'list') return console.log(JSON.stringify(ledger, null, 2))
  if (command === 'put') {
    if (!args[0]) throw new Error('用法：put <项目目录> <任务记录 JSON>')
    const record = JSON.parse(await readFile(resolve(args[0]), 'utf8'))
    return console.log(JSON.stringify(await putTask(root, record), null, 2))
  }
  if (command === 'update') {
    const [taskId, status, outputVersionId] = args
    if (!taskId || !STATUSES.has(status)) throw new Error('用法：update <项目目录> <taskId> <submitting|queued|running|completed|failed|canceled> [outputVersionId]')
    return console.log(JSON.stringify(await updateTaskStatus(root, taskId, status, outputVersionId), null, 2))
  }
  throw new Error('用法：task-ledger.mjs snapshot|fingerprint|put|update|list ...')
  }
  return command === 'put' ? operate() : MUTATING.has(command) ? withFileLock(paths(root).ledger, operate) : operate()
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.message); process.exitCode = 1 })
