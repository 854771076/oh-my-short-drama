import test from 'node:test'
import assert from 'node:assert/strict'
import {
  analyzeMarket,
  companyConcentration,
  compareSnapshots,
  percentileRanks,
  platformMatrix,
  topicMetrics,
} from './analyze.mjs'

const fixedFilters = { generatedAt: '2026-09-16T00:00:00.000Z' }

test('机会分可解释且高需求低拥挤题材排名更高', () => {
  const items = [
    { key: 'a', title: '谜案', topics: ['悬疑探案'], rankingType: 'douyin', ranking: 1, heatValue: 1000, growthValue: 800, isNew: true, persistenceDays: 3, provenance: { topicSource: 'source-tag' }, companies: {} },
    { key: 'b', title: '情感一', topics: ['都市情感'], rankingType: 'hot', ranking: 20, heatValue: 10, growthValue: 0, isNew: false, persistenceDays: 1, provenance: { topicSource: 'title-keyword' }, companies: {} },
    { key: 'c', title: '情感二', topics: ['都市情感'], rankingType: 'douyin', ranking: 25, heatValue: 5, growthValue: 0, isNew: false, persistenceDays: 1, provenance: { topicSource: 'source-tag' }, companies: {} },
  ]
  const report = analyzeMarket({ items, successfulRankingTypes: ['hot', 'douyin'], snapshotIds: ['s1'], filters: fixedFilters })
  assert.equal(report.topic_metrics[0].topic, '悬疑探案')
  assert.ok(report.topic_metrics[0].opportunity_score > report.topic_metrics[1].opportunity_score)
  assert.equal(report.summary.formula_version, 'topic-opportunity-v1')
  assert.match(report.limitations.join(' '), /单次快照/)
})

test('百分位稳健处理全零、并列、单项及非法数值', () => {
  assert.deepEqual(percentileRanks([0, 0, 0]), [0.5, 0.5, 0.5])
  assert.deepEqual(percentileRanks([5]), [0.5])
  assert.deepEqual(percentileRanks([1, 3, 3, null, NaN, Infinity]), [0, 0.75, 0.75, null, null, null])
})

test('重复 observation 不重复供给且持久度截尾归一化', () => {
  const items = [
    { key: 'same', title: '推理谜案', topics: ['悬疑探案'], rankingType: 'hot', ranking: 1, heatValue: 100, growthValue: 10, isNew: true, persistenceDays: 60, provenance: { topicSource: 'title-keyword' } },
    { key: 'same', title: '推理谜案', topics: ['悬疑探案'], rankingType: 'douyin', ranking: 2, heatValue: 300, growthValue: 30, isNew: true, persistenceDays: 60, provenance: { topicSource: 'title-keyword' } },
  ]
  const metric = topicMetrics(items, ['hot', 'douyin'])[0]
  assert.equal(metric.supply_count, 1)
  assert.equal(metric.persistence_strength, 1)
})

test('跨平台同剧在平台矩阵中合并且证据只保留引用', () => {
  const matrix = platformMatrix([
    { key: 'a', playletId: 9, title: '同剧', topics: ['悬疑探案'], rankingType: 'hot', ranking: 2, snapshotId: 's1' },
    { key: 'a', playletId: 9, title: '同剧', topics: ['悬疑探案'], rankingType: 'douyin', ranking: 1, snapshotId: 's1' },
  ])
  assert.equal(matrix.length, 1)
  assert.deepEqual(matrix[0].ranking_types, ['douyin', 'hot'])
  assert.equal(matrix[0].platform_coverage, 2)
  assert.deepEqual(matrix[0].evidence[0], { snapshot_id: 's1', ranking_type: 'douyin', playlet_id: 9, key: 'playlet-id:9' })
})

test('公司集中度以有归属去重作品为分母，空分母为零', () => {
  const concentration = companyConcentration([
    { key: 'a', companies: { producer: ['甲', '甲'] } },
    { key: 'b', companies: ['甲', '乙'] },
    { key: 'c', companies: null },
  ])
  assert.equal(concentration.total_with_company, 2)
  assert.equal(concentration.cr3, 1)
  assert.equal(companyConcentration([{ key: 'x', companies: {} }]).cr3, 0)
})

test('筛选后空结果仍返回完整零值报告且输入不变', () => {
  const items = [{ key: 'a', title: '剧', topics: ['悬疑探案'], audience: '女频', era: '现代', format: '短剧', rankingType: 'hot', ranking: 1 }]
  const before = structuredClone(items)
  const report = analyzeMarket({ items, successfulRankingTypes: ['hot'], snapshotIds: ['s1'], filters: { ...fixedFilters, audience: '男频' } })
  assert.deepEqual(items, before)
  assert.equal(report.coverage.sample_count, 0)
  assert.deepEqual(report.topic_metrics, [])
  assert.equal(report.company_concentration.cr3, 0)
  assert.equal(report.new_title_watch.length, 0)
  assert.equal(Object.keys(report).join(','), 'schema_version,report_id,generated_at,snapshot_ids,coverage,filters,summary,topic_metrics,platform_matrix,company_concentration,new_title_watch,evidence,limitations')
})

