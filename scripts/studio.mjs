#!/usr/bin/env node
import { createReadStream, createWriteStream } from 'node:fs'
import { access, mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { execFile, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, extname, resolve, sep } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { normalizeModelParameters, providerSetupCatalog, testProviderConnection } from './generation/providers.mjs'
import { saveCredential } from './generation/credentials.mjs'
import { artStyleCatalog } from './art-styles.mjs'
import { createMarketStore } from './market/store.mjs'
import { runMarketResearch } from './market-research.mjs'
import { analyzeMarket } from './market/analyze.mjs'
import { normalizeRankings } from './market/normalize.mjs'

const execute = promisify(execFile)
const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const studioRoot = resolve(pluginRoot, 'studio')
export const DEFAULT_WORKSPACE_ROOT = resolve(homedir(), 'darma_project')
const WORKSPACE_FILE = '.short-drama-workspace.json'
const PROJECT_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SAFE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
const MARKET_ID = /^[A-Za-z0-9+_-]{1,80}$/
const ASSET_TYPES = { character: ['.gif','.jpeg','.jpg','.png','.webp'], scene: ['.gif','.jpeg','.jpg','.png','.webp'], prop: ['.gif','.jpeg','.jpg','.png','.webp'], storyboard: ['.gif','.jpeg','.jpg','.png','.webp'], video: ['.mp4','.webm'], audio: ['.flac','.mp3','.pcm','.wav'], other: ['.bin'] }
const MAX_UPLOAD_BYTES = Number(process.env.SHORT_DRAMA_MAX_MEDIA_BYTES || 512 * 1024 * 1024)
const PROJECT_DOCUMENTS = { 'source-analysis': '原文分析', brief: '创作简报', bible: '项目设定', outline: '分集大纲', 'art-style': '美术风格' }
const EPISODE_DOCUMENTS = { scripts: '剧本', 'script-review': '剧本复核', 'director-book': '导演本', 'asset-plan': '资产计划', storyboard: '分镜', 'production-plan': '制作计划', 'video-prompts': '视频提示词', 'audio-plan': '音频计划' }
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.gif': 'image/gif', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.flac': 'audio/flac', '.mp3': 'audio/mpeg', '.pcm': 'audio/L16', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm',
}
const SAFE_HEADERS = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')) }
  catch (error) { if (error?.code === 'ENOENT' && fallback !== undefined) return fallback; throw error }
}

function json(response, status, value) {
  response.writeHead(status, { ...SAFE_HEADERS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(value))
}

function validHost(request) {
  const host = request.headers.host || ''
  return /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host) && (!request.headers.origin || request.headers.origin === `http://${host}`)
}

async function body(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 64 * 1024) throw Object.assign(new Error('请求内容超过 64KB'), { status: 413 })
    chunks.push(chunk)
  }
  try { return chunks.length ? JSON.parse(Buffer.concat(chunks)) : {} }
  catch { throw Object.assign(new Error('请求 JSON 无效'), { status: 400 }) }
}

async function run(script, args) {
  try { return (await execute(process.execPath, [resolve(pluginRoot, 'scripts', script), ...args], { maxBuffer: 4 * 1024 * 1024, env: { ...process.env, SHORT_DRAMA_STUDIO_ACTIVE: '1' } })).stdout.trim() }
  catch (error) { throw Object.assign(new Error(error.stderr?.trim() || error.message), { status: 400 }) }
}

async function containedRealPath(root, target) {
  const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target)])
  if (realTarget !== realRoot && !realTarget.startsWith(`${realRoot}${sep}`)) throw Object.assign(new Error('路径越出允许范围'), { status: 403 })
  return realTarget
}

