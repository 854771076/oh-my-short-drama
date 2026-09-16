export const toggleMarketInspirationTopic = (topics, topic, maximum = 3) => {
  if (topics.includes(topic)) return { topics: topics.filter((value) => value !== topic), limited: false }
  if (topics.length >= maximum) return { topics, limited: true }
  return { topics: [...topics, topic], limited: false }
}

export const selectMarketCandidate = (candidateId) => candidateId
export const resetMarketInspiration = () => ({ topics: [], candidates: [], selectedCandidate: null })
export const beginMarketGeneration = (requestId) => requestId + 1
export const acceptMarketGeneration = (requestId, currentRequestId) => requestId === currentRequestId