test('部分榜单失败、历史口径不同不生成趋势', () => {
  const current = { items: [{ key: 'a', rankingType: 'hot' }], successfulRankingTypes: ['hot', 'douyin'] }
  const previous = { items: [{ key: 'old', rankingType: 'hot' }], successfulRankingTypes: ['hot'] }
  assert.equal(compareSnapshots(current, previous).trend, null)
  const report = analyzeMarket({
    items: current.items,
    successfulRankingTypes: current.successfulRankingTypes,
    snapshotIds: ['new', 'old'],
    previousItems: previous.items,
    filters: { ...fixedFilters, previousSuccessfulRankingTypes: previous.successfulRankingTypes },
  })
  assert.deepEqual(report.coverage.failed_ranking_types, ['motion', 'motion-ai', 'motion-comedy', 'kuaishou', 'hongguo', 'income'])
  assert.equal(report.summary.trend, null)
  assert.match(report.limitations.join(' '), /不可比/)
})

test('新剧观察稳定排序且机会分位于零到一百', () => {
  const report = analyzeMarket({
    items: [
      { key: 'b', title: '乙', topics: ['题材'], rankingType: 'hot', ranking: 2, isNew: true, provenance: { topicSource: 'source-tag' } },
      { key: 'a', title: '甲', topics: ['题材'], rankingType: 'douyin', ranking: 1, isNew: true, provenance: { topicSource: 'source-tag' } },
    ],
    successfulRankingTypes: ['hot', 'douyin'],
    snapshotIds: ['s1'],
    filters: fixedFilters,
  })
  assert.deepEqual(report.new_title_watch.map((item) => item.key), ['a', 'b'])
  assert.ok(report.topic_metrics.every((item) => item.opportunity_score >= 0 && item.opportunity_score <= 100))
})

test('没有历史成功榜单口径时，不会把当前集合复用为趋势口径', () => {
  const report = analyzeMarket({
    items: [{ key: 'now', rankingType: 'hot' }],
    successfulRankingTypes: ['hot'],
    snapshotIds: ['now', 'before'],
    previousItems: [{ key: 'before', rankingType: 'douyin' }],
    filters: fixedFilters,
  })
  assert.equal(report.summary.trend, null)
  assert.match(report.limitations.join(' '), /不可比/)
})

test('两个 snapshot id 但没有两份实际内容时明确标记趋势不可用', () => {
  const report = analyzeMarket({
    items: [{ key: 'now', rankingType: 'hot' }],
    successfulRankingTypes: ['hot'],
    snapshotIds: ['now', 'before'],
    filters: fixedFilters,
  })
  assert.equal(report.summary.trend, null)
  assert.match(report.limitations.join(' '), /趋势不可用/)
})

test('快照成功榜单集合忽略输入顺序，并要求两边都有实际 observation', () => {
  const sameCoverage = compareSnapshots(
    { items: [{ key: 'a', rankingType: 'hot' }], successfulRankingTypes: ['hot', 'douyin'] },
    { items: [{ key: 'b', rankingType: 'douyin' }], successfulRankingTypes: ['douyin', 'hot'] },
  )
  assert.equal(sameCoverage.comparable, true)
  assert.notEqual(sameCoverage.trend, null)
  assert.equal(compareSnapshots({ items: [], successfulRankingTypes: ['hot'] }, { items: [{ key: 'b', rankingType: 'hot' }], successfulRankingTypes: ['hot'] }).trend, null)
})

test('报告的平台矩阵用快照 id 回填无 observation 快照字段的证据', () => {
  const report = analyzeMarket({
    items: [{ key: 'a', playletId: 1, rankingType: 'hot', ranking: 1 }],
    successfulRankingTypes: ['hot'],
    snapshotIds: ['snapshot-current'],
    filters: fixedFilters,
  })
  assert.equal(report.platform_matrix[0].evidence[0].snapshot_id, 'snapshot-current')
})

test('同一 playletId 即使 key 不同也只计一部供给、平台作品和公司归属', () => {
  const items = [
    { key: 'different-a', playletId: 7, topics: ['题材'], rankingType: 'hot', ranking: 1, companies: ['甲'] },
    { key: 'different-b', playletId: 7, topics: ['题材'], rankingType: 'douyin', ranking: 2, companies: ['甲'] },
  ]
  assert.equal(topicMetrics(items, ['hot', 'douyin'])[0].supply_count, 1)
  assert.equal(platformMatrix(items).length, 1)
  assert.equal(companyConcentration(items).total_with_company, 1)
})

