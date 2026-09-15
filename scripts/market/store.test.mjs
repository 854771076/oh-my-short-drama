import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
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

test('报告异步写入期间调用方篡改输入时，JSON 与 Markdown 仍绑定初始快照', async () => {
  const root = await createRoot()
  const store = createMarketStore(root)
  const value = report({ report_id: 'market-report-stable', snapshot_ids: ['20260916T153000+0800'] })
  const saving = store.saveReport(value)
  value.report_id = 'market-report-mutated'
  value.snapshot_ids[0] = '20260916T160000+0800'
  await saving
  const saved = JSON.parse(await readFile(resolve(root, '.short-drama-market/reports/market-report-stable.json'), 'utf8'))
  const markdown = await readFile(resolve(root, '.short-drama-market/reports/market-report-stable.md'), 'utf8')
  assert.equal(saved.report_id, 'market-report-stable')
  assert.deepEqual(saved.snapshot_ids, ['20260916T153000+0800'])
  assert.match(markdown, /market-report-stable/)
  assert.match(markdown, /20260916T153000\+0800/)
})

test('Markdown 将外部文本的换行折叠，表格和章节不会被注入内容截断', async () => {
  const root = await createRoot()
  const store = createMarketStore(root)
  await store.saveReport(report({
    report_id: 'market-report-multiline',
    topic_metrics: [{ topic: '悬疑\n## 伪造章节', opportunity_score: 72.5, confidence: 'low', supply_count: 1, demand_strength: 0.8, growth_strength: 0.7, platform_coverage: 0.5 }],
    limitations: ['公开样本\r\n## 伪造限制章节'],
  }))
  const markdown = await readFile(resolve(root, '.short-drama-market/reports/market-report-multiline.md'), 'utf8')
  assert.equal(markdown.split('\n').filter((line) => line.startsWith('|')).length, 3)
  assert.doesNotMatch(markdown, /\n## 伪造/)
  assert.match(markdown, /悬疑 \\#\\# 伪造章节/)
  assert.match(markdown, /公开样本 \\#\\# 伪造限制章节/)
  assert.deepEqual(markdown.match(/^## /gmu), ['## ', '## ', '## ', '## '])
})

test('快照异步写入期间调用方篡改输入时，索引和内容仍绑定初始快照', async () => {
  const root = await createRoot()
  const store = createMarketStore(root)
  const value = { schema_version: 1, snapshot_id: '20260916T153000+0800', retrieved_at: '2026-09-16T15:30:00+08:00', rankings: { hot: [] }, failures: [] }
  const saving = store.saveSnapshot(value)
  value.snapshot_id = '20260916T160000+0800'
  value.rankings = { douyin: [] }
  await saving
  const saved = JSON.parse(await readFile(resolve(root, '.short-drama-market/snapshots/20260916T153000+0800.json'), 'utf8'))
  const index = JSON.parse(await readFile(resolve(root, '.short-drama-market/index.json'), 'utf8'))
  assert.equal(saved.snapshot_id, '20260916T153000+0800')
  assert.deepEqual(saved.rankings, { hot: [] })
  assert.equal(index.latest_snapshot_id, '20260916T153000+0800')
})

test('同一报告 ID 的并发保存按调用顺序保护首个成功报告，后续不同内容拒绝覆盖', async () => {
  const root = await createRoot()
  const store = createMarketStore(root)
  const first = report({ report_id: 'market-report-race', snapshot_ids: ['20260916T153000+0800'], topic_metrics: [{ topic: '第一版', opportunity_score: 1, confidence: 'low', supply_count: 1, demand_strength: 0, growth_strength: 0, platform_coverage: 0 }] })
  const second = report({ report_id: 'market-report-race', snapshot_ids: ['20260916T160000+0800'], generated_at: '2026-09-16T16:00:00.000+08:00', topic_metrics: [{ topic: '第二版', opportunity_score: 2, confidence: 'high', supply_count: 2, demand_strength: 1, growth_strength: 1, platform_coverage: 1 }] })
  const firstSaving = store.saveReport(first)
  const secondSaving = store.saveReport(second)
  await firstSaving
  await assert.rejects(secondSaving, /MARKET_REPORT_CONFLICT/)
  const saved = JSON.parse(await readFile(resolve(root, '.short-drama-market/reports/market-report-race.json'), 'utf8'))
  const markdown = await readFile(resolve(root, '.short-drama-market/reports/market-report-race.md'), 'utf8')
  assert.deepEqual(saved.snapshot_ids, ['20260916T153000+0800'])
  assert.equal(saved.topic_metrics[0].topic, '第一版')
  assert.match(markdown, /20260916T153000\+0800/)
  assert.match(markdown, /第一版/)
  assert.doesNotMatch(markdown, /第二版/)
})

test('同内容报告重复保存幂等，不改写既有报告和索引', async () => {
  const root = await createRoot()
  const store = createMarketStore(root)
  const value = report({ report_id: 'market-report-idempotent' })
  await store.saveReport(value)
  const jsonPath = resolve(root, '.short-drama-market/reports/market-report-idempotent.json')
  const markdownPath = resolve(root, '.short-drama-market/reports/market-report-idempotent.md')
  const indexPath = resolve(root, '.short-drama-market/index.json')
  const before = await Promise.all([readFile(jsonPath, 'utf8'), readFile(markdownPath, 'utf8'), readFile(indexPath, 'utf8')])
  await store.saveReport(structuredClone(value))
  assert.deepEqual(await Promise.all([readFile(jsonPath, 'utf8'), readFile(markdownPath, 'utf8'), readFile(indexPath, 'utf8')]), before)
})

test('已保存报告 A 后，同 ID 的报告 B 被拒绝且 A 两份产物和索引保持不变', async () => {
  const root = await createRoot()
  const store = createMarketStore(root)
  const first = report({ report_id: 'market-report-immutable', topic_metrics: [{ topic: 'A', opportunity_score: 1, confidence: 'low', supply_count: 1, demand_strength: 0, growth_strength: 0, platform_coverage: 0 }] })
  const second = report({ report_id: 'market-report-immutable', snapshot_ids: ['20260916T160000+0800'], topic_metrics: [{ topic: 'B', opportunity_score: 2, confidence: 'high', supply_count: 2, demand_strength: 1, growth_strength: 1, platform_coverage: 1 }] })
  await store.saveReport(first)
  const paths = [
    resolve(root, '.short-drama-market/reports/market-report-immutable.json'),
    resolve(root, '.short-drama-market/reports/market-report-immutable.md'),
    resolve(root, '.short-drama-market/index.json'),
  ]
  const before = await Promise.all(paths.map((path) => readFile(path, 'utf8')))
  await assert.rejects(store.saveReport(second), /MARKET_REPORT_CONFLICT/)
  assert.deepEqual(await Promise.all(paths.map((path) => readFile(path, 'utf8'))), before)
})

test('同内容 JSON 的配套 Markdown 被篡改时拒绝幂等保存而不覆盖恢复现场', async () => {
  const root = await createRoot()
  const store = createMarketStore(root)
  const value = report({ report_id: 'market-report-markdown-corrupt' })
  await store.saveReport(value)
  const jsonPath = resolve(root, '.short-drama-market/reports/market-report-markdown-corrupt.json')
  const markdownPath = resolve(root, '.short-drama-market/reports/market-report-markdown-corrupt.md')
  const indexPath = resolve(root, '.short-drama-market/index.json')
  await writeFile(markdownPath, '# 被篡改\n', 'utf8')
  const before = await Promise.all([readFile(jsonPath, 'utf8'), readFile(markdownPath, 'utf8'), readFile(indexPath, 'utf8')])
  await assert.rejects(store.saveReport(value), /MARKET_REPORT_CORRUPT/)
  assert.deepEqual(await Promise.all([readFile(jsonPath, 'utf8'), readFile(markdownPath, 'utf8'), readFile(indexPath, 'utf8')]), before)
})

test('同 ID 仅剩单边产物时拒绝覆盖并保留恢复现场', async () => {
  const root = await createRoot()
  const store = createMarketStore(root)
  const value = report({ report_id: 'market-report-partial' })
  await store.saveReport(value)
  const jsonPath = resolve(root, '.short-drama-market/reports/market-report-partial.json')
  const markdownPath = resolve(root, '.short-drama-market/reports/market-report-partial.md')
  const indexPath = resolve(root, '.short-drama-market/index.json')
  const beforeJson = await readFile(jsonPath, 'utf8')
  const beforeIndex = await readFile(indexPath, 'utf8')
  await rm(markdownPath)
  await assert.rejects(store.saveReport(value), /MARKET_REPORT_CORRUPT/)
  assert.equal(await readFile(jsonPath, 'utf8'), beforeJson)
  assert.equal(await readFile(indexPath, 'utf8'), beforeIndex)
})

test('报告 rename 失败时清理同目录临时文件', async () => {
  const root = await createRoot()
  const store = createMarketStore(root, { renameFile: async () => { throw new Error('注入 rename 失败') } })
  await assert.rejects(store.saveReport(report({ report_id: 'market-report-rename-failure' })), /注入 rename 失败/)
  const reportsDirectory = resolve(root, '.short-drama-market/reports')
  assert.deepEqual((await readdir(reportsDirectory)).filter((name) => name.includes('.tmp-')), [])
})

test('同一规范工作区的多个存储实例并发更新索引时保留两类最新指针', async () => {
  const root = await createRoot()
  const alias = `${root}-alias`
  await symlink(root, alias)
  const left = createMarketStore(root)
  const right = createMarketStore(alias)
  await Promise.all([
    left.saveSnapshot({ schema_version: 1, snapshot_id: '20260915T153000+0800', retrieved_at: '2026-09-15T15:30:00+08:00', rankings: { hot: [] }, failures: [] }),
    right.saveSnapshot({ schema_version: 1, snapshot_id: '20260916T153000+0800', retrieved_at: '2026-09-16T15:30:00+08:00', rankings: { douyin: [] }, failures: [] }),
    left.saveReport(report({ report_id: 'market-report-old-race', generated_at: '2026-09-15T15:30:00.000+08:00', snapshot_ids: ['20260915T153000+0800'] })),
    right.saveReport(report({ report_id: 'market-report-new-race', generated_at: '2026-09-16T15:30:00.000+08:00', snapshot_ids: ['20260916T153000+0800'] })),
  ])
  const index = JSON.parse(await readFile(resolve(root, '.short-drama-market/index.json'), 'utf8'))
  assert.equal(index.latest_snapshot_id, '20260916T153000+0800')
  assert.equal(index.latest_report_id, 'market-report-new-race')
})

test('readLatest 在损坏索引与较大坏文件存在时跳过无效合同并恢复有效历史', async () => {
  const root = await createRoot()
  const store = createMarketStore(root)
  await store.saveSnapshot({ schema_version: 1, snapshot_id: '20260916T153000+0800', retrieved_at: '2026-09-16T15:30:00+08:00', rankings: { hot: [] }, failures: [] })
  await store.saveReport(report({ report_id: 'market-report-valid-history' }))
  await writeFile(resolve(root, '.short-drama-market/index.json'), '{ 损坏', 'utf8')
  await writeFile(resolve(root, '.short-drama-market/snapshots/zzzz.json'), JSON.stringify({ schema_version: 999, snapshot_id: 'zzzz', rankings: {} }), 'utf8')
  await writeFile(resolve(root, '.short-drama-market/reports/zzzz.json'), JSON.stringify({ schema_version: 'wrong', report_id: 'zzzz', generated_at: '2099-01-01T00:00:00.000Z', snapshot_ids: ['20260916T153000+0800'] }), 'utf8')
  const latest = await store.readLatest()
  assert.equal(latest.latestSnapshot.snapshot_id, '20260916T153000+0800')
  assert.equal(latest.latestReport.report_id, 'market-report-valid-history')
})

test('readLatest 在记录缺少时间时以 ID 倒序作稳定恢复回退', async () => {
  const root = await createRoot()
  const store = createMarketStore(root)
  await store.saveSnapshot({ schema_version: 1, snapshot_id: '20260915T153000+0800', rankings: { hot: [] }, failures: [] })
  await store.saveSnapshot({ schema_version: 1, snapshot_id: '20260916T153000+0800', rankings: { douyin: [] }, failures: [] })
  await store.saveReport(report({ report_id: 'market-report-fallback-a', generated_at: undefined }))
  await store.saveReport(report({ report_id: 'market-report-fallback-b', generated_at: undefined }))
  const latest = await store.readLatest()
  assert.equal(latest.latestSnapshot.snapshot_id, '20260916T153000+0800')
  assert.equal(latest.latestReport.report_id, 'market-report-fallback-b')
})

test('快照目录为符号链接时读写均拒绝，外部目录不会被写入', async () => {
  const root = await createRoot()
  const external = await createRoot()
  await mkdir(resolve(root, '.short-drama-market'))
  await symlink(external, resolve(root, '.short-drama-market/snapshots'))
  const store = createMarketStore(root)
  const value = { schema_version: 1, snapshot_id: '20260916T153000+0800', rankings: { hot: [] }, failures: [] }
  await assert.rejects(store.readSnapshot(value.snapshot_id), /符号链接/)
  await assert.rejects(store.saveSnapshot(value), /符号链接/)
  assert.deepEqual(await readdir(external), [])
})
