#!/usr/bin/env node
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { access, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { stages } from './workflow-stages.mjs'
import { requiredSkills } from './skill-runs.mjs'
import { fingerprint, validateTaskOutput } from './task-ledger.mjs'
import { validateManifest, validateReview, validateTimeline } from './editing-store.mjs'
import { validDocumentReferenceShape, validateGenerationDocumentReference } from './document-reference.mjs'
import { validateVideoReferenceBindings } from './reference-bindings.mjs'

const scripts = dirname(fileURLToPath(import.meta.url))
const pluginRoot = resolve(scripts, '..')
const skillMap = JSON.parse(await readFile(resolve(pluginRoot, 'references/skill-map.json'), 'utf8'))
const providerPrompts = new Set(skillMap.provider_prompts || [])
const VERSION = /^v\d{3}$/
const EPISODE = /^ep-\d{3}$/
const PREFIXES = { character: 'char-', scene: 'scene-', prop: 'prop-', storyboard: 'board-', video: 'shot-', audio: 'audio-', other: 'other-' }
const ASSET_DIRECTORIES = { character: 'characters', scene: 'scenes', prop: 'props', storyboard: 'storyboards', video: 'videos', audio: 'audio', other: 'other' }
const MEDIA_EXTENSIONS = { image: new Set(['.gif', '.jpeg', '.jpg', '.png', '.webp']), video: new Set(['.mp4', '.webm']), audio: new Set(['.flac', '.mp3', '.pcm', '.wav']) }
const failures = []
let root
let rootReal

function promptMode(skill, stage) {
  const prompts = Object.entries(skillMap.prompts).filter(([, owner]) => owner === skill).map(([name]) => name)
  if (!prompts.length) return null
  if (['asset-generation', 'media-production'].includes(stage) && prompts.some((name) => providerPrompts.has(name))) return 'provider-prompt'
  return prompts.some((name) => !providerPrompts.has(name)) ? 'codex-contract' : 'provider-prompt'
}
function acceptsPrompt(skill, prompt) {
  return (skillMap.completion_prompts?.[skill] || Object.entries(skillMap.prompts).filter(([, owner]) => owner === skill).map(([name]) => name)).includes(prompt)
}

async function exists(path) { try { await access(path); return true } catch { return false } }
async function json(path) { try { return JSON.parse(await readFile(path, 'utf8')) } catch (error) { failures.push(`${relative(root, path)} JSON 无效：${error.message}`); return null } }
async function hash(path) {
  const output = createHash('sha256')
  for await (const chunk of createReadStream(path)) output.update(chunk)
  return output.digest('hex')
}
async function localFile(value, label, expectedHash) {
  if (typeof value !== 'string' || !value) return failures.push(`${label} localPath 缺失`)
  const path = resolve(root, value)
  try {
    const actual = await realpath(path)
    if (actual !== rootReal && !actual.startsWith(`${rootReal}${sep}`)) return failures.push(`${label} 路径逃逸项目目录`)
    if (!(await stat(actual)).isFile()) return failures.push(`${label} 不是文件`)
    if (expectedHash && await hash(actual) !== expectedHash) failures.push(`${label} SHA-256 不一致`)
    return actual
  } catch { failures.push(`${label} 本地文件不存在：${value}`) }
}
function noSecrets(value, label, path = '') {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    const next = path ? `${path}.${key}` : key
    if (/(?:api[_-]?key|token|password|secret|authorization)/i.test(key)) failures.push(`${label} 含密钥字段：${next}`)
    noSecrets(child, label, next)
  }
}
function noSecretText(value, label) {
  if (typeof value === 'string' && /(?:\b(?:sk|rk)-[A-Za-z0-9_-]{16,}|\bBearer\s+\S{16,}|\b(?:api[_-]?key|token|password|secret|authorization)\s*[:=]\s*\S{8,})/i.test(value)) failures.push(`${label} 疑似包含密钥`)
}
function run(script, ...args) {
  const result = spawnSync(process.execPath, [resolve(scripts, script), ...args], { encoding: 'utf8' })
  if (result.status !== 0) failures.push(`${script}：${(result.stderr || result.stdout).trim()}`)
}
async function selected(directory, extensions) {
  const markerPath = resolve(directory, 'selected.json')
  if (!await exists(markerPath)) return
  const marker = await json(markerPath)
  if (!marker || !VERSION.test(marker.versionId)) return failures.push(`${relative(root, markerPath)} versionId 必须为 v001 格式`)
  const candidates = extensions.map((extension) => resolve(directory, `${marker.versionId}${extension}`))
  const matches = (await Promise.all(candidates.map(async (path) => await exists(path) ? path : null))).filter(Boolean)
  if (matches.length !== 1) failures.push(`${relative(root, markerPath)} 必须且只能指向一个版本文件`)
  else if (marker.path !== relative(root, matches[0])) failures.push(`${relative(root, markerPath)} path 与版本文件不一致`)
}
async function validateSources() {
  const manifestPath = resolve(root, 'source/manifest.json')
  const manifest = await json(manifestPath)
  if (!manifest || manifest.version !== 1 || !manifest.sources || typeof manifest.sources !== 'object') return failures.push('source/manifest.json 合同无效')
  for (const [key, source] of Object.entries(manifest.sources)) {
    if (!/^src-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key) || source.key !== key || !Array.isArray(source.versions)) failures.push(`来源记录无效：${key}`)
    for (const version of source.versions || []) {
      if (!VERSION.test(version.id)) failures.push(`${key} 来源版本必须为 v001 格式`)
      await localFile(version.localPath, `${key}@${version.id}`, version.sha256)
    }
    if (source.selectedVersionId !== null && !source.versions?.some((item) => item.id === source.selectedVersionId)) failures.push(`${key} selected 来源版本不存在`)
  }
}
async function validateEpisodes() {
  const entries = await readdir(resolve(root, 'episodes'), { withFileTypes: true })
  for (const entry of entries.filter((item) => item.isDirectory())) {
    if (!EPISODE.test(entry.name)) { failures.push(`分集目录必须为 ep-001 格式：${entry.name}`); continue }
    const directory = resolve(root, 'episodes', entry.name)
    const episode = await json(resolve(directory, 'episode.json'))
    if (!episode || episode.key !== entry.name || typeof episode.title !== 'string' || !episode.title.trim()) failures.push(`${entry.name}/episode.json 合同无效`)
    await selected(resolve(directory, 'scripts'), ['.json', '.md', '.txt'])
    for (const kind of ['script-review', 'director-book', 'asset-plan', 'production-plan', 'storyboard', 'video-prompts', 'audio-plan']) {
      const path = resolve(directory, kind)
      await selected(path, ['.json'])
      const markerPath = resolve(path, 'selected.json')
      if (await exists(markerPath)) {
        const marker = await json(markerPath)
        if (marker?.path) run('project-store.mjs', 'validate-episode-document', root, kind, entry.name, resolve(root, marker.path))
      }
    }
    for (const kind of ['scripts', 'script-review', 'director-book', 'asset-plan', 'production-plan', 'storyboard', 'video-prompts', 'audio-plan']) {
      const path = resolve(directory, kind)
      if (!await exists(path)) continue
      for (const file of await readdir(path)) {
        if (file !== 'selected.json' && !/^v\d{3}\.(?:json|md|txt)$/.test(file)) failures.push(`${entry.name}/${kind}/${file} 不符合版本命名`)
      }
    }
  }
}
function validateProvenance(value, label) {
  const keys = ['origin', 'created_by', 'provider', 'model_or_workflow', 'task_id', 'prompt_document', 'source_assets', 'parameters']
  if (!value || typeof value !== 'object' || Object.keys(value).sort().join() !== keys.sort().join()) return failures.push(`${label} provenance 合同无效`)
  if (!['imported', 'generated', 'transformed'].includes(value.origin) || !['user', 'codex', 'provider'].includes(value.created_by)) failures.push(`${label} provenance 类型无效`)
  if (value.created_by === 'provider' && ['generated', 'transformed'].includes(value.origin) && (!value.provider || !value.model_or_workflow || !value.task_id)) failures.push(`${label} Provider provenance 不完整`)
  if (!Array.isArray(value.source_assets) || !value.parameters || typeof value.parameters !== 'object' || Array.isArray(value.parameters)) failures.push(`${label} provenance 来源或参数无效`)
  if (value.origin === 'transformed' && value.source_assets.length === 0) failures.push(`${label} transformed provenance 缺少上游资产`)
}
async function validateAssets() {
  const path = resolve(root, '.short-drama/assets.json')
  if (!await exists(path)) return
  const ledger = await json(path)
  if (!ledger || ledger.version !== 1 || !ledger.assets || typeof ledger.assets !== 'object') return failures.push('assets.json 合同无效')
  const tasks = await exists(resolve(root, '.short-drama/tasks.json')) ? await json(resolve(root, '.short-drama/tasks.json')) : { tasks: {} }
  for (const [key, asset] of Object.entries(ledger.assets)) {
    if (!PREFIXES[asset.type] || !key.startsWith(PREFIXES[asset.type]) || asset.key !== key) failures.push(`资产 key/type 无效：${key}`)
    if (!Array.isArray(asset.versions)) { failures.push(`${key}.versions 无效`); continue }
    if (!Array.isArray(asset.staleVersionIds || []) || (asset.staleVersionIds || []).some((id) => !asset.versions.some((version) => version.id === id))) failures.push(`${key}.staleVersionIds 无效`)
    for (const version of asset.versions) {
      if (!VERSION.test(version.id)) failures.push(`${key} 版本必须为 v001 格式`)
      validateProvenance(version.provenance, `${key}@${version.id}`)
      if (typeof version.localPath === 'string' && !version.localPath.startsWith(`assets/${ASSET_DIRECTORIES[asset.type]}/${key}/`)) failures.push(`${key}@${version.id} 不在标准资产目录`)
      if (asset.type !== 'other' && typeof version.localPath === 'string') {
        const family = ['character', 'scene', 'prop', 'storyboard'].includes(asset.type) ? 'image' : asset.type
        const extension = version.localPath.toLowerCase().match(/\.[^.\/]+$/)?.[0] || ''
        if (!MEDIA_EXTENSIONS[family]?.has(extension)) failures.push(`${key}@${version.id} 媒体扩展名与资产类型不一致`)
      }
      await localFile(version.localPath, `${key}@${version.id}`, version.sha256)
      const prompt = version.provenance?.prompt_document
      const providerOutput = version.provenance?.created_by === 'provider' && ['generated', 'transformed'].includes(version.provenance?.origin)
      if (providerOutput) {
        const requiredKind = asset.type === 'video' ? undefined : asset.type === 'audio' ? 'audio-plan' : asset.type === 'storyboard' ? 'storyboard' : ['character', 'scene', 'prop'].includes(asset.type) ? 'asset-plan' : null
        if (requiredKind !== null && (!prompt || prompt.kind !== requiredKind)) failures.push(`${key}@${version.id} 生成${asset.type}缺少匹配的制作文档来源`)
      }
      if (prompt) {
        if (!validDocumentReferenceShape(prompt)) failures.push(`${key}@${version.id} 制作文档引用无效`)
        else if (prompt.kind === undefined) {
          const promptPath = resolve(root, 'episodes', prompt.episode_key, 'video-prompts', `${prompt.version_id}.json`)
          if (!await exists(promptPath)) failures.push(`${key}@${version.id} 引用的视频提示词版本不存在`)
          else if (!(await json(promptPath))?.shots?.some((shot) => shot.shot_number === prompt.shot_number)) failures.push(`${key}@${version.id} 引用的视频提示词镜号不存在`)
        }
      }
      if (providerOutput && tasks.tasks?.[version.provenance.task_id]?.status !== 'completed') failures.push(`${key}@${version.id} Provider 任务不存在或未完成`)
      if (providerOutput && tasks.tasks?.[version.provenance.task_id]) {
        const task = tasks.tasks[version.provenance.task_id]
        try {
          const request = await json(resolve(root, task.requestPath))
          if (request) {
            validateTaskOutput(task, request, asset, version, true)
            if (task.type !== 'video') await validateGenerationDocumentReference(root, task.type, task.target, request.promptDocument || null, request.arguments, request.provider, request.modelOrWorkflow, asset.selectedVersionId === version.id)
          }
        } catch (error) { failures.push(`${key}@${version.id} 生成证据链：${error.message}`) }
      }
      for (const source of version.provenance?.source_assets || []) if (!ledger.assets?.[source.key]?.versions?.some((item) => item.id === source.version_id)) failures.push(`${key}@${version.id} 上游资产不存在：${source.key}@${source.version_id}`)
    }
    if (asset.selectedVersionId && !asset.versions.some((item) => item.id === asset.selectedVersionId)) failures.push(`${key} selectedVersionId 不存在`)
    if (asset.selectedVersionId && asset.staleVersionIds?.includes(asset.selectedVersionId)) failures.push(`${key} 仍选中了已失效版本`)
  }
  noSecrets(ledger, 'assets.json')
}
async function validateUploads() {
  const directory = resolve(root, '.short-drama/uploads')
  if (!await exists(directory)) return
  const ledger = await json(resolve(root, '.short-drama/assets.json'))
  const expiryMs = { '1h': 3600000, '12h': 43200000, '24h': 86400000, '72h': 259200000 }
  const fields = ['version', 'id', 'service', 'media_type', 'asset_key', 'version_id', 'local_path', 'sha256', 'size_bytes', 'url', 'expires_in', 'usage_scope', 'confirmations', 'created_at', 'expires_at', 'permanent']
  for (const file of await readdir(directory)) {
    if (!/^upload-[0-9a-f-]+\.json$/.test(file)) { failures.push(`临时上传收据文件名无效：${file}`); continue }
    const receipt = await json(resolve(directory, file))
    if (!receipt || Object.keys(receipt).sort().join() !== fields.sort().join() || receipt.version !== 1 || receipt.id !== file.slice(0, -5) || receipt.service !== 'litterbox' || receipt.media_type !== 'image' || receipt.permanent !== false || !expiryMs[receipt.expires_in] || !['non-commercial', 'commercial-authorized'].includes(receipt.usage_scope) || JSON.stringify(receipt.confirmations) !== JSON.stringify({ rights: true, public_exposure: true, terms_of_use: true })) { failures.push(`临时上传收据合同无效：${file}`); continue }
    let url
    try { url = new URL(receipt.url) } catch {}
    if (!url || url.protocol !== 'https:' || url.hostname !== 'litter.catbox.moe' || url.username || url.password) failures.push(`${file} Litterbox URL 无效`)
    const asset = ledger?.assets?.[receipt.asset_key]
    const version = asset?.versions?.find((item) => item.id === receipt.version_id)
    if (!version || version.localPath !== receipt.local_path || version.sha256 !== receipt.sha256 || version.sizeBytes !== receipt.size_bytes) failures.push(`${file} 与本地资产版本不一致`)
    if (!Number.isFinite(Date.parse(receipt.created_at)) || Date.parse(receipt.expires_at) !== Date.parse(receipt.created_at) + expiryMs[receipt.expires_in]) failures.push(`${file} 到期时间无效`)
    noSecrets(receipt, file)
  }
}
async function validateControl() {
  run('project-store.mjs', 'validate-project-config', root)
  const state = await json(resolve(root, '.short-drama/state.json'))
  if (!state || state.version !== 1 || !stages.includes(state.stage) || !Array.isArray(state.completed) || new Set(state.completed).size !== state.completed.length || state.completed.some((item, index) => item !== stages[index]) || (state.invalidatedAt !== undefined && (typeof state.invalidatedAt !== 'object' || Object.entries(state.invalidatedAt).some(([stage, time]) => !stages.includes(stage) || !Number.isFinite(Date.parse(time))))) || (state.finishedAt && (state.stage !== stages.at(-1) || state.completed.at(-1) !== stages.at(-1) || !Number.isFinite(Date.parse(state.finishedAt))))) failures.push('state.json 合同无效')
  const skillRuns = await json(resolve(root, '.short-drama/skill-runs.json'))
  if (!skillRuns || skillRuns.version !== 1 || !skillRuns.runs || typeof skillRuns.runs !== 'object') failures.push('skill-runs.json 合同无效')
  for (const run of Object.values(skillRuns?.runs || {})) {
    if (!stages.includes(run.stage) || typeof run.skill !== 'string' || run.status !== 'completed' || !Array.isArray(run.evidence) || run.evidence.length === 0 || !run.evidenceSha256 || typeof run.evidenceSha256 !== 'object') failures.push('skill-runs.json 执行记录无效')
    for (const evidence of run.evidence || []) await localFile(evidence, `Skill 执行证据：${run.skill}`, run.evidenceSha256?.[evidence])
    for (const promptRun of run.promptRuns || []) {
      await localFile(promptRun.path, `Skill 提示词记录：${run.skill}`, promptRun.sha256)
      const record = await json(resolve(root, promptRun.path))
      if (record && (!acceptsPrompt(run.skill, record.prompt) || skillMap.prompts[record.prompt] !== run.skill || (record.executionMode === 'codex-contract' && !run.evidence.includes(record.outputPath)))) failures.push(`Skill 完成合同、提示词归属或产物绑定错误：${run.skill}`)
    }
    const mode = promptMode(run.skill, run.stage)
    const cutoff = state.invalidatedAt?.[run.stage]
    if (cutoff && Date.parse(run.completedAt) < Date.parse(cutoff)) failures.push(`Skill 执行早于阶段失效时间：${run.skill}`)
    if (mode && (!Array.isArray(run.promptRuns) || run.promptRuns.length === 0)) failures.push(`Skill 缺少提示词运行记录：${run.skill}`)
    if (mode === 'codex-contract' && run.evidence.some((path) => !(run.promptRuns || []).some((promptRun) => promptRun.outputPath === path))) failures.push(`Skill 存在未绑定 Codex 合同的证据：${run.skill}`)
  }
  for (const stage of state?.completed || []) for (const skill of await requiredSkills(root, stage)) {
    if (skillRuns?.runs?.[`${stage}:${skill}`]?.status !== 'completed') failures.push(`已完成阶段缺少 Skill 执行：${stage} -> ${skill}`)
  }
  const tasksPath = resolve(root, '.short-drama/tasks.json')
  const tasks = await exists(tasksPath) ? await json(tasksPath) : { version: 1, tasks: {} }
  if (!tasks || tasks.version !== 1 || !tasks.tasks || typeof tasks.tasks !== 'object') failures.push('tasks.json 合同无效')
  const requestDirectory = resolve(root, '.short-drama/requests')
  for (const file of await readdir(requestDirectory)) {
    if (!/^req-[0-9a-f-]+\.json$/.test(file)) { failures.push(`生成请求文件名无效：${file}`); continue }
    const request = await json(resolve(requestDirectory, file))
    if (!request || request.version !== 1 || `${request.requestId}.json` !== file || !['generate_image', 'submit_video', 'generate_audio', 'generate_music'].includes(request.tool) || !request.arguments || typeof request.arguments !== 'object' || fingerprint(request.arguments) !== request.inputFingerprint) failures.push(`生成请求快照无效：${file}`)
    else if (request.tool === 'submit_video') try {
      await validateVideoReferenceBindings(root, request.provider, request.arguments, request.arguments.reference_manifest || [], { requireSelected: false, at: Date.parse(request.createdAt) })
    } catch (error) { failures.push(`视频请求参考证据链无效：${file}：${error.message}`) }
    noSecrets(request, file)
  }
  for (const [taskId, task] of Object.entries(tasks?.tasks || {})) {
    if (task.taskId !== taskId || !['submitting', 'queued', 'running', 'completed', 'failed', 'canceled'].includes(task.status) || typeof task.requestPath !== 'string' || typeof task.requestSha256 !== 'string' || typeof task.inputFingerprint !== 'string') { failures.push(`任务请求引用无效：${taskId}`); continue }
    const requestPath = resolve(root, task.requestPath)
    await localFile(task.requestPath, `${taskId} 请求快照`, task.requestSha256)
    if (await exists(requestPath)) {
      const request = await json(requestPath)
      if (!request || request.version !== 1 || request.target !== task.target || request.type !== task.type || request.provider !== task.provider || request.inputFingerprint !== task.inputFingerprint || fingerprint(request.arguments) !== task.inputFingerprint) failures.push(`任务与请求快照不一致：${taskId}`)
      noSecrets(request, `${taskId} 请求快照`)
    }
  }
  for (const name of ['tasks.json', 'shot-reviews.json', 'skill-runs.json']) {
    const path = resolve(root, '.short-drama', name)
    if (await exists(path)) noSecrets(await json(path), name)
  }
  const environment = await json(resolve(root, '.short-drama/environment.json'))
  if (!environment || environment.version !== 1 || !['init', 'media', 'editing'].includes(environment.mode) || typeof environment.ok !== 'boolean' || !environment.checks || !Array.isArray(environment.errors)) failures.push('environment.json 合同无效')
  noSecrets(environment, 'environment.json')
  if (!await exists(resolve(root, '.short-drama/RESUME.md'))) failures.push('缺少 .short-drama/RESUME.md')
}
async function validatePromptRuns() {
  const directory = resolve(root, '.short-drama/prompt-runs')
  for (const file of await readdir(directory)) {
    if (!/^prompt-[0-9a-f-]+\.json$/.test(file)) { failures.push(`Prompt 留痕文件名无效：${file}`); continue }
    const record = await json(resolve(directory, file))
    if (!record || record.version !== 1 || (record.skill !== undefined && skillMap.prompts[record.prompt] !== record.skill) || !['codex-contract', 'provider-prompt'].includes(record.executionMode) || !/^[0-9a-f]{64}$/.test(record.templateSha256 || '') || typeof record.resolvedContractOrPrompt !== 'string' || typeof record.outputPath !== 'string') { failures.push(`Prompt 留痕合同无效：${file}`); continue }
    const templatePath = resolve(pluginRoot, record.template || '')
    if (templatePath !== pluginRoot && !templatePath.startsWith(`${pluginRoot}${sep}`) || !await exists(templatePath)) failures.push(`${file} 模板不在插件内或已不存在`)
    const promptName = typeof record.template === 'string' ? record.template.split('/').at(-1).replace(/\.(?:zh|en)\.txt$/, '') : ''
    if ((record.executionMode === 'provider-prompt') !== providerPrompts.has(promptName)) failures.push(`${file} Prompt 执行模式与模板类型不一致`)
    const outputPath = await localFile(record.outputPath, `${file} 实际产物`)
    if (record.executionMode === 'codex-contract') {
      if (typeof record.codexOutput !== 'string' || !/^[0-9a-f]{64}$/.test(record.codexOutputSha256 || '') || createHash('sha256').update(record.codexOutput || '').digest('hex') !== record.codexOutputSha256) failures.push(`${file} Codex 产物哈希无效`)
      else if (outputPath) {
        const actual = await readFile(outputPath, 'utf8')
        if (actual !== record.codexOutput) failures.push(`${file} Codex 产物已变化`)
      }
      noSecretText(record.codexOutput, file)
    } else if (outputPath) {
      const actual = await readFile(outputPath, 'utf8')
      if (actual !== record.resolvedContractOrPrompt) failures.push(`${file} Provider 提示词已变化`)
    }
    noSecrets(record.variables, file)
    noSecretText(record.resolvedContractOrPrompt, file)
  }
}
async function validateEditingAndDelivery() {
  for (const area of ['editing', 'delivery']) {
    const entries = await readdir(resolve(root, area), { withFileTypes: true })
    for (const entry of entries) if (!entry.isDirectory() || !EPISODE.test(entry.name)) failures.push(`${area} 仅允许 ep-001 分集目录：${entry.name}`)
  }
  for (const entry of await readdir(resolve(root, 'episodes'), { withFileTypes: true })) {
    if (!entry.isDirectory() || !EPISODE.test(entry.name)) continue
    const episode = entry.name
    const timelinePath = resolve(root, 'editing', episode, 'timeline.json')
    if (await exists(timelinePath)) try { await validateTimeline(root, await json(timelinePath)) } catch (error) { failures.push(`${episode} timeline：${error.message}`) }
    const reviewPath = resolve(root, 'editing', episode, 'review.json')
    if (await exists(reviewPath)) try { validateReview(await json(reviewPath), episode) } catch (error) { failures.push(`${episode} review：${error.message}`) }
    const manifestPath = resolve(root, 'delivery', episode, 'manifest.json')
    if (await exists(manifestPath)) try { await validateManifest(root, await json(manifestPath), episode) } catch (error) { failures.push(`${episode} manifest：${error.message}`) }
  }
}
async function main() {
  root = resolve(process.argv[2] || '')
  if (!process.argv[2]) throw new Error('用法：validate-project.mjs <项目目录>')
  rootReal = await realpath(root)
  const directories = ['.short-drama', '.short-drama/requests', '.short-drama/prompt-runs', '.short-drama/uploads', '.short-drama/environment', 'source', 'episodes', 'assets/characters', 'assets/scenes', 'assets/props', 'assets/storyboards', 'assets/audio', 'assets/videos', 'assets/other', 'editing', 'delivery']
  for (const directory of directories) if (!await exists(resolve(root, directory))) failures.push(`缺少目录：${directory}`)
  if (!failures.length) {
    await validateControl()
    await validatePromptRuns()
    await validateSources()
    await validateEpisodes()
    await validateAssets()
    await validateUploads()
    await validateEditingAndDelivery()
  }
  if (failures.length) { console.error([...new Set(failures)].join('\n')); process.exitCode = 1; return }
  console.log(JSON.stringify({ valid: true, schema_version: 1, project: relative(dirname(root), root) || '.', status: 'covered' }))
}

main().catch((error) => { console.error(error.message); process.exitCode = 1 })
