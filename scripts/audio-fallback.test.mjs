import test from 'node:test'
import assert from 'node:assert/strict'
import { planAudioFallback } from './audio-fallback.mjs'

test('只替换失败区间并保留合格原生环境声', () => {
  const report = { full_range: { start_ms: 0, end_ms: 5000 }, dimensions: { speech_intelligibility: { passed: false, observation: '第 1 句无法辨认', ranges: [{ start_ms: 1000, end_ms: 2500 }] }, ambience_action_sync: { passed: true, observation: '环境与动作声同步' } } }
  const dialogue = { line_index: 1, range: { start_ms: 800, end_ms: 2600 } }
  const plan = planAudioFallback(report, [dialogue])
  assert.deepEqual(plan.replacements[0].range, { start_ms: 1000, end_ms: 2500 })
  assert.equal(plan.replacements[0].reason, 'speech-intelligibility-failed')
  assert.equal(plan.preserved_ranges[0].kind, 'native-ambience-action')
})

test('不得为已通过维度规划替换', () => {
  const report = { full_range: { start_ms: 0, end_ms: 5000 }, dimensions: { speech_intelligibility: { passed: true, observation: '清晰', ranges: [{ start_ms: 0, end_ms: 5000 }] }, ambience_action_sync: { passed: true, observation: '同步' } } }
  assert.equal(planAudioFallback(report, []).replacements.length, 0)
})
