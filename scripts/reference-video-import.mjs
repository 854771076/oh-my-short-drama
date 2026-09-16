#!/usr/bin/env node
import { createWriteStream } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, extname, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { assertSafeOutputPath, confinedExistingFile, fileSha256 } from './safe-files.mjs'
import { probeReferenceVideo } from './reference-video.mjs'

const scripts = dirname(fileURLToPath(import.meta.url))
const MAX_BYTES = 2 * 1024 * 1024 * 1024
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.mkv'])

const PLATFORM_HOSTS = [
  ['douyin', /(?:^|\.)douyin\.com$/],
  ['tiktok', /(?:^|\.)tiktok\.com$/],
  ['youtube', /^(?:www\.)?(?:youtube\.com|youtu\.be)$/],
  ['bilibili', /^(?:www\.)?(?:bilibili\.com|b23\.tv)$/],
  ['x', /^(?:www\.)?(?:x\.com|twitter\.com)$/],
  ['instagram', /(?:^|\.)instagram\.com$/],
  ['vimeo', /(?:^|\.)vimeo\.com$/],
  ['kuaishou', /(?:^|\.)kuaishou\.com$/],
  ['xiaohongshu', /^(?:www\.)?(?:xiaohongshu\.com|xhslink\.com)$/],
]

