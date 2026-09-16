import { createHash } from 'node:crypto'

const ALL_RANKING_TYPES = Object.freeze(['hot', 'motion', 'motion-ai', 'motion-comedy', 'douyin', 'kuaishou', 'hongguo', 'income'])
const PERSISTENCE_CAP_DAYS = 30

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === 'string' && value))]
}

function compareText(left, right) {
  return String(left).localeCompare(String(right), 'zh-Hans-CN')
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value))
}

function average(values, fallback = 0) {
  const usable = values.filter((value) => finiteNumber(value) !== null)
  return usable.length === 0 ? fallback : usable.reduce((sum, value) => sum + value, 0) / usable.length
}

function topicsOf(item) {
  const topics = uniqueStrings(item?.topics)
  return topics.length > 0 ? topics : ['未分类']
}

function keyOf(item, index = 0) {
  // 平台会为同一 playletId 生成不同的观测 key；分析层优先使用稳定的作品 ID，避免把同剧重复计入供给或公司份额。
  if (item?.playletId !== null && item?.playletId !== undefined && typeof item.playletId !== 'object' && String(item.playletId)) return `playlet-id:${item.playletId}`
  if (typeof item?.key === 'string' && item.key) return item.key
  if (typeof item?.key === 'number' && Number.isFinite(item.key)) return String(item.key)
  return `observation:${index}`
}

function itemSort(left, right) {
  const leftRank = finiteNumber(left.item.ranking) ?? Number.POSITIVE_INFINITY
  const rightRank = finiteNumber(right.item.ranking) ?? Number.POSITIVE_INFINITY
  return leftRank - rightRank || compareText(left.key, right.key) || left.index - right.index
}

function dedupeObservations(items) {
  const selected = new Map()
  for (const [index, item] of (Array.isArray(items) ? items : []).entries()) {
    if (!isRecord(item)) continue
    const key = keyOf(item, index)
    const rankingType = typeof item.rankingType === 'string' ? item.rankingType : ''
    const observationKey = `${key}\u0000${rankingType}`
    const candidate = { item, key, index }
    const current = selected.get(observationKey)
    if (!current || itemSort(candidate, current) < 0) selected.set(observationKey, candidate)
  }
  return [...selected.values()]
}

function evidenceReference(item, key, fallbackSnapshotId = null) {
  return {
    snapshot_id: item?.snapshotId ?? item?.snapshot_id ?? fallbackSnapshotId,
    ranking_type: typeof item?.rankingType === 'string' ? item.rankingType : '',
    playlet_id: item?.playletId ?? key,
    key,
  }
}

function evidenceSort(left, right) {
  return compareText(left.ranking_type, right.ranking_type)
    || compareText(left.key, right.key)
    || compareText(left.snapshot_id, right.snapshot_id)
}

function percentilesByRankingType(entries, field) {
  const result = new Map()
  const groups = new Map()
  for (const entry of entries) {
    const rankingType = typeof entry.item.rankingType === 'string' ? entry.item.rankingType : ''
    if (!groups.has(rankingType)) groups.set(rankingType, [])
    groups.get(rankingType).push(entry)
  }
  for (const group of groups.values()) {
    const values = group.map((entry) => field === 'ranking'
      ? (finiteNumber(entry.item.ranking) === null ? null : -entry.item.ranking)
      : finiteNumber(entry.item[field]))
    const ranks = percentileRanks(values)
    for (const [index, entry] of group.entries()) result.set(entry, ranks[index])
  }
  return result
}

function sourceTagRatio(entries) {
  if (entries.length === 0) return 0
  return entries.filter(({ item }) => item?.provenance?.topicSource === 'source-tag').length / entries.length
}

function confidenceFor({ supplyCount, platformCoverage, sourceRatio }) {
  if (supplyCount >= 5 && platformCoverage >= 0.6 && sourceRatio >= 0.8) return 'high'
  if (supplyCount >= 2 && platformCoverage >= 0.3 && sourceRatio >= 0.5) return 'medium'
  return 'low'
}