test('来源标签在相同样本量和平台覆盖下比标题推断有更高置信度', () => {
  const makeItems = (topicSource) => Array.from({ length: 5 }, (_, index) => ({
    key: `${topicSource}-${index}`,
    topics: ['题材'],
    rankingType: index % 2 === 0 ? 'hot' : 'douyin',
    provenance: { topicSource },
  }))
  const sourceTag = topicMetrics(makeItems('source-tag'), ['hot', 'douyin'])[0]
  const titleKeyword = topicMetrics(makeItems('title-keyword'), ['hot', 'douyin'])[0]
  assert.equal(sourceTag.confidence, 'high')
  assert.equal(titleKeyword.confidence, 'low')
})

test('报告 ID 覆盖趋势、评分输入和筛选，并在相同输入下稳定', () => {
  const base = {
    items: [{ key: 'now', topics: ['题材'], rankingType: 'hot', ranking: 1, isNew: false, persistenceDays: 1 }],
    successfulRankingTypes: ['hot'],
    snapshotIds: ['now', 'before'],
    previousItems: [{ key: 'before', topics: ['题材'], rankingType: 'hot', ranking: 1 }],
    filters: fixedFilters,
  }
  const same = analyzeMarket(base)
  assert.equal(analyzeMarket(base).report_id, same.report_id)
  assert.notEqual(analyzeMarket({ ...base, previousItems: [] }).report_id, same.report_id)
  assert.notEqual(analyzeMarket({ ...base, items: [{ ...base.items[0], isNew: true, persistenceDays: 2 }] }).report_id, same.report_id)
  assert.notEqual(analyzeMarket({ ...base, filters: { ...fixedFilters, rankingTypes: ['hot'] } }).report_id, same.report_id)
})

test('历史成功榜单从筛选前 observation 推导，筛选不改变两期采集口径', () => {
  const report = analyzeMarket({
    items: [
      { key: 'now-hot', audience: '女频', rankingType: 'hot' },
      { key: 'now-douyin', audience: '男频', rankingType: 'douyin' },
    ],
    previousItems: [
      { key: 'old-hot', audience: '女频', rankingType: 'hot' },
      { key: 'old-douyin', audience: '男频', rankingType: 'douyin' },
    ],
    successfulRankingTypes: ['hot', 'douyin'],
    snapshotIds: ['now', 'old'],
    filters: { ...fixedFilters, audience: '女频' },
  })
  assert.notEqual(report.summary.trend, null)
  assert.doesNotMatch(report.limitations.join(' '), /不可比/)
})

test('固定样本精确遵循机会分权重', () => {
  const metrics = topicMetrics([
    { key: 'a', topics: ['甲'], rankingType: 'hot', ranking: 1, heatValue: 100, growthValue: 100, isNew: true, persistenceDays: 15 },
    { key: 'b', topics: ['乙'], rankingType: 'hot', ranking: 2, heatValue: 0, growthValue: 0, isNew: false, persistenceDays: 0 },
  ], ['hot'])
  assert.deepEqual(metrics.map(({ topic, rank_strength, demand_strength, growth_strength, new_title_rate, platform_coverage, persistence_strength, crowding, opportunity_score }) => ({ topic, rank_strength, demand_strength, growth_strength, new_title_rate, platform_coverage, persistence_strength, crowding, opportunity_score })), [
    { topic: '甲', rank_strength: 1, demand_strength: 1, growth_strength: 1, new_title_rate: 1, platform_coverage: 1, persistence_strength: 0.5, crowding: 0.5, opportunity_score: 82 },
    { topic: '乙', rank_strength: 0, demand_strength: 0, growth_strength: 0, new_title_rate: 0, platform_coverage: 1, persistence_strength: 0, crowding: 0.5, opportunity_score: 8 },
  ])
})

test('深冻结的非空输入可分析且保持不变', () => {
  const deepFreeze = (value) => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value)
      for (const entry of Object.values(value)) deepFreeze(entry)
    }
    return value
  }
  const input = deepFreeze({
    items: [{ key: 'a', topics: ['题材'], rankingType: 'hot', companies: { producer: ['甲'] }, provenance: { topicSource: 'source-tag' } }],
    successfulRankingTypes: ['hot'],
    snapshotIds: ['s1'],
    filters: fixedFilters,
  })
  const before = structuredClone(input)
  assert.doesNotThrow(() => analyzeMarket(input))
  assert.deepEqual(input, before)
})

test('snapshotIds 首项始终作为当前快照回填各类当前证据', () => {
  const currentSnapshot = '20260916-current'
  const report = analyzeMarket({
    items: [{ key: 'a', playletId: 1, title: '新剧', topics: ['题材'], rankingType: 'hot', ranking: 1, isNew: true }],
    previousItems: [{ key: 'old', rankingType: 'hot' }],
    successfulRankingTypes: ['hot'],
    snapshotIds: [currentSnapshot, '20260915-history'],
    filters: fixedFilters,
  })
  assert.equal(report.snapshot_ids[0], '20260915-history')
  assert.equal(report.evidence[0].snapshot_id, currentSnapshot)
  assert.equal(report.platform_matrix[0].evidence[0].snapshot_id, currentSnapshot)
  assert.equal(report.new_title_watch[0].evidence[0].snapshot_id, currentSnapshot)
})
