import test from 'node:test'
import assert from 'node:assert/strict'
import { auditNativeAudio, validateNativeAudioReview } from './native-audio-audit.mjs'

test('文件存在和响度合格不能代替电影感旁白复听', () => {
  assert.throws(() => validateNativeAudioReview({ approved: true, dimensions: { technical_audio: { passed: true, observation: '响度合格' } } }), /narration_performance/)
})

test('七个维度全部通过且完整观看才可批准原生音频', async () => {
  const manual = Object.fromEntries(['speaker_identity', 'narration_performance', 'ambience_action_sync', 'lip_sync', 'technical_audio', 'undeclared_music'].map((key) => [key, { passed: true, observation: `${key} 已人工复听` }]))
  const report = await auditNativeAudio({ comparisons: [{ passed: true }], asr_observation: '逐字文本、说话人与起点一致', manual, full_range: { start_ms: 0, end_ms: 3000 }, watched_full: true })
  assert.equal(report.approved, true)
  assert.doesNotThrow(() => validateNativeAudioReview(report))
})
