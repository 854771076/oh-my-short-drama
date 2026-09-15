import test from 'node:test'
import assert from 'node:assert/strict'
import { migrateLegacyAudioLine, validateAudioLine, validateAudioPlan, validateAudioStrategy } from './audio-plan-contract.mjs'

const reasons = ['provider-no-native-audio', 'voice-identity-drift', 'speech-intelligibility-failed', 'narration-performance-failed', 'audio-sync-failed', 'native-ambience-failed']
const strategy = { mode: 'native-first', provider_selection: 'prefer-native', fallback_allowed: true, fallback_reasons: reasons }
const base = { line_index: 1, speaker: '林晚', line_type: 'dialogue', content: '别回头。', emotion: '克制紧张', emotion_strength: 0.3, pronunciation_notes: [], matched_shot: { shot_number: 1 }, delivery_mode: 'native', presentation: 'visible-dialogue', fallback_mode: 'post-dub', source_audio: null, voice_binding: null, native_audio_exception: null, performance: null }

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
