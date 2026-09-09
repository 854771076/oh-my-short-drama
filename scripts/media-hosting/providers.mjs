import * as litterbox from './litterbox.mjs'

export const mediaHosts = { litterbox }
export const mediaHostNames = Object.keys(mediaHosts)
export function mediaHostCatalog() { return Object.fromEntries(Object.entries(mediaHosts).map(([name, host]) => [name, host.capabilities])) }
export function mediaHost(name) {
  if (!mediaHosts[name]) throw new Error(`未注册的临时媒体托管服务：${name}`)
  return mediaHosts[name]
}