function normalizedCompanies(value) {
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  if (Array.isArray(value)) return uniqueStrings(value.flatMap((entry) => normalizedCompanies(entry)))
  if (!isRecord(value)) return []
  return uniqueStrings(Object.values(value).flatMap((entry) => normalizedCompanies(entry)))
}

function filterValues(value) {
  if (value === undefined || value === null || value === '') return []
  return Array.isArray(value) ? value.filter((entry) => entry !== null && entry !== undefined).map(String) : [String(value)]
}

function matchesFilter(item, filters) {
  const matchOne = (field) => {
    const expected = filterValues(filters[field])
    return expected.length === 0 || expected.includes(String(item?.[field] ?? ''))
  }
  const expectedTopics = filterValues(filters.topic)
  const topicMatches = expectedTopics.length === 0 || topicsOf(item).some((topic) => expectedTopics.includes(topic))
  const expectedRankingTypes = filterValues(filters.rankingTypes)
  const rankingMatches = expectedRankingTypes.length === 0 || expectedRankingTypes.includes(String(item?.rankingType ?? ''))
  return matchOne('audience') && matchOne('era') && matchOne('format') && topicMatches && rankingMatches
}

function appliedFilters(filters) {
  const result = {}
  for (const field of ['audience', 'era', 'format', 'topic', 'rankingTypes']) {
    if (filters?.[field] !== undefined) result[field] = Array.isArray(filters[field]) ? [...filters[field]].sort(compareText) : filters[field]
  }
  return result
}

function deterministicGeneratedAt(items, filters) {
  const explicit = filters?.generatedAt ?? filters?.now ?? filters?.context?.now
  if (explicit !== undefined && explicit !== null && String(explicit)) return String(explicit)
  const observed = (Array.isArray(items) ? items : [])
    .map((item) => typeof item?.observedAt === 'string' ? item.observedAt : null)
    .filter(Boolean)
    .sort()
  return observed.at(-1) ?? '1970-01-01T00:00:00.000Z'
}

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => stableSerialize(entry)).join(',')}]`
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`
  if (value === undefined) return 'null'
  return JSON.stringify(value)
}

function deterministicReportId(payload) {
  // 报告文件以 ID 为存储键，因此摘要完整规范化 payload（不含 report_id），避免趋势或筛选变化被旧报告覆盖。
  const digest = createHash('sha256').update(stableSerialize(payload)).digest('hex').slice(0, 16)
  return `market-report-${digest}`
}

/**
 * 将有限数值映射到 0..1；并列取平均名次，单项或全并列取中性 0.5，非法值保持 null。
 */
export function percentileRanks(values) {
  const source = Array.isArray(values) ? values : []
  const result = source.map(() => null)
  const valid = source.flatMap((value, index) => finiteNumber(value) === null ? [] : [{ value, index }])
  if (valid.length === 0) return result
  const distinct = [...new Set(valid.map(({ value }) => value))].sort((left, right) => left - right)
  if (distinct.length === 1) {
    for (const { index } of valid) result[index] = 0.5
    return result
  }
  const sorted = [...valid].sort((left, right) => left.value - right.value || left.index - right.index)
  const positions = new Map()
  for (let start = 0; start < sorted.length;) {
    let end = start + 1
    while (end < sorted.length && sorted[end].value === sorted[start].value) end += 1
    positions.set(sorted[start].value, ((start + end - 1) / 2) / (sorted.length - 1))
    start = end
  }
  for (const { value, index } of valid) result[index] = positions.get(value)
  return result
}

/**
 * 题材指标以作品 key 去重供给，但热度、增长和名次始终先在各榜内标准化，避免不同榜的原始值相加。
 */
