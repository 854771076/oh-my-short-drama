import test from 'node:test'
import assert from 'node:assert/strict'
import { compileGeneratedAudioArguments } from './generation/mcp.mjs'

const contract = {
  mode: 'generated',
  timing_source: { episode_key: 'ep-001', version_id: 'v002', line_index: 1, source_asset: { asset_key: 'shot-ep001-001', version_id: 'v001', sha256: 'a'.repeat(64) } },
  target_range: { start_ms: 0, end_ms: 900 }, target_speech_ms: 770,
  original_text: '别回头。', adapted_text: '别回头。', adaptation: null,
  performance: { intent: '阻止对方看见危险', subtext: '不能让对方察觉', emotion_arc: [{ at: 0, emotion: '警觉', intensity: 0.1234 }], pace: '短促', emphasis: ['别'], pause_plan: [{ after: '别', duration_ms: 70 }], breath: '轻吸气', distance_and_space: '近距离' },
  fit_policy: { max_paid_generations: 3, provider_speed_min: 0.85, provider_speed_max: 1.15, max_post_tempo_percent: 3, text_adaptation_allowed: true },
}

test('生成入口从当前 audio-plan 派生合同版本、voice binding 和授权列表', () => {
  const line = { line_index: 1, voice_binding: { voice_id: 'linwan' }, dubbing_contract: contract }
  const audioPlan = { voice_bindings: [{ voice_id: 'linwan' }] }
  const result = compileGeneratedAudioArguments({
    providerArgs: { provider: 'bailian', model: 'cosyvoice-v3.5-plus', voice: 'linwan', input: '别回头。', confirmed: true, dubbing_attempt: 2, measured_speech_ms: 700 },
    line, audioPlan, audioPlanVersion: 'v003',
  })
  assert.equal(result.compiled.snapshot.contract_version, 'v003')
  assert.equal(result.arguments.instruction.includes('0|警觉|0.1234'), true)
  assert.equal('dubbing_attempt' in result.arguments, false)
  assert.equal('measured_speech_ms' in result.arguments, false)
})
