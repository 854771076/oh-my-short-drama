import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createMarketStore } from './store.mjs'

async function createRoot() {
  return mkdtemp(resolve(tmpdir(), 'market-store-'))
}

function report(overrides = {}) {
  return {
    schema_version: 'market-report.v1',
    report_id: 'market-report-20260916',
    generated_at: '2026-09-16T15:30:00.000+08:00',
    snapshot_ids: ['20260916T153000+0800'],
    coverage: { sample_count: 1, successful_ranking_types: ['hot'], failed_ranking_types: [], low_confidence_topic_count: 0 },
    filters: {},
    summary: { formula_version: 'topic-opportunity-v1', methodology: '榜内聚合', topic_count: 1, trend: null },
    topic_metrics: [{ topic: '悬疑', opportunity_score: 72.5, confidence: 'medium', supply_count: 2, demand_strength: 0.8, growth_strength: 0.7, platform_coverage: 0.5 }],
    platform_matrix: [],
    company_concentration: { cr3: 0.5, companies: [] },
    new_title_watch: [],
    evidence: [],
    limitations: [],
    ...overrides,
  }
}

test('成功快照更新索引且拒绝路径穿越 ID', async () => {
  const root = await createRoot()
  const store = createMarketStore(root)
  await store.saveSnapshot({ schema_version: 1, snapshot_id: '20260916T153000+0800', rankings: { hot: [] }, failures: [] })
  const index = JSON.parse(await readFile(resolve(root, '.short-drama-market/index.json'), 'utf8'))
  assert.equal(index.latest_snapshot_id, '20260916T153000+0800')
  await assert.rejects(store.readReport('../secret'), /ID/)
})

test('索引缺失返回空最新记录，损坏索引不会阻止下一次成功快照恢复', async () => {
  const root = await createRoot()
  const store = createMarketStore(root)
  assert.deepEqual(await store.readLatest(), { latestSnapshot: null, latestReport: null })
  const indexPath = resolve(root, '.short-drama-market/index.json')
  await store.saveSnapshot({ schema_version: 1, snapshot_id: '20260915T153000+0800', rankings: { hot: [] }, failures: [] })
  await writeFile(indexPath, '{ not json', 'utf8')
  await store.saveSnapshot({ schema_version: 1, snapshot_id: '20260916T153000+0800', rankings: { douyin: [] }, failures: [] })
  const index = JSON.parse(await readFile(indexPath, 'utf8'))
  assert.equal(index.latest_snapshot_id, '20260916T153000+0800')
})

test('部分成功榜单落盘，全部失败既不落盘也不覆盖上一成功索引', async () => {
  const root = await createRoot()
  const store = createMarketStore(root)
  await store.saveSnapshot({ schema_version: 1, snapshot_id: '20260916T153000+0800', rankings: { hot: [] }, failures: [{ ranking_type: 'douyin', message: '超时' }] })
  const rejected = await store.saveSnapshot({ schema_version: 1, snapshot_id: '20260916T160000+0800', rankings: {}, failures: [{ ranking_type: 'hot', message: '超时' }] })
  assert.equal(rejected, null)
  assert.equal(await store.readSnapshot('20260916T160000+0800'), null)
  const index = JSON.parse(await readFile(resolve(root, '.short-drama-market/index.json'), 'utf8'))
  assert.equal(index.latest_snapshot_id, '20260916T153000+0800')
})

test('报告 JSON 与 Markdown 绑定同一 ID 和快照集合，历史按生成时间倒序', async () => {
  const root = await createRoot()
  const store = createMarketStore(root)
  const older = report({ report_id: 'market-report-old', generated_at: '2026-09-15T15:30:00.000+08:00', snapshot_ids: ['20260915T153000+0800'] })
  const newer = report({ report_id: 'market-report-new', generated_at: '2026-09-16T15:30:00.000+08:00', snapshot_ids: ['20260916T153000+0800'] })
  await store.saveReport(older)
  await store.saveReport(newer)
  const reportJson = JSON.parse(await readFile(resolve(root, '.short-drama-market/reports/market-report-new.json'), 'utf8'))
  const markdown = await readFile(resolve(root, '.short-drama-market/reports/market-report-new.md'), 'utf8')
  assert.equal(reportJson.report_id, 'market-report-new')
  assert.deepEqual(reportJson.snapshot_ids, ['20260916T153000+0800'])
  assert.match(markdown, /market-report-new/)
  assert.match(markdown, /20260916T153000\+0800/)
  assert.deepEqual((await store.listHistory()).map((item) => item.report_id), ['market-report-new', 'market-report-old'])
  assert.equal((await store.readLatest()).latestReport.report_id, 'market-report-new')
  assert.deepEqual((await readdir(resolve(root, '.short-drama-market/reports'))).filter((name) => name.includes('.tmp-')), [])
})

test('Markdown 转义外部文本且限制章节始终存在', async () => {
  const root = await createRoot()
  const store = createMarketStore(root)
  const value = report({
    report_id: 'market-report-escaped',
    topic_metrics: [{ topic: '悬疑 | *注入*', opportunity_score: 72.5, confidence: 'low', supply_count: 1, demand_strength: 0.8, growth_strength: 0.7, platform_coverage: 0.5 }],
    limitations: [],
  })
  await store.saveReport(value)
  const markdown = await readFile(resolve(root, '.short-drama-market/reports/market-report-escaped.md'), 'utf8')
  assert.match(markdown, /悬疑 \\| \\*注入\\*/)
  assert.match(markdown, /## 限制与解读边界/)
  assert.match(markdown, /暂无额外限制说明。/)
})
