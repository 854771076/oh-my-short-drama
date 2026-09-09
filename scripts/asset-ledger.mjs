#!/usr/bin/env node
import { createReadStream, createWriteStream } from 'node:fs'
import { access, copyFile, link, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { COPYFILE_EXCL } from 'node:constants'
import { basename, dirname, extname, relative, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { withFileLock } from './file-lock.mjs'
import { invalidateFrom } from './invalidate-workflow.mjs'
import { validDocumentReferenceShape } from './document-reference.mjs'

const TYPES = new Set(['character', 'scene', 'prop', 'storyboard', 'video', 'audio', 'other'])
const TYPE_DIRECTORIES = { character: 'characters', scene: 'scenes', prop: 'props', storyboard: 'storyboards', video: 'videos', audio: 'audio', other: 'other' }
const TYPE_PREFIXES = { character: 'char-', scene: 'scene-', prop: 'prop-', storyboard: 'board-', video: 'shot-', audio: 'audio-', other: 'other-' }
const PROVENANCE_ORIGINS = new Set(['imported', 'generated', 'transformed'])
const PROVENANCE_CREATORS = new Set(['user', 'codex', 'provider'])
const CONTENT_EXTENSIONS = { 'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/flac': '.flac', 'audio/x-flac': '.flac', 'audio/L16': '.pcm', 'audio/pcm': '.pcm', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'video/mp4': '.mp4', 'video/webm': '.webm' }
const TYPE_EXTENSIONS = { image: new Set(['.gif', '.jpeg', '.jpg', '.png', '.webp']), video: new Set(['.mp4', '.webm']), audio: new Set(['.flac', '.mp3', '.pcm', '.wav']) }
const MUTATING = new Set(['put', 'add-version', 'select', 'revert'])
const MAX_MEDIA_BYTES = Number(process.env.SHORT_DRAMA_MAX_MEDIA_BYTES || 512 * 1024 * 1024)
if (!Number.isSafeInteger(MAX_MEDIA_BYTES) || MAX_MEDIA_BYTES <= 0) throw new Error('SHORT_DRAMA_MAX_MEDIA_BYTES 必须是正整数')

function rejectSecrets(value, path = '') {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key
    if (/(?:api[_-]?key|token|password|secret|authorization)/i.test(key)) throw new Error(`记录中禁止包含密钥字段：${childPath}`)
    rejectSecrets(child, childPath)
  }
}

function ledgerPath(root) { return resolve(root, '.short-drama', 'assets.json') }

function safeKey(value, field) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) throw new Error(`${field} 无效`)
  return value
}

function versionKey(value) {
  if (typeof value !== 'string' || !/^v\d{3}$/.test(value)) throw new Error('版本 id 必须为 v001 格式')
  return value
}

function validateAssetKey(value, type) {
  if (typeof value !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) throw new Error('资产 key 必须是小写 kebab-case')
  if (!value.startsWith(TYPE_PREFIXES[type])) throw new Error(`${type} 资产 key 必须以 ${TYPE_PREFIXES[type]} 开头`)
}

function validateMediaExtension(type, extension) {
  if (type === 'other') return
  const family = ['character', 'scene', 'prop', 'storyboard'].includes(type) ? 'image' : type
  if (!TYPE_EXTENSIONS[family]?.has(extension.toLowerCase())) throw new Error(`${type} 资产扩展名无效：${extension || '(空)'}`)
}

