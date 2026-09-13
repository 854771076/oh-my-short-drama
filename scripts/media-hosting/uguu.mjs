import { openAsBlob } from 'node:fs'
import { basename } from 'node:path'
const ENDPOINT = 'https://uguu.se/upload'
export const capabilities = { media_types: ['image', 'audio'], anonymous: true, free: true, expiries: ['1h'], max_bytes: 100 * 1024 ** 2, permanent: false }
export async function upload(path, expiry, fetchImpl = fetch) {
  if (expiry !== '1h') throw new Error('Uguu 适配器只接受 1h（服务端保留期可能变化）')
  const body = new FormData(); body.append('files[]', await openAsBlob(path), basename(path))
  const response = await fetchImpl(ENDPOINT, { method: 'POST', body, signal: AbortSignal.timeout(120000) }); const text = await response.text()
  if (!response.ok) throw new Error(`Uguu HTTP ${response.status}: ${text.slice(0, 300)}`)
  let data; try { data = JSON.parse(text) } catch { throw new Error('Uguu 返回无效 JSON') }
  const url = data.files?.[0]?.url; if (!url) throw new Error('Uguu 返回缺少文件 URL'); return validateUrl(url)
}
export function validateUrl(value) { const url = new URL(value); if (url.protocol !== 'https:' || url.hostname !== 'uguu.se' || url.username || url.password) throw new Error('Uguu 返回了非官方 HTTPS 地址'); return url.href }
export function selfCheck() { return true }
