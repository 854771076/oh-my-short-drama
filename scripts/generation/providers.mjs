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

const parameterCatalog = {
  starrouter: {
    'gpt-image-2': [
      { key: 'resolution', label: '分辨率', type: 'select', options: ['1K', '2K', '4K'], default: '1K' },
      { key: 'aspect_ratio', label: '画幅', type: 'select', options: ['1:1', '16:9', '9:16', '4:3', '3:4'], default: '1:1' },
      { key: 'n', label: '候选数量', type: 'number', min: 1, max: 4, default: 1 },
      { key: 'quality', label: '质量', type: 'select', options: ['auto', 'low', 'medium', 'high'], default: 'auto' },
    ],
    'speech-2.8-hd': [{ key: 'speed', label: '语速', type: 'number', min: 0.5, max: 2, step: 0.1, default: 1 }, { key: 'response_format', label: '格式', type: 'select', options: ['mp3', 'flac', 'pcm'], default: 'mp3' }],
    'speech-2.8-turbo': [{ key: 'speed', label: '语速', type: 'number', min: 0.5, max: 2, step: 0.1, default: 1 }, { key: 'response_format', label: '格式', type: 'select', options: ['mp3', 'flac', 'pcm'], default: 'mp3' }],
    suno_music: [{ key: 'make_instrumental', label: '默认纯音乐', type: 'boolean', default: false }],
  },
  runninghub: {
    'krea2-normal-v1': [
      { key: 'resolution', label: '分辨率', type: 'select', options: ['1K', '2K'], default: '2K' },
      { key: 'aspect_ratio', label: '画幅', type: 'select', options: ['1:1', '16:9', '9:16', '3:4', '4:3', '2:3', '3:2'], default: '4:3' },
    ],
    'minimax-h3-reference-to-video': [
      { key: 'duration', label: '默认时长（秒）', type: 'number', min: 5, max: 15, default: 5, overridable: true },
      { key: 'resolution', label: '分辨率', type: 'select', options: ['480p', '720p', '1K', '2K'], default: '1K' },
      { key: 'ratio', label: '画幅', type: 'select', options: ['16:9', '9:16'], default: '9:16' },
    ],
  },
  comfly: {
    'minimax-h3': [
      { key: 'duration', label: '默认时长（秒）', type: 'number', min: 5, max: 15, default: 5, overridable: true },
      { key: 'resolution', label: '分辨率', type: 'select', options: ['720p', '1K', '2K'], default: '1K' },
      { key: 'ratio', label: '画幅', type: 'select', options: ['16:9', '9:16'], default: '9:16' },
    ],
  },
}

for (const model of ['MiniMax-H3', 'MiniMax-H3-Max']) parameterCatalog.starrouter[model] = [
  { key: 'duration', label: '默认时长（秒）', type: 'number', min: model.endsWith('-Max') ? 5 : 4, max: 15, default: 5, overridable: true },
  { key: 'size', label: '分辨率', type: 'select', options: model.endsWith('-Max') ? ['480P', '768P'] : ['768P', '2K'], default: '768P' },
  { key: 'ratio', label: '画幅', type: 'select', options: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], default: '9:16' },
]
for (const model of adapters.starrouter.catalog.video.filter((id) => /seedance/.test(id))) parameterCatalog.starrouter[model] = [
  { key: 'duration', label: '默认时长（秒）', type: 'number', min: /seedance-2-0/.test(model) ? 4 : 1, max: 15, default: 5, overridable: true },
  { key: 'resolution', label: '分辨率', type: 'select', options: ['480p', '720p', '1080p'], default: '720p' },
  { key: 'ratio', label: '画幅', type: 'select', options: ['16:9', '9:16', '1:1', '4:3', '3:4'], default: '9:16' },
  { key: 'generate_audio', label: '生成原生声音', type: 'boolean', default: false },
  { key: 'watermark', label: '添加水印', type: 'boolean', default: false },
]

export function normalizeModelParameters(provider, model, values = {}) {
  const fields = parameterCatalog[provider]?.[model] || []
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('模型参数必须是对象')
  const unknown = Object.keys(values).filter((key) => !fields.some((field) => field.key === key))
  if (unknown.length) throw new Error(`模型参数不受支持：${unknown.join(', ')}`)
  return Object.fromEntries(fields.map((field) => {
    let value = values[field.key] ?? field.default
    if (field.type === 'number') {
      value = Number(value)
      if (!Number.isFinite(value) || value < field.min || value > field.max) throw new Error(`${field.label} 必须为 ${field.min}–${field.max}`)
    }
    if (field.type === 'boolean' && typeof value !== 'boolean') throw new Error(`${field.label} 必须为布尔值`)
    if (field.type === 'select' && !field.options.includes(value)) throw new Error(`${field.label} 选项无效`)
    return [field.key, value]
  }))
}

export function applyConfiguredModelParameters(provider, model, configured, requested) {
  const fields = parameterCatalog[provider]?.[model] || []
  for (const [key, value] of Object.entries(normalizeModelParameters(provider, model, configured))) {
    const overridable = fields.find((field) => field.key === key)?.overridable
    if (requested[key] !== undefined && JSON.stringify(requested[key]) !== JSON.stringify(value) && !overridable) throw new Error(`参数 ${key} 必须与 project.json 已确认配置一致`)
    if (requested[key] === undefined || !overridable) requested[key] = value
  }
  return requested
}

export function providerSetupCatalog() {
  return Object.entries(adapters).map(([key, value]) => ({
    key, label: value.label || key, configured: Boolean(credential(value.credentialEnv)), credentialEnv: value.credentialEnv,
    capabilities: value.capabilities,
    models: Object.fromEntries(['image', 'video', 'audio', 'music'].map((type) => [type, (value.catalog?.[type] || []).map((id) => ({ id, promptProfile: type === 'video' ? /^MiniMax-H3|^minimax-h3/.test(id) ? 'h3' : /seedance-2-0/.test(id) ? 'seedance2' : 'generic' : null, parameters: parameterCatalog[key]?.[id] || [] }))])),
  }))
}

export async function testProviderConnection(name) {
  const selected = adapter(name)
  if (!selected.testConnection) throw new Error(`Provider 不支持连接测试：${name}`)
  await selected.testConnection()
}

export function selfCheck() {
  const krea = normalizeModelParameters('runninghub', 'krea2-normal-v1')
  if (krea.resolution !== '2K' || krea.aspect_ratio !== '4:3') throw new Error('模型参数默认值自检失败')
  try { normalizeModelParameters('runninghub', 'krea2-normal-v1', { resolution: '4K' }); throw new Error('模型参数边界自检失败') }
  catch (error) { if (!String(error.message).includes('选项无效')) throw error }
  const video = applyConfiguredModelParameters('comfly', 'minimax-h3', { duration: 8, resolution: '1K', ratio: '9:16' }, { duration: 12 })
  if (video.duration !== 12 || video.resolution !== '1K') throw new Error('逐镜头参数覆盖自检失败')
  try { applyConfiguredModelParameters('comfly', 'minimax-h3', { resolution: '1K' }, { resolution: '2K' }); throw new Error('项目级参数锁定自检失败') }
  catch (error) { if (!String(error.message).includes('已确认配置一致')) throw error }
}
