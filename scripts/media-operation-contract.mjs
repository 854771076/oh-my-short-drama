export const MEDIA_OPERATIONS = new Set(['trim', 'replace-audio', 'stabilize', 'denoise', 'color-match', 'mask-blur', 'frame-interpolate', 'lip-sync', 'video-inpaint', 'video-upscale'])

const CAPABILITIES = {
  'lip-sync': 'transform.lip-sync',
  'video-inpaint': 'transform.video-inpaint',
  'video-upscale': 'transform.video-upscale',
}

const RANGED_OPERATIONS = new Set(['trim', 'replace-audio', 'mask-blur', 'lip-sync', 'video-inpaint'])
const MASKED_OPERATIONS = new Set(['mask-blur', 'video-inpaint'])
const AUDIO_OPERATIONS = new Set(['replace-audio', 'lip-sync'])

function assetReference(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.asset_key || '') || !/^v\d{3}$/.test(value.version_id || '')) throw new Error(`${label}必须绑定有效资产版本`)
}

function validRange(value) {
  return value && Number.isInteger(value.start_ms) && Number.isInteger(value.end_ms) && value.start_ms >= 0 && value.end_ms > value.start_ms
}

export function operationCapability(operation) {
  if (!MEDIA_OPERATIONS.has(operation)) throw new Error('媒体操作类型无效')
  return CAPABILITIES[operation] || 'transform.local'
}

export function validateMediaOperation(value) {
  if (!MEDIA_OPERATIONS.has(value?.operation)) throw new Error('媒体操作类型无效')
  assetReference(value.source, '媒体操作来源')
  if (!value.parameters || typeof value.parameters !== 'object' || Array.isArray(value.parameters)) throw new Error('媒体操作 parameters 必须是对象')
  if (RANGED_OPERATIONS.has(value.operation) && !validRange(value.range)) throw new Error('局部媒体操作必须提供有效时间范围')
  if (value.range !== undefined && !validRange(value.range)) throw new Error('媒体操作时间范围无效')
  if (MASKED_OPERATIONS.has(value.operation)) assetReference(value.mask, '遮罩媒体操作')
  if (AUDIO_OPERATIONS.has(value.operation)) assetReference(value.audio, '媒体操作音频')
  return structuredClone(value)
}
