import { openAsBlob } from 'node:fs'
import { basename, extname } from 'node:path'

const ENDPOINT = 'https://litterbox.catbox.moe/resources/internals/api.php'
const EXPIRIES = new Set(['1h', '12h', '24h', '72h'])
const DISALLOWED = /\.(?:exe|scr|cpl|doc[^.]?|jar)$/i

export const capabilities = { media_types: ['image'], anonymous: true, free: true, expiries: [...EXPIRIES], max_bytes: 1024 ** 3, permanent: false }

export async function upload(path, expiry, fetchImpl = fetch) {
  if (!EXPIRIES.has(expiry)) throw new Error('Litterbox expires_in 只能是 1h、12h、24h 或 72h')
  if (DISALLOWED.test(extname(path))) throw new Error('Litterbox 禁止该文件类型')
  const body = new FormData()
  body.set('reqtype', 'fileupload')
  body.set('time', expiry)
  body.set('fileToUpload', await openAsBlob(path), basename(path))
  const response = await fetchImpl(ENDPOINT, { method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(120000) })
  const text = (await response.text()).trim()
  if (!response.ok) throw new Error(`Litterbox HTTP ${response.status}: ${text.slice(0, 300)}`)
  let url
  try { url = new URL(text) } catch { throw new Error(`Litterbox 返回无效 URL：${text.slice(0, 300)}`) }
  if (url.protocol !== 'https:' || url.hostname !== 'litter.catbox.moe' || url.username || url.password) throw new Error('Litterbox 返回了非官方 HTTPS 地址')
  return url.href
}

export function selfCheck() {
  if (capabilities.expiries.join(',') !== '1h,12h,24h,72h' || capabilities.permanent !== false) throw new Error('Litterbox 能力合同自检失败')
  return true
}

if (process.argv.includes('--self-check')) { selfCheck(); console.log('ok') }
