import test from 'node:test'
import assert from 'node:assert/strict'
import { assessWordAlignment } from './dubbing-live-acceptance.mjs'

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
