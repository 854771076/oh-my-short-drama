import { openAsBlob } from 'node:fs'
import { basename } from 'node:path'

const ENDPOINT = 'https://tempfile.org/api/upload/local'
const EXPIRIES = new Set(['1h', '6h', '24h', '48h'])
export const capabilities = { media_types: ['image', 'audio'], anonymous: true, free: true, expiries: [...EXPIRIES], max_bytes: 100 * 1024 ** 2, permanent: false }

export async function upload(path, expiry, fetchImpl = fetch) {
  if (!EXPIRIES.has(expiry)) throw new Error('TempFile.org expires_in 只能是 1h、6h、24h 或 48h')
  const body = new FormData()
  body.append('files', await openAsBlob(path), basename(path))
  body.append('expiryHours', expiry.slice(0, -1))
  const response = await fetchImpl(ENDPOINT, { method: 'POST', body, signal: AbortSignal.timeout(120000) })
  const text = await response.text()
  if (!response.ok) throw new Error(`TempFile.org HTTP ${response.status}: ${text.slice(0, 300)}`)
  let data
  try { data = JSON.parse(text) } catch { throw new Error('TempFile.org 返回无效 JSON') }
  const url = data.files?.[0]?.url
  if (!url) throw new Error('TempFile.org 返回缺少文件 URL')
  return validateUrl(url)
}
export function validateUrl(value) { const url = new URL(value); if (url.protocol !== 'https:' || url.hostname !== 'tempfile.org' || url.username || url.password) throw new Error('TempFile.org 返回了非官方 HTTPS 地址'); return url.href }
export function selfCheck() { if (capabilities.max_bytes !== 100 * 1024 ** 2) throw new Error('TempFile.org 能力合同自检失败'); return true }