function normalizeProvenance(value, fallbackOrigin = 'imported') {
  const base = { origin: fallbackOrigin, created_by: fallbackOrigin === 'imported' ? 'user' : 'provider', provider: null, model_or_workflow: null, task_id: null, prompt_document: null, source_assets: [], parameters: {} }
  const output = { ...base, ...(value || {}) }
  if (Object.keys(output).sort().join() !== Object.keys(base).sort().join()) throw new Error(`provenance 字段必须且只能是：${Object.keys(base).join(', ')}`)
  if (!PROVENANCE_ORIGINS.has(output.origin) || !PROVENANCE_CREATORS.has(output.created_by)) throw new Error('provenance origin/created_by 无效')
  for (const field of ['provider', 'model_or_workflow', 'task_id']) if (output[field] !== null && (typeof output[field] !== 'string' || !output[field].trim())) throw new Error(`provenance.${field} 无效`)
  if (output.created_by === 'provider' && ['generated', 'transformed'].includes(output.origin) && (!output.provider || !output.model_or_workflow || !output.task_id)) throw new Error('Provider 媒体 provenance 必须包含 provider、model_or_workflow 和 task_id')
  if (output.prompt_document !== null) {
    if (!validDocumentReferenceShape(output.prompt_document)) throw new Error('provenance.prompt_document 无效')
  }
  if (!Array.isArray(output.source_assets) || output.source_assets.some((item) => !item || typeof item.key !== 'string' || !/^v\d{3}$/.test(item.version_id))) throw new Error('provenance.source_assets 无效')
  if (output.origin === 'transformed' && output.source_assets.length === 0) throw new Error('transformed provenance 必须包含上游资产版本')
  if (!output.parameters || typeof output.parameters !== 'object' || Array.isArray(output.parameters)) throw new Error('provenance.parameters 必须是对象')
  rejectSecrets(output)
  return output
}

function localPath(root, value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('版本 localPath 必填')
  const path = resolve(root, value)
  if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error('版本 localPath 必须位于项目目录内')
  return path
}

async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function privateAddress(value) {
  const address = value.toLowerCase().replace(/^::ffff:/, '')
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number)
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  }
  return address === '::1' || address === '::' || address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe8') || address.startsWith('fe9') || address.startsWith('fea') || address.startsWith('feb')
}

async function assertPublicHttps(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.hostname === 'localhost') throw new Error('素材 URL 必须是公网 HTTPS')
  const addresses = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true })
  if (!addresses.length || addresses.some((item) => privateAddress(item.address))) throw new Error('素材 URL 不得解析到私有网络')
  return url
}

async function fetchPublic(value) {
  let url = new URL(value)
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    await assertPublicHttps(url)
    const response = await fetch(url, { signal: AbortSignal.timeout(300_000), redirect: 'manual' })
    if (response.status < 300 || response.status >= 400) return response
    const location = response.headers.get('location')
    if (!location) throw new Error('素材重定向缺少 Location')
    url = new URL(location, url)
  }
  throw new Error('素材重定向次数过多')
}

async function readLedger(root) {
  try { return JSON.parse(await readFile(ledgerPath(root), 'utf8')) }
  catch (error) {
    if (error?.code === 'ENOENT') return { version: 1, assets: {} }
    throw error
  }
}