async function projectPath(workspaceRoot, key) {
  if (!PROJECT_KEY.test(key)) throw Object.assign(new Error('项目 key 无效'), { status: 400 })
  const matches = []
  for (const entry of await readdir(workspaceRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const root = await containedRealPath(workspaceRoot, resolve(workspaceRoot, entry.name))
    try {
      if ((await readJson(resolve(root, '.short-drama/project.json'))).key === key) matches.push(root)
    } catch (error) { if (error?.code !== 'ENOENT') throw error }
  }
  if (matches.length > 1) throw Object.assign(new Error(`项目 key 重复：${key}`), { status: 409 })
  if (!matches.length) throw Object.assign(new Error(`项目不存在：${key}`), { status: 404 })
  return matches[0]
}

function summarizeAssets(ledger) {
  return Object.values(ledger.assets || {}).map((asset) => ({
    ...asset,
    versions: (asset.versions || []).map((version) => ({ ...version, contentUrl: `/api/v1/projects/${encodeURIComponent(ledger.projectKey)}/assets/${encodeURIComponent(asset.key)}/versions/${encodeURIComponent(version.id)}/content` })),
  }))
}

async function fileSummary(root, key, id, label, episodeKey = null) {
  const path = resolve(root, id)
  const info = await stat(path)
  return { id, label, episodeKey, versionId: basename(id, extname(id)), extension: extname(id), sizeBytes: info.size, updatedAt: info.mtime.toISOString(), contentUrl: `/api/v1/projects/${encodeURIComponent(key)}/documents/content?id=${encodeURIComponent(id)}` }
}

async function listDocuments(root, key, episodes) {
  const documents = []
  for (const [kind, label] of Object.entries(PROJECT_DOCUMENTS)) {
    const id = `.short-drama/${kind}.json`
    try { documents.push(await fileSummary(root, key, id, label)) } catch (error) { if (error?.code !== 'ENOENT') throw error }
  }
  for (const episode of episodes) {
    for (const [kind, label] of Object.entries(EPISODE_DOCUMENTS)) {
      try {
        const selected = await readJson(resolve(root, 'episodes', episode.key, kind, 'selected.json'))
        if (typeof selected.path !== 'string') continue
        documents.push(await fileSummary(root, key, selected.path, label, episode.key))
      } catch (error) { if (error?.code !== 'ENOENT') throw error }
    }
  }
  return documents
}

async function listDeliveries(root, key, episodes) {
  const deliveries = []
  for (const episode of episodes) {
    try {
      const manifest = await readJson(resolve(root, 'delivery', episode.key, 'manifest.json'))
      const files = {}
      for (const kind of ['video', 'srt', 'ass']) {
        const record = manifest.files?.[kind]
        if (!record?.path) continue
        const file = await containedRealPath(resolve(root, 'delivery', episode.key), resolve(root, record.path))
        const info = await stat(file)
        files[kind] = { ...record, sizeBytes: info.size, contentUrl: `/api/v1/projects/${encodeURIComponent(key)}/deliveries/${episode.key}/${kind}/content` }
      }
      deliveries.push({ episodeKey: episode.key, createdAt: manifest.createdAt || null, files })
    } catch (error) { if (error?.code !== 'ENOENT') deliveries.push({ episodeKey: episode.key, error: error.message, files: {} }) }
  }
  return deliveries
}

async function listProjects(workspaceRoot) {
  const entries = await readdir(workspaceRoot, { withFileTypes: true })
  const projects = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const root = resolve(workspaceRoot, entry.name)
    try {
      await containedRealPath(workspaceRoot, root)
      try { await access(resolve(root, '.short-drama/project.json')) } catch (error) { if (error?.code === 'ENOENT') continue; throw error }
      const [project, state, assets, tasks] = await Promise.all([
        readJson(resolve(root, '.short-drama/project.json')),
        readJson(resolve(root, '.short-drama/state.json'), { stage: 'analysis', completed: [] }),
        readJson(resolve(root, '.short-drama/assets.json'), { assets: {} }),
        readJson(resolve(root, '.short-drama/tasks.json'), { tasks: {} }),
      ])
      assets.projectKey = project.key
      const visual = summarizeAssets(assets).find((asset) => ['character', 'scene', 'prop', 'storyboard'].includes(asset.type) && asset.selectedVersionId)
      const coverUrl = visual?.versions.find((version) => version.id === visual.selectedVersionId)?.contentUrl || null
      projects.push({ project, state, coverUrl, counts: { assets: Object.keys(assets.assets || {}).length, tasks: Object.keys(tasks.tasks || {}).length }, path: root })
    } catch (error) {
      projects.push({ project: { key: entry.name, title: entry.name }, error: error.message, path: root })
    }
  }
  return projects.sort((a, b) => String(b.project.updatedAt || '').localeCompare(String(a.project.updatedAt || '')))
}