export function parseReferenceVideoUrl(input) {
  const match = String(input || '').match(/https?:\/\/[^\s<>"']+/u)
  if (!match) throw new Error('未找到受支持的视频链接')
  let url
  try { url = new URL(match[0]) } catch { throw new Error('视频链接无效') }
  const hostname = url.hostname.toLowerCase()
  if (url.protocol !== 'https:' || hostname === 'localhost' || /^(?:127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(hostname) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(hostname) || hostname === '::1') throw new Error('视频链接不得使用内网地址或非 HTTPS 协议')
  const platform = PLATFORM_HOSTS.find(([, pattern]) => pattern.test(hostname))?.[0]
  if (!platform) throw new Error(`不支持的视频平台：${hostname}`)
  return { platform, url: url.toString() }
}

function delay(ms) { return new Promise((resolveDelay) => setTimeout(resolveDelay, ms)) }

function safeDtkBaseUrl(value) {
  let url
  try { url = new URL(value) } catch { throw new Error('DTK_BASE_URL 无效') }
  const local = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('DTK_BASE_URL 必须是 HTTPS 服务根地址；仅本机允许 HTTP')
  return url.toString().replace(/\/$/, '')
}

async function dtkRequest(config, path, options = {}) {
  const response = await fetch(`${config.baseUrl}${path}`, {
    method: options.method || 'GET',
    headers: { Authorization: `Bearer ${config.apiKey}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(options.timeoutMs || 35000),
    redirect: 'error',
  })
  if (options.binary) {
    if (!response.ok || !response.body) throw new Error(`DTK 下载文件失败：HTTP ${response.status}`)
    return response
  }
  let envelope
  try { envelope = await response.json() } catch { throw new Error(`DTK 返回非 JSON：HTTP ${response.status}`) }
  if (!response.ok || envelope?.success !== true) throw new Error(`DTK 请求失败：${envelope?.error?.code || response.status}`)
  return envelope.data
}

async function settledDtkTask(config, data, pollIntervalMs, timeoutMs) {
  if (!data?.task_id || !['queued', 'running'].includes(data.state)) return data
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const task = await dtkRequest(config, `/api/v1/tasks/${encodeURIComponent(data.task_id)}`)
    if (task.state === 'done') return task.data
    if (task.state === 'failed') throw new Error(`DTK 解析任务失败：${task.error?.code || 'UNKNOWN'}`)
    await delay(pollIntervalMs)
  }
  throw new Error('DTK 解析任务超时')
}

async function inspectWithDtk(reference, options) {
  if (!['douyin', 'tiktok'].includes(reference.platform)) throw new Error('DTK 仅支持抖音和 TikTok')
  const config = {
    baseUrl: safeDtkBaseUrl(options.dtk?.baseUrl || process.env.DTK_BASE_URL || ''),
    apiKey: options.dtk?.apiKey || process.env.DTK_API_KEY,
  }
  if (!config.apiKey) throw new Error('DTK_API_KEY 未配置')
  const submitted = await dtkRequest(config, '/api/v1/parse?wait=30', { method: 'POST', body: { url: reference.url } })
  const metadata = await settledDtkTask(config, submitted, options.pollIntervalMs || 1000, options.timeoutMs || 120000)
  if (!metadata || metadata.kind !== 'video' || !metadata.platform || !metadata.content_id) throw new Error('DTK 解析结果不是可导入的视频')
  const inspected = { provider: 'dtk', reference, metadata }
  // API key 仅供本次请求使用，禁止进入 JSON 输出、日志或导入收据。
  Object.defineProperty(inspected, 'config', { value: config })
  return inspected
}

function runYtDlp(binary, args) {
  const result = spawnSync(binary, ['--ignore-config', ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, env: { ...process.env, YTDLP_NO_PLUGINS: '1' } })
  if (result.error?.code === 'ENOENT') throw new Error('未安装 yt-dlp；请安装后重试，或配置 DTK')
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`yt-dlp 执行失败：${String(result.stderr || result.stdout || result.status).trim()}`)
  return result.stdout
}

async function inspectWithYtDlp(reference, options) {
  const binary = options.ytDlpBinary || process.env.YT_DLP_BINARY || 'yt-dlp'
  const output = runYtDlp(binary, ['--dump-single-json', '--no-playlist', '--no-warnings', '--', reference.url])
  let metadata
  try { metadata = JSON.parse(output) } catch { throw new Error('yt-dlp 返回非 JSON 元数据') }
  if (!metadata.id || !metadata.webpage_url) throw new Error('yt-dlp 元数据缺少作品 ID 或规范链接')
  return { provider: 'yt-dlp', reference, metadata, binary }
}

export async function inspectReferenceVideoUrl(input, options = {}) {
  const reference = parseReferenceVideoUrl(input)
  const requested = options.provider || 'auto'
  const useDtk = requested === 'dtk' || (requested === 'auto' && ['douyin', 'tiktok'].includes(reference.platform) && Boolean(options.dtk?.baseUrl || process.env.DTK_BASE_URL))
  if (useDtk) return inspectWithDtk(reference, options)
  if (!['auto', 'yt-dlp'].includes(requested)) throw new Error(`未知下载 Provider：${requested}`)
  return inspectWithYtDlp(reference, options)
}

async function writeResponseFile(response, target) {
  let bytes = 0
  const limiter = new Transform({ transform(chunk, encoding, callback) { bytes += chunk.length; callback(bytes > MAX_BYTES ? new Error('下载文件超过 2 GiB') : null, chunk) } })
  await pipeline(Readable.fromWeb(response.body), limiter, createWriteStream(target, { flags: 'wx' }))
}

async function downloadWithDtk(inspected, targetDirectory, options) {
  const started = await dtkRequest(inspected.config, '/api/v1/downloads', { method: 'POST', body: { platform: inspected.metadata.platform, content_id: String(inspected.metadata.content_id), skip_existing: true } })
  if (!started?.download_id) throw new Error('DTK 下载任务缺少 download_id')
  const deadline = Date.now() + (options.timeoutMs || 180000)
  let record
  while (Date.now() < deadline) {
    record = await dtkRequest(inspected.config, `/api/v1/downloads/${encodeURIComponent(started.download_id)}`)
    if (record.state === 'done') break
    if (['failed', 'partial', 'cancelled'].includes(record.state)) throw new Error(`DTK 下载失败：${record.error?.code || record.state}`)
    await delay(options.pollIntervalMs || 1000)
  }
  if (record?.state !== 'done' || record.on_disk !== true) throw new Error('DTK 下载超时或文件已不在磁盘')
  const video = record.files?.find((item) => item?.kind === 'video' || String(item?.content_type || '').startsWith('video/'))
  if (!video?.name || !VIDEO_EXTENSIONS.has(extname(video.name).toLowerCase())) throw new Error('DTK 下载结果不包含受支持的视频文件')
  const target = resolve(targetDirectory, `download${extname(video.name).toLowerCase()}`)
  const response = await dtkRequest(inspected.config, `/api/v1/downloads/${encodeURIComponent(started.download_id)}/files/${encodeURIComponent(video.name)}`, { binary: true, timeoutMs: options.timeoutMs || 180000 })
  await writeResponseFile(response, target)
  if (video.sha256 && await fileSha256(target) !== video.sha256) throw new Error('DTK 下载文件 SHA-256 与服务端记录不一致')
  return { path: target, upstreamDownloadId: started.download_id }
}

async function downloadWithYtDlp(inspected, targetDirectory) {
  const template = resolve(targetDirectory, 'download.%(ext)s')
  runYtDlp(inspected.binary, ['--no-playlist', '--no-progress', '--max-filesize', '2G', '--merge-output-format', 'mp4', '-o', template, '--', inspected.reference.url])
  const candidates = (await readdir(targetDirectory)).filter((name) => VIDEO_EXTENSIONS.has(extname(name).toLowerCase()))
  if (candidates.length !== 1) throw new Error('yt-dlp 必须且只能生成一个视频文件')
  return { path: resolve(targetDirectory, candidates[0]), upstreamDownloadId: null }
}

function runProjectStore(...args) {
  const result = spawnSync(process.execPath, [resolve(scripts, 'project-store.mjs'), ...args], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'project-store 执行失败').trim())
  return result.stdout
}

async function atomicJson(root, path, value) {
  await assertSafeOutputPath(root, path, '参考视频导入收据')
  await mkdir(dirname(path), { recursive: true })
  await assertSafeOutputPath(root, dirname(path), '参考视频导入收据目录')
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
  await rename(temporary, path)
}

function rejectCredentialFields(value, path = '') {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    const current = path ? `${path}.${key}` : key
    if (/(?:api[_-]?key|cookie|token|password|secret|authorization)/i.test(key)) throw new Error(`导入收据包含凭据字段：${current}`)
    rejectCredentialFields(child, current)
  }
}

export async function validateReferenceImportReceipts(rootValue) {
  const root = resolve(rootValue)
  const receiptsRoot = resolve(root, '.short-drama/reference-imports')
  let sourceEntries
  try { sourceEntries = await readdir(receiptsRoot, { withFileTypes: true }) } catch (error) { if (error?.code === 'ENOENT') return []; throw error }
  const manifest = JSON.parse(await readFile(resolve(root, 'source/manifest.json'), 'utf8'))
  const valid = []
  const fields = ['schema_version', 'imported_at', 'provider', 'platform', 'content_id', 'source_url', 'title', 'author', 'source_ref', 'technical', 'upstream_download_id', 'rights_confirmation']
  for (const sourceEntry of sourceEntries) {
    if (!sourceEntry.isDirectory() || !/^src-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(sourceEntry.name)) throw new Error(`导入收据来源目录无效：${sourceEntry.name}`)
    for (const file of await readdir(resolve(receiptsRoot, sourceEntry.name))) {
      if (!/^v\d{3}\.json$/.test(file)) throw new Error(`导入收据文件名无效：${file}`)
      const versionId = file.slice(0, -5)
      const receipt = JSON.parse(await readFile(resolve(receiptsRoot, sourceEntry.name, file), 'utf8'))
      rejectCredentialFields(receipt)
      if (!receipt || Object.keys(receipt).sort().join() !== [...fields].sort().join() || receipt.schema_version !== 1 || !Number.isFinite(Date.parse(receipt.imported_at)) || !['dtk', 'yt-dlp'].includes(receipt.provider)) throw new Error(`${sourceEntry.name}@${versionId} 导入收据合同无效`)
      parseReferenceVideoUrl(receipt.source_url)
      if (receipt.source_ref?.key !== sourceEntry.name || receipt.source_ref?.version_id !== versionId || !/^[0-9a-f]{64}$/.test(receipt.source_ref?.sha256 || '') || !Number.isInteger(receipt.source_ref?.size_bytes) || receipt.source_ref.size_bytes <= 0) throw new Error(`${sourceEntry.name}@${versionId} source_ref 无效`)
      if (receipt.rights_confirmation?.confirmed !== true || !['owned', 'licensed', 'authorized-reference'].includes(receipt.rights_confirmation?.basis)) throw new Error(`${sourceEntry.name}@${versionId} 权利确认无效`)
      const source = manifest.sources?.[sourceEntry.name]
      const version = source?.versions?.find((item) => item.id === versionId)
      if (source?.kind !== 'reference-video' || !version || version.sha256 !== receipt.source_ref.sha256 || version.sizeBytes !== receipt.source_ref.size_bytes) throw new Error(`${sourceEntry.name}@${versionId} 与来源账本不一致`)
      const sourcePath = await confinedExistingFile(root, version.localPath, '链接导入来源')
      if (await fileSha256(sourcePath) !== receipt.source_ref.sha256) throw new Error(`${sourceEntry.name}@${versionId} 本地文件 SHA-256 不一致`)
      valid.push(`${sourceEntry.name}@${versionId}`)
    }
  }
  return valid.sort()
}

export async function importReferenceVideoUrl(root, options = {}) {
  if (options.rightsConfirmation?.confirmed !== true || !['owned', 'licensed', 'authorized-reference'].includes(options.rightsConfirmation?.basis)) throw new Error('下载前必须确认素材权利或参考分析授权')
  const projectRoot = resolve(root)
  if (!/^src-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.sourceKey || '')) throw new Error('sourceKey 必须为 src-xxx 格式')
  if (!/^v\d{3}$/.test(options.versionId || '')) throw new Error('versionId 必须为 v001 格式')
  const receiptPath = resolve(projectRoot, '.short-drama/reference-imports', options.sourceKey, `${options.versionId}.json`)
  // 收据是导入事务的最后一步，所有可预检的路径风险必须在网络请求与来源登记前失败。
  await assertSafeOutputPath(projectRoot, receiptPath, '参考视频导入收据')
  await assertSafeOutputPath(projectRoot, dirname(receiptPath), '参考视频导入收据目录')
  const inspected = await inspectReferenceVideoUrl(options.input, options)
  const staging = await mkdtemp(resolve(tmpdir(), 'short-drama-reference-import-'))
  try {
    const downloaded = inspected.provider === 'dtk' ? await downloadWithDtk(inspected, staging, options) : await downloadWithYtDlp(inspected, staging)
    const info = await stat(downloaded.path)
    if (!info.isFile() || info.size <= 0 || info.size > MAX_BYTES) throw new Error('下载视频为空或超过 2 GiB')
    const technical = await probeReferenceVideo(downloaded.path)
    const digest = await fileSha256(downloaded.path)
    runProjectStore('put-source', projectRoot, options.sourceKey, options.versionId, downloaded.path, '--select')
    const metadata = inspected.metadata
    const receipt = {
      schema_version: 1,
      imported_at: new Date().toISOString(),
      provider: inspected.provider,
      platform: metadata.platform || inspected.reference.platform,
      content_id: String(metadata.content_id || metadata.id),
      source_url: metadata.web_url || metadata.webpage_url || inspected.reference.url,
      title: metadata.title || null,
      author: metadata.author?.nickname || metadata.uploader || null,
      source_ref: { key: options.sourceKey, version_id: options.versionId, sha256: digest, size_bytes: info.size },
      technical,
      upstream_download_id: downloaded.upstreamDownloadId,
      rights_confirmation: { confirmed: true, basis: options.rightsConfirmation.basis },
    }
    await atomicJson(projectRoot, receiptPath, receipt)
    return { ...receipt, receipt_path: `.short-drama/reference-imports/${options.sourceKey}/${options.versionId}.json` }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

function optionValue(args, name) {
  const index = args.indexOf(name)
  return index < 0 ? undefined : args[index + 1]
}

function publicInspection(inspected) {
  const metadata = inspected.metadata
  return {
    provider: inspected.provider,
    platform: metadata.platform || inspected.reference.platform,
    content_id: String(metadata.content_id || metadata.id),
    source_url: metadata.web_url || metadata.webpage_url || inspected.reference.url,
    title: metadata.title || null,
    author: metadata.author?.nickname || metadata.uploader || null,
    duration_ms: metadata.duration_ms || metadata.duration ? Math.round(Number(metadata.duration_ms || metadata.duration * 1000)) : null,
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2)
  if (command === '--self-check') {
    if (parseReferenceVideoUrl('https://v.douyin.com/AbCd12/').platform !== 'douyin') throw new Error('自检失败')
    return console.log('ok')
  }
  if (command === 'inspect') {
    const input = args[0]
    if (!input) throw new Error('用法：reference-video-import.mjs inspect <链接或分享文本> [--provider auto|dtk|yt-dlp]')
    const inspected = await inspectReferenceVideoUrl(input, { provider: optionValue(args, '--provider') || 'auto' })
    return console.log(JSON.stringify(publicInspection(inspected), null, 2))
  }
  if (command === 'import') {
    const [root, input, sourceKey, versionId] = args
    const basis = optionValue(args, '--rights-basis')
    if (!root || !input || !sourceKey || !versionId || !basis) throw new Error('用法：reference-video-import.mjs import <项目目录> <链接或分享文本> <source-key> <version> --rights-basis owned|licensed|authorized-reference [--provider auto|dtk|yt-dlp]')
    const result = await importReferenceVideoUrl(root, { input, sourceKey, versionId, provider: optionValue(args, '--provider') || 'auto', rightsConfirmation: { confirmed: true, basis } })
    return console.log(JSON.stringify(result, null, 2))
  }
  throw new Error('用法：reference-video-import.mjs inspect|import|--self-check ...')
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exitCode = 1 })