export function topicMetrics(items, successfulRankingTypes) {
  const observations = dedupeObservations(items)
  const successful = uniqueStrings(successfulRankingTypes)
  const rankPercentiles = percentilesByRankingType(observations, 'ranking')
  const demandPercentiles = percentilesByRankingType(observations, 'heatValue')
  const growthPercentiles = percentilesByRankingType(observations, 'growthValue')
  const allKeys = new Set(observations.map(({ key }) => key))
  const grouped = new Map()
  for (const entry of observations) {
    for (const topic of topicsOf(entry.item)) {
      if (!grouped.has(topic)) grouped.set(topic, [])
      grouped.get(topic).push(entry)
    }
  }
  return [...grouped.entries()].map(([topic, entries]) => {
    const works = new Map()
    for (const entry of entries) if (!works.has(entry.key)) works.set(entry.key, entry)
    const supplyCount = works.size
    const coveredTypes = new Set(entries.map(({ item }) => item.rankingType).filter(Boolean))
    const platformCoverage = successful.length === 0 ? 0 : clamp(coveredTypes.size / successful.length)
    const demandStrength = average(entries.map((entry) => demandPercentiles.get(entry) ?? 0))
    const growthStrength = average(entries.map((entry) => growthPercentiles.get(entry) ?? 0))
    const rankStrength = average(entries.map((entry) => rankPercentiles.get(entry) ?? 0))
    const newTitleRate = supplyCount === 0 ? 0 : [...works.keys()].filter((key) => entries.some((entry) => entry.key === key && entry.item.isNew === true)).length / supplyCount
    const persistenceStrength = average(entries.map(({ item }) => {
      const days = finiteNumber(item.persistenceDays)
      return days === null ? 0 : clamp(days / PERSISTENCE_CAP_DAYS)
    }))
    const crowding = allKeys.size === 0 ? 0 : clamp(supplyCount / allKeys.size)
    const opportunityScore = Number((100 * clamp(
      0.28 * demandStrength
      + 0.22 * growthStrength
      + 0.16 * newTitleRate
      + 0.18 * platformCoverage
      + 0.16 * persistenceStrength
      - 0.20 * crowding,
    )).toFixed(12))
    const sourceRatio = sourceTagRatio(entries)
    return {
      topic,
      ranking_types: uniqueStrings(entries.map(({ item }) => item.rankingType)).sort(compareText),
      audiences: uniqueStrings(entries.map(({ item }) => item.audience)).sort(compareText),
      formats: uniqueStrings(entries.map(({ item }) => item.format)).sort(compareText),
      eras: uniqueStrings(entries.map(({ item }) => item.era)).sort(compareText),
      supply_count: supplyCount,
      rank_strength: rankStrength,
      demand_strength: demandStrength,
      growth_strength: growthStrength,
      new_title_rate: newTitleRate,
      platform_coverage: platformCoverage,
      persistence_strength: persistenceStrength,
      crowding,
      opportunity_score: opportunityScore,
      confidence: confidenceFor({ supplyCount, platformCoverage, sourceRatio }),
      confidence_detail: { supply_count: supplyCount, platform_coverage: platformCoverage, source_tag_ratio: sourceRatio },
    }
  }).sort((left, right) => right.opportunity_score - left.opportunity_score || compareText(left.topic, right.topic))
}

export function platformMatrix(items, fallbackSnapshotId = null) {
  const grouped = new Map()
  for (const entry of dedupeObservations(items)) {
    if (!grouped.has(entry.key)) grouped.set(entry.key, [])
    grouped.get(entry.key).push(entry)
  }
  return [...grouped.entries()].map(([key, entries]) => {
    const first = [...entries].sort(itemSort)[0].item
    const rankings = entries.map(({ item }) => ({ ranking_type: item.rankingType ?? '', ranking: finiteNumber(item.ranking) }))
      .sort((left, right) => compareText(left.ranking_type, right.ranking_type) || (left.ranking ?? Infinity) - (right.ranking ?? Infinity))
    return {
      key,
      title: first.title ?? '',
      topics: uniqueStrings(entries.flatMap(({ item }) => topicsOf(item))).sort(compareText),
      topic_sources: uniqueStrings(entries.map(({ item }) => item?.provenance?.topicSource)).sort(compareText),
      ranking_types: rankings.map(({ ranking_type }) => ranking_type),
      platform_coverage: rankings.length,
      rankings,
      evidence: entries.map(({ item }) => evidenceReference(item, key, fallbackSnapshotId)).sort(evidenceSort),
    }
  }).sort((left, right) => right.platform_coverage - left.platform_coverage || compareText(left.key, right.key))
}

