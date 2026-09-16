import test from 'node:test'
import assert from 'node:assert/strict'
import { compileAudioPolicy, selectVideoProviderForAudio } from './audio-prompt-policy.mjs'

const nativeFirst = { mode: 'native-first', provider_selection: 'prefer-native', fallback_allowed: true }
const candidates = [
  { provider: 'visual-only', model: 'visual-v1', capabilities: { 'video.reference-image': true, 'video.native-audio': false } },
  { provider: 'runninghub', model: 'minimax-h3-reference-to-video', capabilities: { 'video.reference-image': true, 'video.native-audio': true } },
]

test('视觉约束相同且允许自动选择时优先原生音频 Provider', () => {
  assert.deepEqual(selectVideoProviderForAudio({ visualCapabilities: ['video.reference-image'], audioStrategy: nativeFirst, candidates }), { provider: 'runninghub', model: 'minimax-h3-reference-to-video', native_audio: true, reasons: ['video.native-audio'] })
})

test('用户锁定不支持原生音频的 Provider 时返回可审计异常而非静默 TTS', () => {
  const result = selectVideoProviderForAudio({ requestedProvider: 'visual-only', visualCapabilities: ['video.reference-image'], audioStrategy: nativeFirst, candidates })
  assert.equal(result.reasons[0], 'provider-no-native-audio')
})

test('旁白提示词必须逐项包含电影感表演节拍', () => {
  const narrationShot = { audio_policy: { audio_strategy: { ...nativeFirst, fallback_reasons: ['provider-no-native-audio', 'voice-identity-drift', 'speech-intelligibility-failed', 'narration-performance-failed', 'audio-sync-failed', 'native-ambience-failed'] }, lines: [{ line_index: 1, speaker: 'narrator', content: '风暴终于来了。', delivery_mode: 'native', presentation: 'narration', fallback_mode: 'cinematic-tts', source_audio: null, voice_binding: null, native_audio_exception: null, range: { start_ms: 500, end_ms: 2500 }, performance: { tone_arc: '平静转警觉', emotion_beats: ['低声铺陈', '短停', '压低收束'], pace: '中慢速', breath_and_pause: '转折前吸气并停半拍', distance_and_space: '贴近镜头的近讲，轻微室内反射' }, dubbing_contract: { mode: 'native-preserve', timing_source: { episode_key: 'ep-001', version_id: 'v001', line_index: 1, source_asset: { asset_key: 'shot-ep001-001', version_id: 'v001', sha256: 'a'.repeat(64) } }, target_range: { start_ms: 500, end_ms: 2500 }, performance_reference: { intent: '预示风暴来临', subtext: '危险已经逼近', emotion_arc: [{ at: 0, emotion: '平静', intensity: 0.3 }, { at: 1, emotion: '警觉', intensity: 0.7 }], emphasis: ['风暴'], pause_plan: [{ after: '风暴', duration_ms: 120 }], breath: '转折前轻吸气' } } }], ambience: [{ range: { start_ms: 0, end_ms: 3000 }, sound: '远处雷声渐近' }], action_sounds: [], no_undeclared_bgm: true } }
  const prompt = compileAudioPolicy(narrationShot)
  for (const token of ['tone arc', 'emotion beats', 'pace', 'breath and pause', 'distance and space', 'no undeclared BGM']) assert.match(prompt, new RegExp(token, 'i'))
})
