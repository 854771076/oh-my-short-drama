import { createReadStream } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, relative, resolve, sep } from 'node:path'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir as osTmpdir } from 'node:os'
import { mediaHost } from './providers.mjs'
import { withFileLock } from '../file-lock.mjs'

const IMAGE_TYPES = new Set(['character', 'scene', 'prop', 'storyboard', 'other'])
const EXPIRY_MS = { '1h': 3600000, '12h': 43200000, '24h': 86400000, '72h': 259200000 }

async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
async function assertImage(path) {
  const handle = await open(path, 'r')
  try {
    const bytes = Buffer.alloc(12)
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
    const hex = bytes.subarray(0, bytesRead).toString('hex')
    const ascii = bytes.subarray(0, bytesRead).toString('ascii')
    if (!(hex.startsWith('89504e470d0a1a0a') || hex.startsWith('ffd8ff') || ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a') || (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP'))) throw new Error('待发布文件内容不是受支持的 PNG/JPEG/GIF/WebP 图片')
  } finally { await handle.close() }
}
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
function rejectSecrets(value, path = '') {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    const next = path ? `${path}.${key}` : key
    if (/(?:api[_-]?key|token|password|secret|authorization)/i.test(key)) throw new Error(`上传收据禁止密钥字段：${next}`)
    rejectSecrets(child, next)
  }
}

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
    const assetsRoot = await realpath(resolve(root, 'assets'))
    let path
    let host
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
      host = mediaHost(input.service)
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
      host = mediaHost(input.service)
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

export async function listReferenceUploads(rootArg, filters = {}) {
  const root = await realpath(resolve(rootArg))
  const directory = resolve(root, '.short-drama/uploads')
  let files
  try { files = await readdir(directory) } catch (error) { if (error?.code === 'ENOENT') return []; throw error }
  const now = Date.now()
  const output = []
  for (const file of files) {
    if (!/^upload-[0-9a-f-]+\.json$/.test(file)) continue
    const receipt = JSON.parse(await readFile(resolve(directory, file), 'utf8'))
    const state = Date.parse(receipt.expires_at) > now ? 'active' : 'expired'
    if (filters.service && receipt.service !== filters.service || filters.asset_key && receipt.asset_key !== filters.asset_key || filters.version_id && receipt.version_id !== filters.version_id || filters.state && state !== filters.state) continue
    output.push({ ...receipt, state, receipt_path: relative(root, resolve(directory, file)) })
  }
  return output.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
}

export async function validateTemporaryReferenceUrl(rootArg, urlValue, reference, at = Date.now()) {
  let url
  try { url = new URL(urlValue) } catch { return }
  if (url.hostname !== 'litter.catbox.moe') return
  const root = await realpath(resolve(rootArg))
  const timestamp = at instanceof Date ? at.getTime() : Number(at)
  if (!Number.isFinite(timestamp)) throw new Error('临时参考 URL 校验时间无效')
  const directory = resolve(root, '.short-drama/uploads')
  let files
  try { files = await readdir(directory) } catch (error) { if (error?.code === 'ENOENT') throw new Error(`Litterbox URL 缺少同版本且在校验时间点有效的本地上传收据：${reference.asset_key}@${reference.version_id}`); throw error }
  for (const file of files) {
    if (!/^upload-[0-9a-f-]+\.json$/.test(file)) continue
    const receipt = JSON.parse(await readFile(resolve(directory, file), 'utf8'))
    if (receipt.service === 'litterbox' && receipt.url === url.href && receipt.asset_key === reference.asset_key && receipt.version_id === reference.version_id && Date.parse(receipt.created_at) <= timestamp && Date.parse(receipt.expires_at) > timestamp) return receipt
  }
  throw new Error(`Litterbox URL 缺少同版本且在校验时间点有效的本地上传收据：${reference.asset_key}@${reference.version_id}`)
}

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