export function companyConcentration(items) {
  const works = new Map()
  for (const entry of dedupeObservations(items)) {
    if (!works.has(entry.key)) works.set(entry.key, new Set())
    for (const company of normalizedCompanies(entry.item.companies)) works.get(entry.key).add(company)
  }
  const attributedWorks = [...works.entries()].filter(([, companies]) => companies.size > 0)
  const counts = new Map()
  for (const [, companies] of attributedWorks) for (const company of companies) counts.set(company, (counts.get(company) ?? 0) + 1)
  const companies = [...counts.entries()].map(([company, playletCount]) => ({ company, playlet_count: playletCount, share: attributedWorks.length === 0 ? 0 : playletCount / attributedWorks.length }))
    .sort((left, right) => right.playlet_count - left.playlet_count || compareText(left.company, right.company))
  const topThree = new Set(companies.slice(0, 3).map(({ company }) => company))
  // 多角色归属会让公司份额相加超过 1，因此 CR3 取前三家公司覆盖作品的并集，保持可解释的 0..1 范围。
  const cr3 = attributedWorks.length === 0 ? 0 : attributedWorks.filter(([, list]) => [...list].some((company) => topThree.has(company))).length / attributedWorks.length
  return { total_with_company: attributedWorks.length, company_count: companies.length, cr3, companies }
}

function snapshotShape(snapshot) {
  if (Array.isArray(snapshot)) return { items: snapshot, successfulRankingTypes: uniqueStrings(snapshot.map((item) => item?.rankingType)).sort(compareText) }
  const source = isRecord(snapshot) ? snapshot : {}
  const items = Array.isArray(source.items) ? source.items : []
  const successful = source.successfulRankingTypes ?? source.coverage?.successful_ranking_types ?? items.map((item) => item?.rankingType)
  return { items, successfulRankingTypes: uniqueStrings(successful).sort(compareText) }
}

export function compareSnapshots(current, previous) {
  const currentSnapshot = snapshotShape(current)
  const previousSnapshot = snapshotShape(previous)
  const comparable = currentSnapshot.items.length > 0
    && previousSnapshot.items.length > 0
    && currentSnapshot.successfulRankingTypes.length > 0
    && JSON.stringify(currentSnapshot.successfulRankingTypes) === JSON.stringify(previousSnapshot.successfulRankingTypes)
  if (!comparable) return { comparable: false, trend: null }
  const currentKeys = new Set(dedupeObservations(currentSnapshot.items).map(({ key }) => key))
  const previousKeys = new Set(dedupeObservations(previousSnapshot.items).map(({ key }) => key))
  return {
    comparable: true,
    trend: {
      sample_count_delta: currentSnapshot.items.length - previousSnapshot.items.length,
      unique_title_delta: currentKeys.size - previousKeys.size,
      new_key_count: [...currentKeys].filter((key) => !previousKeys.has(key)).length,
      removed_key_count: [...previousKeys].filter((key) => !currentKeys.has(key)).length,
    },
  }
}

function newTitleWatch(items, fallbackSnapshotId) {
  const grouped = new Map()
  for (const entry of dedupeObservations(items)) {
    if (entry.item.isNew !== true) continue
    if (!grouped.has(entry.key)) grouped.set(entry.key, [])
    grouped.get(entry.key).push(entry)
  }
  return [...grouped.entries()].map(([key, entries]) => {
    const first = [...entries].sort(itemSort)[0].item
    const rankings = entries.map(({ item }) => ({ ranking_type: item.rankingType ?? '', ranking: finiteNumber(item.ranking) }))
      .sort((left, right) => (left.ranking ?? Infinity) - (right.ranking ?? Infinity) || compareText(left.ranking_type, right.ranking_type))
    return {
      key,
      title: first.title ?? '',
      topics: uniqueStrings(entries.flatMap(({ item }) => topicsOf(item))).sort(compareText),
      rankings,
      evidence: entries.map(({ item }) => evidenceReference(item, key, fallbackSnapshotId)).sort(evidenceSort),
    }
  }).sort((left, right) => (left.rankings[0]?.ranking ?? Infinity) - (right.rankings[0]?.ranking ?? Infinity) || compareText(left.key, right.key))
}

