import test from 'node:test'
import assert from 'node:assert/strict'
import { operationCapability, validateMediaOperation } from './media-operation-contract.mjs'
import { providerSupports } from './generation/providers.mjs'

test('超分映射到细粒度 Provider 能力', () => {
  assert.equal(operationCapability('video-upscale'), 'transform.video-upscale')
  assert.equal(operationCapability('denoise'), 'transform.local')
})

test('局部遮罩操作缺少范围和遮罩时拒绝', () => {
  const base = { operation: 'mask-blur', source: { asset_key: 'shot-ep001-001', version_id: 'v001' }, parameters: {} }
  assert.throws(() => validateMediaOperation(base), /时间范围/)
  assert.throws(() => validateMediaOperation({ ...base, range: { start_ms: 0, end_ms: 1000 } }), /遮罩/)
})

test('对口型和替换音轨必须绑定版本化音频', () => {
  const base = { operation: 'lip-sync', source: { asset_key: 'shot-ep001-001', version_id: 'v001' }, range: { start_ms: 0, end_ms: 1000 }, parameters: { audio_plan: { episode_key: 'ep-001', version_id: 'v001', line_index: 1 }, face_selector: { mode: 'single-visible-face', character_key: 'char-linwan' } } }
  assert.throws(() => validateMediaOperation(base), /音频/)
  assert.doesNotThrow(() => validateMediaOperation({ ...base, audio: { asset_key: 'audio-ep001-line-001', version_id: 'v001' } }))
  assert.throws(() => validateMediaOperation({ ...base, audio: { asset_key: 'audio-ep001-line-001', version_id: 'v001' }, parameters: { ...base.parameters, face_selector: { mode: 'multiple' } } }), /唯一可见人脸/)
})

test('旧 video 布尔能力不能冒充 upscale', () => {
  assert.equal(providerSupports('starrouter', 'transform.video-upscale'), false)
  assert.equal(providerSupports('starrouter', 'video'), true)
})
