export const toggleMarketInspirationTopic = (topics, topic, maximum = 3) => {
  if (topics.includes(topic)) return { topics: topics.filter((value) => value !== topic), limited: false }
  if (topics.length >= maximum) return { topics, limited: true }
  return { topics: [...topics, topic], limited: false }
}

export const selectMarketCandidate = (candidateId) => candidateId
// 切换报告周期或题材时，必须同步取消页面的生成态，避免已失效请求的 finally 留下永久忙碌状态。
export const resetMarketInspiration = () => ({
  marketInspirationTopics: [],
  marketCandidates: [],
  selectedMarketCandidate: null,
  marketInspirationBusy: false,
})
export const beginMarketGeneration = (requestId) => requestId + 1
export const acceptMarketGeneration = (requestId, currentRequestId) => requestId === currentRequestId
