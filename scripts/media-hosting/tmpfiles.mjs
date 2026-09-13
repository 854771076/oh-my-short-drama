import { openAsBlob } from 'node:fs'
import { basename } from 'node:path'
const ENDPOINT = 'https://tmpfiles.org/api/v1/upload'
export const capabilities = { media_types: ['image', 'audio'], anonymous: true, free: true, expiries: ['1h'], max_bytes: 100 * 1024 ** 2, permanent: false }
export async function upload(path, expiry, fetchImpl = fetch) {
  if (expiry !== '1h') throw new Error('tmpfiles.org 只支持 1h')
  const body = new FormData(); body.append('file', await openAsBlob(path), basename(path))
  const response = await fetchImpl(ENDPOINT, { method: 'POST', body, signal: AbortSignal.timeout(120000) }); const text = await response.text()
  if (!response.ok) throw new Error(`tmpfiles.org HTTP ${response.status}: ${text.slice(0, 300)}`)
  let data; try { data = JSON.parse(text) } catch { throw new Error('tmpfiles.org 返回无效 JSON') }
  const url = data.data?.url; if (!url) throw new Error('tmpfiles.org 返回缺少文件 URL'); return validateUrl(url)
}
export function validateUrl(value) { const url = new URL(value); if (url.protocol !== 'https:' || url.hostname !== 'tmpfiles.org' || url.username || url.password) throw new Error('tmpfiles.org 返回了非官方 HTTPS 地址'); return url.href }
export function selfCheck() { return true }
