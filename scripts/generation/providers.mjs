import { starrouter } from './starrouter.mjs'
import { runninghub } from './runninghub.mjs'
import { comfly } from './comfly.mjs'
import { credential } from './credentials.mjs'

export const adapters = { starrouter, runninghub, comfly }
export const providerNames = Object.keys(adapters)

export function adapter(name) {
  const selected = adapters[name]
  if (!selected) throw new Error(`未注册的生成 Provider：${name}`)
  return selected
}

export function providerCatalog() {
  return Object.fromEntries(Object.entries(adapters).map(([name, value]) => [name, value.capabilities]))
}

export function providerSetupCatalog() {
  return Object.entries(adapters).map(([key, value]) => ({
    key, label: value.label || key, configured: Boolean(credential(value.credentialEnv)), credentialEnv: value.credentialEnv,
    capabilities: value.capabilities,
    models: Object.fromEntries(['image', 'video', 'audio'].map((type) => [type, (value.catalog?.[type] || []).map((id) => ({ id, promptProfile: type === 'video' ? /^MiniMax-H3|^minimax-h3/.test(id) ? 'h3' : /seedance-2-0/.test(id) ? 'seedance2' : 'generic' : null }))])),
  }))
}

export async function testProviderConnection(name) {
  const selected = adapter(name)
  if (!selected.testConnection) throw new Error(`Provider 不支持连接测试：${name}`)
  await selected.testConnection()
}
