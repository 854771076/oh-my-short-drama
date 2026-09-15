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

test('重复 observation 不重复供给，标题推断会降低置信度', () => {
  const items = [
    { key: 'same', title: '推理谜案', topics: ['悬疑探案'], rankingType: 'hot', ranking: 1, heatValue: 100, growthValue: 10, isNew: true, persistenceDays: 60, provenance: { topicSource: 'title-keyword' } },
    { key: 'same', title: '推理谜案', topics: ['悬疑探案'], rankingType: 'douyin', ranking: 2, heatValue: 300, growthValue: 30, isNew: true, persistenceDays: 60, provenance: { topicSource: 'title-keyword' } },
  ]
  const metric = topicMetrics(items, ['hot', 'douyin'])[0]
  assert.equal(metric.supply_count, 1)
  assert.equal(metric.confidence, 'low')
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
  assert.deepEqual(matrix[0].evidence[0], { snapshot_id: 's1', ranking_type: 'douyin', playlet_id: 9, key: 'a' })
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
