import test from 'node:test'
import assert from 'node:assert/strict'
import { validateAudioPlan } from './audio-plan-contract.mjs'

const reasons = ['provider-no-native-audio', 'voice-identity-drift', 'speech-intelligibility-failed', 'narration-performance-failed', 'audio-sync-failed', 'native-ambience-failed']
const performance = { tone_arc: '平静转警觉', emotion_beats: ['低声铺陈', '短停', '压低收束'], pace: '中慢', breath_and_pause: '转折停半拍', distance_and_space: '近讲' }
const generatedPerformance = { intent: '补足画外信息', subtext: '危险正在靠近', emotion_arc: [{ at: 0, emotion: '克制', intensity: 0.3 }, { at: 1, emotion: '警觉', intensity: 0.7 }], pace: '中慢', emphasis: ['危险'], pause_plan: [{ after: '危险', duration_ms: 100 }], breath: '起句前轻吸气', distance_and_space: '近讲' }
const contract = (lineIndex, text) => ({ mode: 'generated', timing_source: { episode_key: 'ep-001', version_id: 'v001', line_index: lineIndex, source_asset: { asset_key: 'shot-ep001-001', version_id: 'v001', sha256: 'a'.repeat(64) } }, target_range: { start_ms: (lineIndex - 1) * 1000, end_ms: lineIndex * 1000 }, target_speech_ms: 800, original_text: text, adapted_text: text, adaptation: null, performance: generatedPerformance, fit_policy: { max_paid_generations: 3, provider_speed_min: 0.85, provider_speed_max: 1.15, max_post_tempo_percent: 3, text_adaptation_allowed: true } })
const line = (lineIndex, speaker, presentation, voiceId, text) => ({ line_index: lineIndex, speaker, line_type: presentation === 'narration' ? 'voiceover' : 'dialogue', content: text, emotion: '警觉', emotion_strength: 0.3, pronunciation_notes: [], matched_shot: { shot_number: 1 }, delivery_mode: 'post_dub', presentation, fallback_mode: presentation === 'narration' ? 'cinematic-tts' : 'post-dub', source_audio: null, voice_binding: { voice_id: voiceId }, native_audio_exception: null, performance: presentation === 'narration' ? performance : null, dubbing_contract: contract(lineIndex, text) })
const plan = (voiceBindings) => ({ episode_key: 'ep-001', audio_strategy: { mode: 'native-first', provider_selection: 'prefer-native', fallback_allowed: true, fallback_reasons: reasons }, lines: [line(1, '林晚', 'offscreen-dialogue', 'linwan-clone', '快走。'), line(2, 'narrator', 'narration', 'narrator-pro', '风暴来了。')], voice_bindings: voiceBindings, unresolved: [], approved: true })
const validBindings = [
  { speaker: '林晚', provider: 'bailian', model: 'cosyvoice-v3.5-plus', target_model: 'cosyvoice-v3.5-plus', voice_id: 'linwan-clone', voice_role: 'character', source: 'clone', upload_receipt_id: 'upload-1' },
  { speaker: 'narrator', provider: 'bailian', model: 'cosyvoice-v3.5-plus', target_model: 'cosyvoice-v3.5-plus', voice_id: 'narrator-pro', voice_role: 'narrator', source: 'design', professional_narration: true, request_id: 'request-1', cinematic_profile: performance },
]

test('缺失场外音与专业旁白按 CosyVoice 路由并保留原声时间线', () => {
  assert.doesNotThrow(() => validateAudioPlan(plan(validBindings), 'ep-001'))
  assert.throws(() => validateAudioPlan(plan([{ ...validBindings[0], source: 'design' }, validBindings[1]]), 'ep-001'), /克隆原声角色音色/)
  assert.throws(() => validateAudioPlan(plan([validBindings[0], { ...validBindings[1], professional_narration: false }]), 'ep-001'), /专业旁白设计音色/)
  assert.throws(() => validateAudioPlan(plan([{ ...validBindings[0], model: 'cosyvoice-v2' }, validBindings[1]]), 'ep-001'), /CosyVoice v3.5 Plus/)
})
