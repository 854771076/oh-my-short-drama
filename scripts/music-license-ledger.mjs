import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'

const FIELDS = ['receipt_key', 'catalog', 'track_id', 'title', 'creator', 'source_url', 'license_name', 'license_url', 'downloaded_at', 'attribution_required', 'attribution_text', 'content_id_risk', 'allowed_uses', 'proof_path']
const CATALOGS = new Set(['local-licensed', 'pixabay', 'youtube-audio-library', 'uppbeat'])
const USES = new Set(['online-video', 'commercial', 'paid-ad', 'client-project', 'broadcast'])

function exactKeys(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('music license receipt 必须是对象')
  const actual = Object.keys(value).sort(), expected = [...FIELDS].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`music license receipt 字段必须精确为 ${FIELDS.join(', ')}`)
}

function httpsUrl(value, field) {
  let url
  try { url = new URL(value) } catch { throw new Error(`${field} 必须是 HTTPS URL`) }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`${field} 必须是无凭据 HTTPS URL`)
  return url
}

function rejectSecrets(value, path = '') {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    const current = path ? `${path}.${key}` : key
    if (/(?:cookie|account|api[_-]?key|token|password|secret|authorization|payment)/i.test(key)) throw new Error(`音乐许可证收据禁止保存敏感字段：${current}`)
    rejectSecrets(child, current)
  }
}

function validateReceipt(receipt) {
  exactKeys(receipt)
  rejectSecrets(receipt)
  if (!/^music-license-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(receipt.receipt_key || '')) throw new Error('receipt_key 无效')
  if (!CATALOGS.has(receipt.catalog)) throw new Error('音乐许可证 catalog 无效')
  for (const field of ['track_id', 'title', 'creator', 'license_name']) if (typeof receipt[field] !== 'string' || !receipt[field].trim()) throw new Error(`${field} 必填`)
  const source = httpsUrl(receipt.source_url, 'source_url')
  httpsUrl(receipt.license_url, 'license_url')
  const expectedHost = { pixabay: 'pixabay.com', 'youtube-audio-library': 'youtube.com', uppbeat: 'uppbeat.io' }[receipt.catalog]
  if (expectedHost && source.hostname !== expectedHost && !source.hostname.endsWith(`.${expectedHost}`)) throw new Error(`${receipt.catalog} 收据的 source_url 必须来自对应官方站点`)
  if (!Number.isFinite(Date.parse(receipt.downloaded_at))) throw new Error('downloaded_at 必须是 ISO 日期时间')
  if (typeof receipt.attribution_required !== 'boolean' || typeof receipt.attribution_text !== 'string' || receipt.attribution_required && !receipt.attribution_text.trim()) throw new Error('署名要求与 attribution_text 无效')
  if (typeof receipt.content_id_risk !== 'boolean') throw new Error('content_id_risk 必须明确为布尔值')
  if (!Array.isArray(receipt.allowed_uses) || !receipt.allowed_uses.length || new Set(receipt.allowed_uses).size !== receipt.allowed_uses.length || receipt.allowed_uses.some((item) => !USES.has(item))) throw new Error('allowed_uses 必须是非重复的受控用途数组')
  if (receipt.proof_path !== null && (typeof receipt.proof_path !== 'string' || !receipt.proof_path.trim())) throw new Error('proof_path 必须是项目内路径或 null')
  return receipt
}

async function assertProofInside(root, proofPath) {
  if (proofPath === null) return
  const [rootReal, proofReal] = await Promise.all([realpath(root), realpath(resolve(root, proofPath))])
  if (proofReal !== rootReal && !proofReal.startsWith(`${rootReal}${sep}`)) throw new Error('proof_path 必须位于项目目录内')
}

export async function putMusicLicense(rootArg, input) {
  const root = resolve(rootArg), receipt = structuredClone(input)
  validateReceipt(receipt)
  await assertProofInside(root, receipt.proof_path)
  const path = resolve(root, '.short-drama', 'music-licenses', `${receipt.receipt_key}.json`)
  await mkdir(dirname(path), { recursive: true })
  try { await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' }) }
  catch (error) { if (error.code === 'EEXIST') throw new Error(`音乐许可证收据已存在：${receipt.receipt_key}`); throw error }
  return receipt
}

export async function getMusicLicense(rootArg, receiptKey) {
  if (!/^music-license-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(receiptKey || '')) throw new Error('receipt_key 无效')
  return validateReceipt(JSON.parse(await readFile(resolve(rootArg, '.short-drama', 'music-licenses', `${receiptKey}.json`), 'utf8')))
}

export function validateMusicUse(receipt, use) {
  validateReceipt(receipt)
  for (const field of ['commercial', 'paid_ad', 'client_project', 'broadcast']) if (typeof use?.[field] !== 'boolean') throw new Error(`音乐用途 ${field} 必须明确为布尔值`)
  const required = []
  if (use.paid_ad) required.push('paid-ad')
  if (use.broadcast) required.push('broadcast')
  if (use.client_project) required.push('client-project')
  if (use.commercial) required.push('commercial')
  if (!required.length) required.push('online-video')
  const missing = required.filter((item) => !receipt.allowed_uses.includes(item))
  if (missing.length) throw new Error(`许可证用途不覆盖：${missing.map((item) => item.replace('-', '_')).join(', ')}`)
  return receipt
}
