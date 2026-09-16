import test from 'node:test'
import assert from 'node:assert/strict'
import { migrateLegacyAudioLine, migrateLegacyAudioPlan, validateAudioLine, validateAudioPlan, validateAudioStrategy } from './audio-plan-contract.mjs'

const reasons = ['provider-no-native-audio', 'voice-identity-drift', 'speech-intelligibility-failed', 'narration-performance-failed', 'audio-sync-failed', 'native-ambience-failed']
const strategy = { mode: 'native-first', provider_selection: 'prefer-native', fallback_allowed: true, fallback_reasons: reasons }
const timingSource = { episode_key: 'ep-001', version_id: 'v001', line_index: 1, source_asset: { asset_key: 'shot-ep001-001', version_id: 'v001', sha256: 'a'.repeat(64) } }
const targetRange = { start_ms: 0, end_ms: 1000 }
const performance = { intent: '阻止对方看见身后的危险', subtext: '她害怕，但不能让对方察觉', emotion_arc: [{ at: 0, emotion: '克制警觉', intensity: 0.45 }, { at: 1, emotion: '压低的急迫', intensity: 0.72 }], pace: '短促但不抢字', emphasis: ['别'], pause_plan: [{ after: '别', duration_ms: 70 }], breath: '起句前轻吸气，句尾不泄气', distance_and_space: '近距离低声' }
const fit = { max_paid_generations: 3, provider_speed_min: 0.85, provider_speed_max: 1.15, max_post_tempo_percent: 3, text_adaptation_allowed: true }
const nativeContract = { mode: 'native-preserve', timing_source: timingSource, target_range: targetRange, performance_reference: { intent: performance.intent, subtext: performance.subtext, emotion_arc: performance.emotion_arc, emphasis: performance.emphasis, pause_plan: performance.pause_plan, breath: performance.breath } }
const generatedContract = { mode: 'generated', timing_source: timingSource, target_range: targetRange, target_speech_ms: 800, original_text: '别回头。', adapted_text: '别回头。', adaptation: null, performance, fit_policy: fit }
const base = { line_index: 1, speaker: '林晚', line_type: 'dialogue', content: '别回头。', emotion: '克制紧张', emotion_strength: 0.3, pronunciation_notes: [], matched_shot: { shot_number: 1 }, delivery_mode: 'native', presentation: 'visible-dialogue', fallback_mode: 'post-dub', source_audio: null, voice_binding: null, native_audio_exception: null, performance: null, dubbing_contract: nativeContract }
const postDub = { ...base, delivery_mode: 'post_dub', source_audio: null, voice_binding: { voice_id: 'linwan' }, dubbing_contract: generatedContract }

test('native-first 策略列出全部受控失败原因', () => {
  assert.doesNotThrow(() => validateAudioStrategy(strategy))
  assert.throws(() => validateAudioStrategy({ ...strategy, fallback_reasons: reasons.slice(1) }), /fallback_reasons/)
})

test('来源和画面呈现不允许混用', () => {
  assert.throws(() => validateAudioLine({ ...base, delivery_mode: 'narration' }, 0), /delivery_mode/)
  assert.throws(() => validateAudioLine({ ...base, presentation: 'native' }, 0), /presentation/)
})

test('电影感旁白必须有可执行表演合同', () => {
  assert.throws(() => validateAudioLine({ ...base, speaker: 'narrator', line_type: 'voiceover', presentation: 'narration', performance: null }, 0), /旁白.*表演合同/)
})

test('保留原声合同不得混入生成字段', () => {
  assert.throws(() => validateAudioLine({ ...base, dubbing_contract: { ...nativeContract, adapted_text: '别走' } }), /native-preserve/)
})

test('生成合同必须包含完整表演与三次总生成上限', () => {
  assert.throws(() => validateAudioLine({ ...postDub, dubbing_contract: { ...generatedContract, performance: { ...performance, subtext: '' } } }), /subtext/)
  assert.throws(() => validateAudioLine({ ...postDub, dubbing_contract: { ...generatedContract, fit_policy: { ...fit, max_paid_generations: 4 } } }), /max_paid_generations/)
})

test('旧 post_dub 缺合同时迁移为 unresolved', () => {
  const legacy = { episode_key: 'ep-001', audio_strategy: strategy, lines: [{ ...postDub, dubbing_contract: undefined }], unresolved: [], approved: true }
  delete legacy.lines[0].dubbing_contract
  const migrated = migrateLegacyAudioPlan(legacy)
  assert.match(migrated.unresolved.join('\n'), /配音合同与时间证据/)
  assert.equal(migrated.document.approved, false)
})

test('不完整但真值的旧 post_dub 合同仍须迁移为 unresolved', () => {
  const legacy = { episode_key: 'ep-001', audio_strategy: strategy, lines: [{ ...postDub, dubbing_contract: { mode: 'generated' } }], unresolved: [], approved: true }
  const migrated = migrateLegacyAudioPlan(legacy)
  assert.equal(migrated.document.lines[0].dubbing_contract, null)
  assert.match(migrated.unresolved.join('\n'), /配音合同与时间证据/)
  assert.equal(migrated.document.approved, false)
})

test('不完整但真值的旧 external_audio 合同不得推断生成字段', () => {
  const external = { ...postDub, delivery_mode: 'external_audio', source_audio: { asset_key: 'audio-ep001-line-001', version_id: 'v001' }, dubbing_contract: { mode: 'generated' } }
  const migrated = migrateLegacyAudioPlan({ episode_key: 'ep-001', audio_strategy: strategy, lines: [external], unresolved: [], approved: true })
  assert.equal(migrated.document.lines[0].dubbing_contract, null)
  assert.deepEqual(migrated.document.lines[0].source_audio, external.source_audio)
  assert.equal(migrated.document.approved, false)
})

test('旧 narration 只迁移呈现方式并留下来源未决项', () => {
  const migrated = migrateLegacyAudioLine({ ...base, delivery_mode: 'narration' })
  assert.equal(migrated.line.presentation, 'narration')
  assert.equal(migrated.line.delivery_mode, null)
  assert.match(migrated.unresolved[0], /声音来源/)
})

test('新声音计划批准前必须使用三层合同且无未决项', () => {
  const performance = { tone_arc: '克制转坚定', emotion_beats: ['压低', '停顿', '坚定收束'], pace: '中慢速', breath_and_pause: '关键词前短停，尾句留一拍呼吸', distance_and_space: '近距离干声，轻微室内反射' }
  assert.doesNotThrow(() => validateAudioPlan({ episode_key: 'ep-001', audio_strategy: strategy, lines: [{ ...base, speaker: 'narrator', line_type: 'voiceover', presentation: 'narration', performance }], unresolved: [], approved: true }, 'ep-001'))
  assert.throws(() => validateAudioPlan({ episode_key: 'ep-001', audio_strategy: strategy, lines: [base], unresolved: ['音色待确认'], approved: true }, 'ep-001'), /未决项/)
})
