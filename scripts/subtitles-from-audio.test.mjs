import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSubtitlesFromAudio } from './subtitles-from-audio.mjs'

const AUDIO_SHA = 'a'.repeat(64)
const contract = (lineIndex, start, end, text) => ({ line_index: lineIndex, text, speaker: lineIndex === 1 ? '林晚' : '周潜', dubbing_contract_version: 'v003', dubbing_contract: { target_range: { start_ms: start, end_ms: end } } })

test('字幕从最终词级边界扩展且不越过相邻台词', () => {
  const captions = buildSubtitlesFromAudio({
    audio: { asset_key: 'audio-ep001-dialogue', version_id: 'v002', sha256: AUDIO_SHA },
    timing: { version_id: 'v004', lines: [
      { line_index: 1, start_ms: 200, end_ms: 1000, confidence: 0.99, words: [{ text: '别', start_ms: 200, end_ms: 400 }, { text: '回头', start_ms: 500, end_ms: 1000 }] },
      { line_index: 2, start_ms: 1020, end_ms: 1800, confidence: 0.98, words: [{ text: '快走', start_ms: 1020, end_ms: 1800 }] },
    ] },
    contracts: [contract(1, 0, 1400, '别回头'), contract(2, 900, 2000, '快走')],
    fps: 24,
    timeline_end_ms: 2200,
  })
  assert.equal(captions[0].endMs, 1020)
  assert.equal(captions[1].startMs, 1020)
  assert.equal(captions[0].audio_binding.sha256, AUDIO_SHA)
  assert.equal(captions[0].audio_binding.speech_timing_version, 'v004')
  assert.equal(captions[0].audio_binding.dubbing_contract_version, 'v003')
})

test('阅读速度不足时逐行返回错误且不擅自重切时间', () => {
  const [caption] = buildSubtitlesFromAudio({
    audio: { asset_key: 'audio-ep001-dialogue', version_id: 'v002', sha256: AUDIO_SHA },
    timing: { version_id: 'v004', lines: [{ line_index: 1, start_ms: 0, end_ms: 300, words: [{ text: '太快', start_ms: 0, end_ms: 300 }] }] },
    contracts: [contract(1, 0, 300, '这一句台词长得根本不可能在这么短时间内读完')],
    fps: 24,
    timeline_end_ms: 300,
  })
  assert.deepEqual(caption.errors.map((item) => item.code).sort(), ['cps_too_high', 'dwell_too_short'])
  assert.equal(caption.startMs, 0)
  assert.equal(caption.endMs, 300)
})