export function analyzeMarket({ items, successfulRankingTypes, snapshotIds, previousItems = [], filters = {} } = {}) {
  const sourceItems = Array.isArray(items) ? items : []
  const sourcePreviousItems = Array.isArray(previousItems) ? previousItems : []
  const filteredItems = sourceItems.filter((item) => isRecord(item) && matchesFilter(item, filters))
  const filteredPreviousItems = sourcePreviousItems.filter((item) => isRecord(item) && matchesFilter(item, filters))
  const successful = uniqueStrings(successfulRankingTypes).sort(compareText)
  const suppliedSnapshotIds = uniqueStrings(snapshotIds)
  // 入参首项是当前快照，排序仅服务于报告集合和稳定哈希；当前 observation 的证据不能改指向历史快照。
  const currentSnapshotId = suppliedSnapshotIds[0] ?? null
  const ids = [...suppliedSnapshotIds].sort(compareText)
  const generatedAt = deterministicGeneratedAt(filteredItems, filters)
  const metrics = topicMetrics(filteredItems, successful)
  // 采集口径属于快照元数据，筛选只改变分析样本，不能反推并缩窄历史成功榜单集合。
  const previousSuccessful = filters?.previousSuccessfulRankingTypes ?? uniqueStrings(sourcePreviousItems.map((item) => item?.rankingType))
  const hasTwoContentSnapshots = ids.length >= 2 && filteredItems.length > 0 && filteredPreviousItems.length > 0
  const comparison = hasTwoContentSnapshots
    ? compareSnapshots({ items: filteredItems, successfulRankingTypes: successful }, { items: filteredPreviousItems, successfulRankingTypes: previousSuccessful })
    : { comparable: false, trend: null }
  const failed = ALL_RANKING_TYPES.filter((type) => !successful.includes(type))
  const evidence = dedupeObservations(filteredItems)
    .map(({ item, key }) => evidenceReference(item, key, currentSnapshotId))
    .sort(evidenceSort)
  const limitations = ['数据仅覆盖公开 Top 30 榜单样本，不能代表全量市场。']
  if (ids.length <= 1) limitations.push('单次快照仅反映采集时点，不应直接视为趋势。')
  if (!hasTwoContentSnapshots) limitations.push('趋势不可用：缺少两个同口径且有实际内容的快照。')
  if (failed.length > 0) limitations.push(`榜单覆盖受限：${failed.join('、')} 未成功采集。`)
  if (hasTwoContentSnapshots && !comparison.comparable) limitations.push('历史快照成功榜单集合不同，结果不可比，未生成趋势。')
  const payload = {
    schema_version: 'market-report.v1',
    generated_at: generatedAt,
    snapshot_ids: ids,
    coverage: {
      sample_count: filteredItems.length,
      successful_ranking_types: successful,
      failed_ranking_types: failed,
      low_confidence_topic_count: metrics.filter((metric) => metric.confidence === 'low').length,
    },
    filters: appliedFilters(filters),
    summary: {
      formula_version: 'topic-opportunity-v1',
      methodology: '榜内稳健百分位聚合；持久度按 30 天截尾归一化；供给按作品 key 去重。',
      topic_count: metrics.length,
      trend: comparison.trend,
    },
    topic_metrics: metrics,
    platform_matrix: platformMatrix(filteredItems, currentSnapshotId),
    company_concentration: companyConcentration(filteredItems),
    new_title_watch: newTitleWatch(filteredItems, currentSnapshotId),
    evidence,
    limitations,
  }
  return { schema_version: payload.schema_version, report_id: deterministicReportId(payload), ...payload }
}
