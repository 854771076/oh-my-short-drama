import test from 'node:test'
import assert from 'node:assert/strict'
import { assessWordAlignment, mapSourceTimingLineToTimeline, validateAcceptanceMedia } from './dubbing-live-acceptance.mjs'

test('验收会拒绝文字相同但整体偏移 9000ms 的最终对齐', () => {
  const result = assessWordAlignment(
    { words: [{ text: '别回头', start_ms: 100, end_ms: 900 }] },
    { words: [{ text: '别回头', start_ms: 9100, end_ms: 9900 }] },
    42,
  )
  assert.equal(result.status, 'out-of-tolerance')
  assert.equal(result.max_error_ms, 9000)
})

test('验收会在对齐证据缺失时失败关闭', () => {
  assert.deepEqual(assessWordAlignment({ words: [{ text: '别', start_ms: 0, end_ms: 200 }] }, null, 42), { status: 'missing', max_error_ms: null, items: [] })
})

test('源词时间按行级映射换算到剧集时间线域', () => {
  assert.deepEqual(mapSourceTimingLineToTimeline({
    line_index: 1,
    start_ms: 1100,
    end_ms: 1900,
    timeline_mapping: { source_in_ms: 1000, timeline_at_ms: 5000 },
    words: [{ text: '别', start_ms: 1100, end_ms: 1300 }, { text: '回头', start_ms: 1400, end_ms: 1900 }],
  }), {
    line_index: 1,
    start_ms: 5100,
    end_ms: 5900,
    words: [{ text: '别', start_ms: 5100, end_ms: 5300 }, { text: '回头', start_ms: 5400, end_ms: 5900 }],
  })
})

test('验收拒绝没有原声音轨的视频', () => {
  assert.throws(() => validateAcceptanceMedia({ has_video: true, has_audio: false }, { has_audio: true }), /原声音轨/)
})