async function save(root, ledger) {
  const target = ledgerPath(root)
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(ledger, null, 2)}\n`, { flag: 'wx' })
  await rename(temporary, target)
}

function get(ledger, key) {
  const asset = ledger.assets[key]
  if (!asset) throw new Error(`资产不存在：${key}`)
  return asset
}

async function main() {
  const [command, rootArg, ...args] = process.argv.slice(2)
  if (command === '--self-check') {
    if (!TYPES.has('character') || TYPES.has('unknown')) throw new Error('自检失败')
    validateAssetKey('shot-001', 'video')
    versionKey('v001')
    try { versionKey('v1'); throw new Error('版本规范自检失败') } catch (error) { if (!String(error.message).includes('v001')) throw error }
    normalizeProvenance(null)
    normalizeProvenance({ origin: 'generated', created_by: 'provider', provider: 'starrouter', model_or_workflow: 'video-model', task_id: 'task-1', prompt_document: null, source_assets: [], parameters: {} })
    return console.log('ok')
  }
  if (!rootArg) throw new Error('必须提供项目目录')
  const root = resolve(rootArg)
  const operate = async () => {
  const ledger = await readLedger(root)
  if (command === 'list') return console.log(JSON.stringify(args[0] ? get(ledger, args[0]) : ledger, null, 2))
  if (command === 'put') {
    if (!args[0]) throw new Error('用法：put <项目目录> <资产 JSON>')
    const record = JSON.parse(await readFile(resolve(args[0]), 'utf8'))
    rejectSecrets(record)
    if (!TYPES.has(record.type) || typeof record.name !== 'string' || !record.name.trim()) throw new Error('资产 type/name 无效')
    validateAssetKey(record.key, record.type)
    const previous = ledger.assets[record.key]
    if (previous && previous.type !== record.type) throw new Error('资产 type 不可变')
    if (['versions', 'selectedVersionId', 'selectedHistory'].some((field) => field in record)) throw new Error('put 不得直接写入版本或选版字段')
    ledger.assets[record.key] = { ...previous, ...record, versions: previous?.versions || [], selectedHistory: previous?.selectedHistory || [], staleVersionIds: previous?.staleVersionIds || [], updatedAt: new Date().toISOString() }
    await save(root, ledger)
    return console.log(JSON.stringify(ledger.assets[record.key], null, 2))
  }
  if (command === 'add-version') {
    const [key, file] = args
    if (!key || !file) throw new Error('用法：add-version <项目目录> <资产 key> <版本 JSON>')
    const asset = get(ledger, key)
    const version = JSON.parse(await readFile(resolve(file), 'utf8'))
    rejectSecrets(version)
    versionKey(version.id)
    if (!version.provenance) throw new Error('add-version 必须提供 provenance')
    version.provenance = normalizeProvenance(version.provenance)
    if (asset.versions.some((item) => item.id === version.id)) throw new Error(`版本已存在：${version.id}`)
    const path = localPath(root, version.localPath)
    validateMediaExtension(asset.type, extname(path))
    const expectedDirectory = resolve(root, 'assets', TYPE_DIRECTORIES[asset.type], key)
    if (!path.startsWith(`${expectedDirectory}${sep}`)) throw new Error('版本 localPath 必须位于该资产的标准目录')
    const fileStat = await stat(path)
    if (!fileStat.isFile() || fileStat.size > MAX_MEDIA_BYTES) throw new Error('本地资产文件无效或超过大小限制')
    asset.versions.push({ ...version, sizeBytes: fileStat.size, sha256: await sha256(path), createdAt: version.createdAt || new Date().toISOString() })
    asset.updatedAt = new Date().toISOString()
    await save(root, ledger)
    return console.log(JSON.stringify(asset, null, 2))
  }
  if (['import', 'fetch', 'decode'].includes(command)) {
    const [key, source, versionId, requestedNameValue, provenancePath] = args
    const asset = get(ledger, key)
    versionKey(versionId)
    if (!source) throw new Error(`用法：${command} <项目目录> <资产 key> <本地文件或 HTTPS URL> <版本 id> [文件名或 -] [provenance JSON]`)
    if (command !== 'import' && !provenancePath) throw new Error(`${command} 必须提供 provenance JSON`)
    const requestedName = requestedNameValue && requestedNameValue !== '-' ? requestedNameValue : undefined
    const provenance = normalizeProvenance(provenancePath ? JSON.parse(await readFile(resolve(provenancePath), 'utf8')) : null, command === 'import' ? 'imported' : 'generated')
    if (asset.versions.some((item) => item.id === versionId)) throw new Error(`版本已存在：${versionId}`)
    const directory = resolve(root, 'assets', TYPE_DIRECTORIES[asset.type], key)
    await mkdir(directory, { recursive: true })
    let extension = command === 'import' ? extname(source) : command === 'fetch' ? extname(new URL(source).pathname) : ''
    if (command === 'import') validateMediaExtension(asset.type, extension)
    let temporary = resolve(directory, `.${randomUUID()}.tmp`)
    let target = ''
    let createdTarget = false
    try {
      if (command === 'import') {
        await copyFile(resolve(source), temporary, COPYFILE_EXCL)
      } else if (command === 'fetch') {
        const response = await fetchPublic(source)
        if (!response.ok || !response.body) throw new Error(`素材下载失败(${response.status})`)
        const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() || ''
        const expected = asset.type === 'character' || asset.type === 'scene' || asset.type === 'prop' || asset.type === 'storyboard' ? 'image/' : `${asset.type}/`
        const expectedExtensions = TYPE_EXTENSIONS[expected.slice(0, -1)]
        const binaryWithKnownExtension = contentType === 'application/octet-stream' && expectedExtensions?.has(extension.toLowerCase())
        if (asset.type !== 'other' && !contentType.startsWith(expected) && !binaryWithKnownExtension) throw new Error(`素材类型不匹配：期望 ${expected}，实际 ${contentType || 'unknown'}`)
        extension ||= CONTENT_EXTENSIONS[contentType] || '.bin'
        validateMediaExtension(asset.type, extension)
        const declaredSize = Number(response.headers.get('content-length') || 0)
        if (declaredSize > MAX_MEDIA_BYTES) throw new Error('远程素材超过大小限制')
        let received = 0
        const limited = response.body.pipeThrough(new TransformStream({ transform(chunk, controller) {
          received += chunk.byteLength
          if (received > MAX_MEDIA_BYTES) throw new Error('远程素材超过大小限制')
          controller.enqueue(chunk)
        } }))
        await pipeline(limited, createWriteStream(temporary, { flags: 'wx' }))
      } else {
        const encoded = (await readFile(resolve(source), 'utf8')).trim()
        const match = /^data:([^;,]+);base64,(.+)$/s.exec(encoded)
        extension = CONTENT_EXTENSIONS[match?.[1]] || '.bin'
        validateMediaExtension(asset.type, extension)
        const payload = (match?.[2] || encoded).replace(/\s+/g, '')
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(payload) || payload.length % 4 === 1) throw new Error('base64 素材无效')
        const bytes = Buffer.from(payload, 'base64')
        if (!bytes.length || bytes.length > MAX_MEDIA_BYTES) throw new Error('base64 素材为空或超过大小限制')
        await writeFile(temporary, bytes, { flag: 'wx' })
      }
      const filename = requestedName ? basename(requestedName) : `${versionId}${extension || '.bin'}`
      if (!filename || filename === '.' || filename === '..') throw new Error('文件名无效')
      validateMediaExtension(asset.type, extname(filename))
      target = resolve(directory, filename)
      await link(temporary, target)
      createdTarget = true
      await rm(temporary)
      temporary = ''
      const fileStat = await stat(target)
      const version = { id: versionId, localPath: relative(root, target), sizeBytes: fileStat.size, sha256: await sha256(target), provenance, createdAt: new Date().toISOString() }
      await withFileLock(ledgerPath(root), async () => {
        const latest = await readLedger(root)
        const latestAsset = get(latest, key)
        if (latestAsset.versions.some((item) => item.id === versionId)) throw new Error(`版本已存在：${versionId}`)
        latestAsset.versions.push(version)
        latestAsset.updatedAt = new Date().toISOString()
        await save(root, latest)
      })
      return console.log(JSON.stringify(version, null, 2))
    } catch (error) {
      if (temporary) await rm(temporary, { force: true })
      if (createdTarget) await rm(target, { force: true })
      throw error
    }
  }
  if (command === 'select') {
    const [key, versionId] = args
    const asset = get(ledger, key)
    versionKey(versionId)
    const version = asset.versions.find((item) => item.id === versionId)
    if (!version) throw new Error(`版本不存在：${versionId}`)
    if (asset.staleVersionIds?.includes(versionId)) throw new Error(`版本已因上游变更失效：${key}@${versionId}`)
    await access(localPath(root, version.localPath))
    await invalidateFrom(root, ['character', 'scene', 'prop'].includes(asset.type) ? 'asset-generation' : 'media-production')
    if (asset.selectedVersionId && asset.selectedVersionId !== versionId) asset.selectedHistory.push(asset.selectedVersionId)
    asset.selectedVersionId = versionId
    asset.updatedAt = new Date().toISOString()
    await save(root, ledger)
    return console.log(JSON.stringify(asset, null, 2))
  }
  if (command === 'revert') {
    const asset = get(ledger, args[0])
    const previous = asset.selectedHistory.pop()
    if (!previous) throw new Error('没有可撤回的选版')
    const version = asset.versions.find((item) => item.id === previous)
    if (!version) throw new Error(`历史版本不存在：${previous}`)
    if (asset.staleVersionIds?.includes(previous)) throw new Error(`历史版本已因上游变更失效：${asset.key}@${previous}`)
    await access(localPath(root, version.localPath))
    await invalidateFrom(root, ['character', 'scene', 'prop'].includes(asset.type) ? 'asset-generation' : 'media-production')
    asset.selectedVersionId = previous
    asset.updatedAt = new Date().toISOString()
    await save(root, ledger)
    return console.log(JSON.stringify(asset, null, 2))
  }
  throw new Error('用法：asset-ledger.mjs put|import|fetch|decode|add-version|select|revert|list ...')
  }
  return MUTATING.has(command) ? withFileLock(ledgerPath(root), operate) : operate()
}

main().catch((error) => { console.error(error.message); process.exitCode = 1 })
