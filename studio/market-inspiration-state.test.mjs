import test from 'node:test'
import assert from 'node:assert/strict'
import { acceptMarketGeneration, beginMarketGeneration, resetMarketInspiration, selectMarketCandidate, toggleMarketInspirationTopic } from './market-inspiration-state.js'

test('灵感板状态限制三选、选择候选、周期切换并丢弃过期生成结果', () => {
  let topics = []
  for (const topic of ['悬疑', '甜宠', '都市']) topics = toggleMarketInspirationTopic(topics, topic).topics
  assert.deepEqual(toggleMarketInspirationTopic(topics, '古装'), { topics, limited: true })
  assert.deepEqual(selectMarketCandidate('hyp-1'), 'hyp-1')
  const state = { marketInspirationTopics: ['悬疑'], marketCandidates: [{ id: 'hyp-1' }], selectedMarketCandidate: 'hyp-1', marketInspirationBusy: true }
  Object.assign(state, resetMarketInspiration())
  assert.deepEqual(state, { marketInspirationTopics: [], marketCandidates: [], selectedMarketCandidate: null, marketInspirationBusy: false })
  const first = beginMarketGeneration(0), second = beginMarketGeneration(first)
  assert.equal(acceptMarketGeneration(first, second), false)
  assert.equal(acceptMarketGeneration(second, second), true)
})

test('题材或周期切换会清空真实候选状态，并让旧生成响应失效且不保持忙碌', () => {
  const state = { marketInspirationTopics: ['悬疑'], marketCandidates: [{ id: 'old' }], selectedMarketCandidate: 'old', marketInspirationBusy: true, marketInspirationRequest: 4 }
  const requestId = state.marketInspirationRequest
  Object.assign(state, resetMarketInspiration())
  state.marketInspirationTopics = ['甜宠']
  state.marketInspirationRequest = beginMarketGeneration(state.marketInspirationRequest)
  assert.deepEqual(state, { marketInspirationTopics: ['甜宠'], marketCandidates: [], selectedMarketCandidate: null, marketInspirationBusy: false, marketInspirationRequest: 5 })
  assert.equal(acceptMarketGeneration(requestId, state.marketInspirationRequest), false)
})
