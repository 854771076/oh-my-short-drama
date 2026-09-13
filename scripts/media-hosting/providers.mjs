import * as litterbox from './litterbox.mjs'
import * as tempfile from './tempfile.mjs'
import * as tmpfiles from './tmpfiles.mjs'
import * as uguu from './uguu.mjs'

// 默认优先选择时效更长、容量更适合参考图的公共服务；调用方仍可显式指定其他服务。
export const mediaHosts = { tempfile, tmpfiles, uguu, litterbox }
export const mediaHostNames = Object.keys(mediaHosts)
export const mediaHostExpiries = [...new Set(Object.values(mediaHosts).flatMap(host => host.capabilities.expiries))]
export function mediaHostCatalog() { return Object.fromEntries(Object.entries(mediaHosts).map(([name, host]) => [name, host.capabilities])) }
export function mediaHost(name) {
  if (!mediaHosts[name]) throw new Error(`未注册的临时媒体托管服务：${name}`)
  return mediaHosts[name]
}