async function projectDetail(workspaceRoot, key) {
  const root = await projectPath(workspaceRoot, key)
  const [project, state, assetLedger, taskLedger] = await Promise.all([
    readJson(resolve(root, '.short-drama/project.json')),
    readJson(resolve(root, '.short-drama/state.json'), { stage: 'analysis', completed: [] }),
    readJson(resolve(root, '.short-drama/assets.json'), { version: 1, assets: {} }),
    readJson(resolve(root, '.short-drama/tasks.json'), { version: 1, tasks: {} }),
  ])
  const episodes = []
  for (const entry of await readdir(resolve(root, 'episodes'), { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^ep-\d{3}$/.test(entry.name)) continue
    try { episodes.push(await readJson(resolve(root, 'episodes', entry.name, 'episode.json'))) } catch (error) { if (error?.code !== 'ENOENT') throw error }
  }
  assetLedger.projectKey = key
  episodes.sort((a, b) => a.order - b.order)
  return { project, state, episodes, documents: await listDocuments(root, key, episodes), deliveries: await listDeliveries(root, key, episodes), assets: summarizeAssets(assetLedger), tasks: Object.values(taskLedger.tasks || {}), path: root }
}

export async function initializeWorkspace(rootArg, title = basename(resolve(rootArg))) {
  const root = resolve(rootArg)
  const workspaceTitle = String(title || '').trim() || basename(root)
  await mkdir(root, { recursive: true })
  const marker = resolve(root, WORKSPACE_FILE)
  try {
    await writeFile(marker, `${JSON.stringify({ schema_version: 1, title: workspaceTitle, createdAt: new Date().toISOString() }, null, 2)}\n`, { flag: 'wx' })
  } catch (error) { if (error?.code !== 'EEXIST') throw error }
  return readJson(marker)
}

async function createProject(workspaceRoot, input) {
  const key = String(input.key || '').trim()
  const title = String(input.title || '').trim()
  if (!PROJECT_KEY.test(key)) throw Object.assign(new Error('项目 key 必须是小写 kebab-case'), { status: 400 })
  if (!title || title.length > 80) throw Object.assign(new Error('项目名称必填且不超过 80 字'), { status: 400 })
  const positive = (value, field) => {
    if (value === undefined || value === null || value === '') return null
    if (!Number.isInteger(value) || value <= 0) throw Object.assign(new Error(`${field} 必须是正整数`), { status: 400 })
    return value
  }
  const projectRoot = resolve(workspaceRoot, key)
  if (projectRoot !== resolve(workspaceRoot, key) || !projectRoot.startsWith(`${resolve(workspaceRoot)}${sep}`)) throw Object.assign(new Error('项目路径无效'), { status: 400 })
  try { await access(projectRoot); throw Object.assign(new Error('同名项目目录已存在'), { status: 409 }) } catch (error) { if (error?.code !== 'ENOENT') throw error }
  const temporary = await mkdtemp(resolve(tmpdir(), 'short-drama-project-'))
  const metadata = {
    key, title,
    automation_mode: input.automationMode !== false && input.automationMode !== 'false',
    description: input.description ? String(input.description).trim() : null,
    creative: { genre: input.genre ? String(input.genre).trim() : null },
    format: { episode_count: positive(input.episodeCount, '集数'), episode_duration_seconds: positive(input.episodeDurationSeconds, '单集时长') },
  }
  const metadataPath = resolve(temporary, 'project.json')
  try {
    await writeFile(metadataPath, JSON.stringify(metadata))
    await run('project-store.mjs', ['init', projectRoot, metadataPath])
  } finally { await rm(temporary, { recursive: true, force: true }) }
  return projectDetail(workspaceRoot, key)
}

async function validateProject(workspaceRoot, key) {
  const root = await projectPath(workspaceRoot, key)
  try {
    const { stdout } = await execute(process.execPath, [resolve(pluginRoot, 'scripts/validate-project.mjs'), root], { maxBuffer: 4 * 1024 * 1024 })
    return { valid: true, issues: [], report: JSON.parse(stdout) }
  } catch (error) {
    return { valid: false, issues: String(error.stderr || error.message).trim().split('\n').filter(Boolean) }
  }
}

async function configureProjectProviders(workspaceRoot, key, input) {
  const root = await projectPath(workspaceRoot, key)
  const catalog = providerSetupCatalog()
  const providers = {}
  for (const type of ['image', 'video', 'audio', 'music']) {
    const selected = input.providers?.[type]
    if (!selected?.provider && !selected?.model_or_workflow) { providers[type] = { provider: null, model_or_workflow: null, prompt_profile: null, parameters: {} }; continue }
    const provider = catalog.find((item) => item.key === selected?.provider)
    const model = provider?.models[type]?.find((item) => item.id === selected?.model_or_workflow)
    if (!provider || !provider.configured || !model) throw Object.assign(new Error(`${type} 的供应商未配置或模型不受支持`), { status: 400 })
    let parameters
    try { parameters = normalizeModelParameters(provider.key, model.id, selected.parameters) }
    catch (error) { throw Object.assign(error, { status: 400 }) }
    providers[type] = { provider: provider.key, model_or_workflow: model.id, prompt_profile: model.promptProfile, parameters }
  }
  const temporary = await mkdtemp(resolve(tmpdir(), 'short-drama-providers-'))
  try {
    const update = resolve(temporary, 'providers.json')
    await writeFile(update, JSON.stringify({ providers, ...(input.creative?.art_style ? { creative: { art_style: input.creative.art_style } } : {}) }))
    await run('project-store.mjs', ['update-project', root, update])
  } finally { await rm(temporary, { recursive: true, force: true }) }
  return projectDetail(workspaceRoot, key)
}

async function configureProjectAutomation(workspaceRoot, key, input) {
  if (typeof input.enabled !== 'boolean') throw Object.assign(new Error('自动托管开关必须是布尔值'), { status: 400 })
  if (input.enabled && input.paidAuthorizationConfirmed !== true) throw Object.assign(new Error('首次启用全托管必须确认项目级付费授权声明'), { status: 400 })
  const root = await projectPath(workspaceRoot, key)
  const temporary = await mkdtemp(resolve(tmpdir(), 'short-drama-automation-'))
  try {
    const update = resolve(temporary, 'automation.json')
    await writeFile(update, JSON.stringify({ automation_mode: input.enabled, ...(input.enabled ? { paid_automation_authorized: true } : {}) }))
    await run('project-store.mjs', ['update-project', root, update])
  } finally { await rm(temporary, { recursive: true, force: true }) }
  return projectDetail(workspaceRoot, key)
}

async function configureProviderCredential(key, input) {
  const provider = providerSetupCatalog().find((item) => item.key === key)
  const value = typeof input.credential === 'string' ? input.credential.trim() : ''
  if (!provider) throw Object.assign(new Error('生成供应商不存在'), { status: 404 })
  if (!value || value.length > 4096) throw Object.assign(new Error('凭据不能为空且不能超过 4096 个字符'), { status: 400 })
  await saveCredential(provider.credentialEnv, value)
  return { provider: provider.key, configured: true }
}

async function testProviderCredential(key, tester) {
  const provider = providerSetupCatalog().find((item) => item.key === key)
  if (!provider) throw Object.assign(new Error('生成供应商不存在'), { status: 404 })
  if (!provider.configured) throw Object.assign(new Error('请先配置供应商凭据'), { status: 400 })
  try { await tester(key) }
  catch (error) {
    const detail = String(error?.message || error)
    const message = /401|403|未配置|unauthorized|forbidden/i.test(detail) ? '凭据无效或无权访问' : /429|rate.?limit/i.test(detail) ? '请求过于频繁，请稍后重试' : /timeout|abort/i.test(detail) ? '连接超时，请检查网络' : '供应商服务暂时不可用'
    throw Object.assign(new Error(message), { status: 502 })
  }
  return { provider: provider.key, ok: true, message: '连接成功' }
}

async function importAsset(request, workspaceRoot, key, searchParams) {
  if (request.headers['x-short-drama-confirmed'] !== 'true') throw Object.assign(new Error('导入资产需要明确确认'), { status: 400 })
  const root = await projectPath(workspaceRoot, key)
  const assetKey = searchParams.get('assetKey') || ''
  const type = searchParams.get('type') || ''
  const name = (searchParams.get('name') || '').trim()
  const versionId = searchParams.get('versionId') || ''
  const filename = basename(searchParams.get('filename') || '')
  const extension = extname(filename).toLowerCase()
  if (!SAFE_KEY.test(assetKey) || !ASSET_TYPES[type]?.includes(extension) || !name || !/^v\d{3}$/.test(versionId)) throw Object.assign(new Error('资产 key、类型、名称、版本或文件扩展名无效'), { status: 400 })
  const declaredSize = Number(request.headers['content-length'] || 0)
  if (declaredSize > MAX_UPLOAD_BYTES) throw Object.assign(new Error('资产超过大小限制'), { status: 413 })
  const ledger = await readJson(resolve(root, '.short-drama/assets.json'), { assets: {} })
  const current = ledger.assets?.[assetKey]
  if (current?.type && current.type !== type) throw Object.assign(new Error('资产类型不可变'), { status: 409 })
  if (current?.versions?.some((version) => version.id === versionId)) throw Object.assign(new Error(`版本已存在：${versionId}`), { status: 409 })
  const temporary = await mkdtemp(resolve(tmpdir(), 'short-drama-upload-'))
  const upload = resolve(temporary, `upload${extension}`)
  let received = 0
  try {
    await pipeline(request, new Transform({ transform(chunk, encoding, done) { received += chunk.length; done(received > MAX_UPLOAD_BYTES ? Object.assign(new Error('资产超过大小限制'), { status: 413 }) : null, chunk) } }), createWriteStream(upload, { flags: 'wx' }))
    if (!received) throw Object.assign(new Error('资产文件为空'), { status: 400 })
    if (!current) {
      const record = resolve(temporary, 'asset.json')
      await writeFile(record, JSON.stringify({ key: assetKey, type, name }))
      await run('asset-ledger.mjs', ['put', root, record])
    }
    await run('asset-ledger.mjs', ['import', root, assetKey, upload, versionId, filename])
    return projectDetail(workspaceRoot, key)
  } finally { await rm(temporary, { recursive: true, force: true }) }
}

async function streamFile(response, file, range) {
  const fileStat = await stat(file)
  const headers = { ...SAFE_HEADERS, 'content-type': MIME_TYPES[extname(file).toLowerCase()] || 'application/octet-stream', 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=60' }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range || '')
  if (!match) {
    response.writeHead(200, { ...headers, 'content-length': fileStat.size })
    return createReadStream(file).pipe(response)
  }
  const start = match[1] ? Number(match[1]) : Math.max(0, fileStat.size - Number(match[2] || 0))
  const end = match[2] && match[1] ? Math.min(Number(match[2]), fileStat.size - 1) : fileStat.size - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= fileStat.size) {
    response.writeHead(416, { 'content-range': `bytes */${fileStat.size}` }); return response.end()
  }
  response.writeHead(206, { ...headers, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${fileStat.size}` })
  createReadStream(file, { start, end }).pipe(response)
}

async function serveAsset(response, workspaceRoot, key, assetKey, versionId, range) {
  if (!SAFE_KEY.test(assetKey) || !/^v\d{3}$/.test(versionId)) throw Object.assign(new Error('资产或版本 key 无效'), { status: 400 })
  const root = await projectPath(workspaceRoot, key)
  const ledger = await readJson(resolve(root, '.short-drama/assets.json'))
  const version = ledger.assets?.[assetKey]?.versions?.find((item) => item.id === versionId)
  if (!version) throw Object.assign(new Error('资产版本不存在'), { status: 404 })
  return streamFile(response, await containedRealPath(root, resolve(root, version.localPath)), range)
}

async function serveStatic(response, pathname) {
  const target = pathname === '/' ? resolve(studioRoot, 'index.html') : resolve(studioRoot, `.${pathname}`)
  if (target !== studioRoot && !target.startsWith(`${studioRoot}${sep}`)) throw Object.assign(new Error('路径无效'), { status: 403 })
  const file = await containedRealPath(studioRoot, target)
  response.writeHead(200, { ...SAFE_HEADERS, 'content-type': MIME_TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache', 'content-security-policy': "default-src 'self'; img-src 'self'; media-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'" })
  createReadStream(file).pipe(response)
}

async function serveDocument(response, workspaceRoot, key, id) {
  const root = await projectPath(workspaceRoot, key)
  const episodes = []
  for (const entry of await readdir(resolve(root, 'episodes'), { withFileTypes: true })) if (entry.isDirectory() && /^ep-\d{3}$/.test(entry.name)) episodes.push({ key: entry.name })
  if (!(await listDocuments(root, key, episodes)).some((item) => item.id === id)) throw Object.assign(new Error('文档不存在或尚未选版'), { status: 404 })
  const file = await containedRealPath(root, resolve(root, id))
  response.writeHead(200, { ...SAFE_HEADERS, 'content-type': MIME_TYPES[extname(file)] || 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
  createReadStream(file).pipe(response)
}

async function serveDelivery(response, workspaceRoot, key, episodeKey, kind, range) {
  if (!/^ep-\d{3}$/.test(episodeKey) || !['video', 'srt', 'ass'].includes(kind)) throw Object.assign(new Error('交付文件参数无效'), { status: 400 })
  const root = await projectPath(workspaceRoot, key)
  const deliveries = await listDeliveries(root, key, [{ key: episodeKey }])
  const record = deliveries[0]?.files?.[kind]
  if (!record) throw Object.assign(new Error('交付文件不存在'), { status: 404 })
  const file = await containedRealPath(resolve(root, 'delivery', episodeKey), resolve(root, record.path))
  return streamFile(response, file, range)
}

function createDefaultMarketService(workspaceRoot) {
  const store = createMarketStore(workspaceRoot)
  return {
    async overview(filters = {}) {
      const [latest, history] = await Promise.all([store.readLatest(), store.listHistory()])
      if (!latest.latestReport || !latest.latestSnapshot || Object.keys(filters).length === 0) return { status: latest.latestReport ? 'ready' : 'empty', latestReport: latest.latestReport, latestSnapshot: latest.latestSnapshot, history }
      const snapshot = latest.latestSnapshot
      const latestReport = analyzeMarket({
        items: normalizeRankings(snapshot.rankings, { snapshotId: snapshot.snapshot_id, observedAt: snapshot.retrieved_at }),
        successfulRankingTypes: Object.keys(snapshot.rankings),
        snapshotIds: [snapshot.snapshot_id],
        filters,
      })
      return { status: 'ready', latestReport, latestSnapshot: snapshot, history, filtered: true, sourceReportId: latest.latestReport.report_id }
    },
    async refresh() {
      try {
        await runMarketResearch(['refresh', workspaceRoot])
      } catch {
        // Studio 不向浏览器暴露上游端点、请求参数或内部堆栈；既有成功报告由存储层保留，用户可安全重试。
        throw Object.assign(new Error('剧查查公开榜单刷新失败，请稍后重试'), { status: 502 })
      }
      return this.overview()
    },
    report: (id) => store.readReport(id),
    markdown: (id) => store.readReportMarkdown(id),
  }
}

export function createStudioServer({ workspaceRoot: rootArg, providerTester = testProviderConnection, marketService: marketServiceArg }) {
  const workspaceRoot = resolve(rootArg)
  const marketService = marketServiceArg ?? createDefaultMarketService(workspaceRoot)
  const csrfToken = randomBytes(24).toString('base64url')
  let marketRefreshPromise = null
  return createServer(async (request, response) => {
    try {
      if (!validHost(request)) throw Object.assign(new Error('仅允许本机同源访问'), { status: 403 })
      const url = new URL(request.url, `http://${request.headers.host}`)
      const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
      if (request.method === 'GET' && url.pathname === '/api/v1/workspace') {
        const workspace = await initializeWorkspace(workspaceRoot)
        return json(response, 200, { workspace: { ...workspace, path: workspaceRoot }, projects: await listProjects(workspaceRoot), csrfToken })
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/providers') return json(response, 200, { providers: providerSetupCatalog() })
      if (request.method === 'GET' && url.pathname === '/api/v1/art-styles') return json(response, 200, { styles: artStyleCatalog(workspaceRoot) })
      if (request.method === 'GET' && url.pathname === '/api/v1/market') {
        const filters = {}
        for (const [query, field] of [['rankingTypes', 'rankingTypes'], ['topic', 'topic'], ['audience', 'audience'], ['format', 'format']]) {
          const value = url.searchParams.get(query)
          if (value) filters[field] = value
        }
        return json(response, 200, await marketService.overview(filters))
      }
      const marketReportMatch = /^\/api\/v1\/market\/reports\/([^/]+)$/.exec(url.pathname)
      const marketMarkdownMatch = /^\/api\/v1\/market\/reports\/([^/]+)\/markdown$/.exec(url.pathname)
      if (request.method === 'GET' && marketMarkdownMatch) {
        const reportId = decodeURIComponent(marketMarkdownMatch[1])
        if (!MARKET_ID.test(reportId)) throw Object.assign(new Error('市场报告 ID 无效'), { status: 400 })
        const markdown = await marketService.markdown(reportId)
        if (markdown === null) throw Object.assign(new Error('市场报告不存在'), { status: 404 })
        response.writeHead(200, { ...SAFE_HEADERS, 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store' })
        return response.end(markdown)
      }
      if (request.method === 'GET' && marketReportMatch) {
        const reportId = decodeURIComponent(marketReportMatch[1])
        if (!MARKET_ID.test(reportId)) throw Object.assign(new Error('市场报告 ID 无效'), { status: 400 })
        const report = await marketService.report(reportId)
        if (!report) throw Object.assign(new Error('市场报告不存在'), { status: 404 })
        return json(response, 200, report)
      }
      if (request.method === 'POST' || request.method === 'DELETE') {
        if (request.headers['x-short-drama-csrf'] !== csrfToken) throw Object.assign(new Error('操作凭证无效，请刷新页面'), { status: 403 })
        if (request.method === 'DELETE') {
          const projectMatch = /^\/api\/v1\/projects\/([^/]+)$/.exec(url.pathname)
          if (!projectMatch) throw Object.assign(new Error('接口不存在'), { status: 404 })
          if (request.headers['x-short-drama-confirmed'] !== 'true') throw Object.assign(new Error('删除项目需要明确确认'), { status: 400 })
          const key = decodeURIComponent(projectMatch[1])
          await rm(await projectPath(workspaceRoot, key), { recursive: true })
          return json(response, 200, { deleted: true, projectKey: key })
        }
        if (url.pathname === '/api/v1/market/refresh') {
          if (marketRefreshPromise) throw Object.assign(new Error('市场数据正在刷新'), { status: 409 })
          marketRefreshPromise = Promise.resolve().then(() => marketService.refresh())
          try { return json(response, 201, await marketRefreshPromise) }
          catch (error) { throw Object.assign(new Error(error?.message || '市场数据刷新失败'), { status: error?.status || 502 }) }
          finally { marketRefreshPromise = null }
        }
        if (url.pathname === '/api/v1/projects') return json(response, 201, await createProject(workspaceRoot, await body(request)))
        const credentialMatch = /^\/api\/v1\/providers\/([^/]+)\/credential$/.exec(url.pathname)
        if (credentialMatch) return json(response, 200, await configureProviderCredential(decodeURIComponent(credentialMatch[1]), await body(request)))
        const providerTestMatch = /^\/api\/v1\/providers\/([^/]+)\/test$/.exec(url.pathname)
        if (providerTestMatch) return json(response, 200, await testProviderCredential(decodeURIComponent(providerTestMatch[1]), providerTester))
        const providersMatch = /^\/api\/v1\/projects\/([^/]+)\/providers$/.exec(url.pathname)
        if (providersMatch) return json(response, 200, await configureProjectProviders(workspaceRoot, decodeURIComponent(providersMatch[1]), await body(request)))
        const automationMatch = /^\/api\/v1\/projects\/([^/]+)\/automation$/.exec(url.pathname)
        if (automationMatch) return json(response, 200, await configureProjectAutomation(workspaceRoot, decodeURIComponent(automationMatch[1]), await body(request)))
        const importMatch = /^\/api\/v1\/projects\/([^/]+)\/assets\/import$/.exec(url.pathname)
        if (importMatch) return json(response, 201, await importAsset(request, workspaceRoot, decodeURIComponent(importMatch[1]), url.searchParams))
        const actionMatch = /^\/api\/v1\/projects\/([^/]+)\/assets\/([^/]+)\/(select|revert)$/.exec(url.pathname)
        if (actionMatch) {
          const [, key, assetKey, action] = actionMatch.map(decodeURIComponent)
          const input = await body(request)
          if (input.confirmed !== true) throw Object.assign(new Error('选版操作需要明确确认'), { status: 400 })
          const root = await projectPath(workspaceRoot, key)
          if (action === 'select') {
            if (!/^v\d{3}$/.test(input.versionId || '')) throw Object.assign(new Error('版本 id 无效'), { status: 400 })
            await run('asset-ledger.mjs', ['select', root, assetKey, input.versionId])
          } else await run('asset-ledger.mjs', ['revert', root, assetKey])
          return json(response, 200, await projectDetail(workspaceRoot, key))
        }
      }
      const validationMatch = /^\/api\/v1\/projects\/([^/]+)\/validation$/.exec(url.pathname)
      if (request.method === 'GET' && validationMatch) return json(response, 200, await validateProject(workspaceRoot, decodeURIComponent(validationMatch[1])))
      if (request.method === 'GET' && segments.length === 4 && segments.slice(0, 3).join('/') === 'api/v1/projects') return json(response, 200, await projectDetail(workspaceRoot, segments[3]))
      const documentMatch = /^\/api\/v1\/projects\/([^/]+)\/documents\/content$/.exec(url.pathname)
      if (request.method === 'GET' && documentMatch) return await serveDocument(response, workspaceRoot, decodeURIComponent(documentMatch[1]), url.searchParams.get('id') || '')
      const deliveryMatch = /^\/api\/v1\/projects\/([^/]+)\/deliveries\/(ep-\d{3})\/(video|srt|ass)\/content$/.exec(url.pathname)
      if (request.method === 'GET' && deliveryMatch) return await serveDelivery(response, workspaceRoot, ...deliveryMatch.slice(1).map(decodeURIComponent), request.headers.range)
      const contentMatch = /^\/api\/v1\/projects\/([^/]+)\/assets\/([^/]+)\/versions\/([^/]+)\/content$/.exec(url.pathname)
      if (request.method === 'GET' && contentMatch) return await serveAsset(response, workspaceRoot, ...contentMatch.slice(1).map(decodeURIComponent), request.headers.range)
      if (request.method === 'GET' && !url.pathname.startsWith('/api/')) return await serveStatic(response, url.pathname)
      throw Object.assign(new Error('接口不存在'), { status: 404 })
    } catch (error) {
      if (!response.headersSent) json(response, error?.code === 'ENOENT' ? 404 : error.status || 500, { error: error.message })
      else response.destroy(error)
    }
  })
}

export async function openStudio(rootArg = DEFAULT_WORKSPACE_ROOT) {
  const root = resolve(rootArg)
  const url = 'http://127.0.0.1:4173'
  await initializeWorkspace(root)
  const active = async () => {
    try { return resolve((await fetch(`${url}/api/v1/workspace`, { signal: AbortSignal.timeout(500) }).then((response) => response.json())).workspace.path) === root }
    catch { return false }
  }
  if (!await active()) {
    spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve', root], { detached: true, stdio: 'ignore' }).unref()
    for (let attempt = 0; attempt < 20 && !await active(); attempt += 1) await new Promise((done) => setTimeout(done, 100))
  }
  if (!await active()) throw new Error(`Dashboard 未能启动，请手动打开：node scripts/studio.mjs serve ${root}`)
  if (process.env.SHORT_DRAMA_STUDIO_NO_OPEN === '1') return url
  const opener = process.platform === 'darwin' ? ['open', url] : process.platform === 'win32' ? ['cmd.exe', '/c', 'start', '', url] : ['xdg-open', url]
  spawn(opener[0], opener.slice(1), { detached: true, stdio: 'ignore' }).unref()
  return url
}

async function main() {
  const [command = 'serve', rootArg = DEFAULT_WORKSPACE_ROOT, ...args] = process.argv.slice(2)
  if (command === 'init') { await initializeWorkspace(rootArg, args.join(' ') || basename(resolve(rootArg))); return console.log(resolve(rootArg, WORKSPACE_FILE)) }
  if (command !== 'serve') throw new Error('用法：studio.mjs init|serve <工作区目录> [--port 4173]')
  await initializeWorkspace(rootArg)
  const portIndex = args.indexOf('--port')
  const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 4173
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('端口无效')
  const server = createStudioServer({ workspaceRoot: rootArg })
  server.on('error', (error) => { console.error(`工作台启动失败：${error.message}`); process.exitCode = 1 })
  server.listen(port, '127.0.0.1', () => console.log(`短剧工作台：http://127.0.0.1:${server.address().port}`))
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch((error) => { console.error(error.message); process.exitCode = 1 })
