import test from 'node:test'
import assert from 'node:assert/strict'
import { acceptMarketGeneration, beginMarketGeneration, resetMarketInspiration, selectMarketCandidate, toggleMarketInspirationTopic } from './market-inspiration-state.js'

test('灵感板状态限制三选、选择候选、周期切换并丢弃过期生成结果', () => {
  let topics = []
  for (const topic of ['悬疑', '甜宠', '都市']) topics = toggleMarketInspirationTopic(topics, topic).topics
  assert.deepEqual(toggleMarketInspirationTopic(topics, '古装'), { topics, limited: true })
  assert.deepEqual(selectMarketCandidate('hyp-1'), 'hyp-1')
  assert.deepEqual(resetMarketInspiration(), { topics: [], candidates: [], selectedCandidate: null })
  const first = beginMarketGeneration(0), second = beginMarketGeneration(first)
  assert.equal(acceptMarketGeneration(first, second), false)
  assert.equal(acceptMarketGeneration(second, second), true)
})
