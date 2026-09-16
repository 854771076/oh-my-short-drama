import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createMarketStore } from './market/store.mjs'

const scripts = dirname(fileURLToPath(import.meta.url))
const storeScript = resolve(scripts, 'project-store.mjs')

function run(...args) {
  return spawnSync(process.execPath, [storeScript, ...args], { encoding: 'utf8' })
}

async function writeJson(root, name, value) {
  const path = resolve(root, name)
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
  return path
}

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => stableSerialize(entry)).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`
  return value === undefined ? 'null' : JSON.stringify(value)
}

function canonicalSha256(value) {
  return createHash('sha256').update(stableSerialize(value)).digest('hex')
}

function marketReport() {
  return {
    schema_version: 'market-report.v2',
    report_id: 'market-report-20260916',
    generated_at: '2026-09-16T15:30:00.000+08:00',
    snapshot_ids: ['20260916T153000+0800'],
    filters: { topic: ['悬疑推理'], rankingTypes: ['hot'] },
  }
}

function inspiration(report = marketReport()) {
  const reportRef = {
    report_id: report.report_id,
    snapshot_ids: report.snapshot_ids,
    generated_at: report.generated_at,
    filters: report.filters,
    sha256: canonicalSha256(report),
    selected_hypothesis_ids: ['hyp-suspense-hook'],
  }
  return {
    schema_version: 'market-inspiration.v1',
    report_ref: reportRef,
    signals: [{
      id: 'signal-suspense-demand',
      fact: '悬疑推理题材在已选公开榜单样本中存在可追溯指标。',
      confidence: 'medium',
      evidence: [{ snapshot_id: '20260916T153000+0800', ranking_type: 'hot', playlet_id: 'sample-1', key: 'playlet-id:sample-1' }],
      limitations: ['仅覆盖公开 Top 30 样本。'],
    }],
    hypotheses: [{
      id: 'hyp-suspense-hook',
      derived_signal_ids: ['signal-suspense-demand'],
      inference: '可测试高密度线索回收的连续叙事。',
      creative_transformation: '以原创社区档案室为场景，围绕匿名录音展开。',
      premises: ['用户确认允许悬疑基调。'],
      opening_hook: '一段未来日期的求救录音在直播中播放。',
      serial_engine: '每集解锁一个可验证线索，并让主角承担新的代价。',
      differentiation: '用声音证据链替代模仿任何榜单作品的人物或情节。',
      production_fit: '固定室内场景与少量角色，适合竖屏短剧制作。',
      risks: ['样本置信度中等，需先做受众验证。'],
      validation_questions: ['目标受众是否认可声音线索作为主叙事驱动？'],
    }],
    decision: {
      selected_hypothesis_ids: ['hyp-suspense-hook'],
      rejected_hypothesis_ids: [],
      confirmed_at: null,
    },
    guardrails: {
      no_title_copy: true,
      no_plot_copy: true,
      no_revenue_promise: true,
      market_data_non_authoritative: true,
    },
  }
}

test('market-report-ref 从已保存报告生成可直接保存的完整引用', async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), 'project-market-report-ref-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  assert.equal(run('init', root).status, 0)

  const report = marketReport()
  await createMarketStore(root).saveReport(report)
  const generated = run('market-report-ref', root, report.report_id, 'hyp-suspense-hook')
  assert.equal(generated.status, 0, generated.stderr)
  const reportRef = JSON.parse(generated.stdout)
  assert.deepEqual(reportRef, {
    report_id: 'market-report-20260916',
    snapshot_ids: ['20260916T153000+0800'],
    generated_at: '2026-09-16T15:30:00.000+08:00',
    filters: { topic: ['悬疑推理'], rankingTypes: ['hot'] },
    sha256: '132620867404785da2ee8dda34242161c8fedfee8e4c840d9316f66f3d39bc8f',
    selected_hypothesis_ids: ['hyp-suspense-hook'],
  })

  const document = inspiration(report)
  document.report_ref = reportRef
  const saved = run('put-document', root, 'market-inspiration', await writeJson(root, 'generated-ref-inspiration.json', document))
  assert.equal(saved.status, 0, saved.stderr)
})

test('market-inspiration.v1 可验证、保存并回读，且 Brief 保留完整可空市场引用', async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), 'project-market-inspiration-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  assert.equal(run('init', root).status, 0)

  const report = marketReport()
  await createMarketStore(root).saveReport(report)
  const document = inspiration(report)
  const documentPath = await writeJson(root, 'market-inspiration.json', document)
  const saved = run('put-document', root, 'market-inspiration', documentPath)
  assert.equal(saved.status, 0, saved.stderr)
  assert.deepEqual(JSON.parse(await readFile(resolve(root, '.short-drama/market-inspiration.json'), 'utf8')), document)

  const brief = {
    title: '测试', logline: '', adaptation_mode: 'original', genre: '', audience: '', platform: '', tone: '', core_conflict: '', output_language: 'zh-CN', spoken_language: 'zh-CN', subtitle_language: 'zh-CN', aspect_ratio: '9:16', episode_count: 1, episode_duration_seconds: 30, rating: '', existing_materials: [], required_deliverables: [], prohibited_content: [], ending_type: '', creative_constraints: [], market_inspiration_ref: document.report_ref, open_questions: [], approved: true,
  }
  const briefPath = await writeJson(root, 'brief.json', brief)
  assert.equal(run('put-document', root, 'brief', briefPath).status, 0)
  assert.deepEqual(JSON.parse(await readFile(resolve(root, '.short-drama/brief.json'), 'utf8')).market_inspiration_ref, document.report_ref)

  const withoutMarket = { ...brief, market_inspiration_ref: null }
  const withoutMarketPath = await writeJson(root, 'brief-without-market.json', withoutMarket)
  assert.equal(run('put-document', root, 'brief', withoutMarketPath).status, 0)
  assert.equal(JSON.parse(await readFile(resolve(root, '.short-drama/brief.json'), 'utf8')).market_inspiration_ref, null)
})

test('market-inspiration 绑定已保存市场报告摘要，Brief 只能引用已保存且一致的灵感', async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), 'project-market-inspiration-reference-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  assert.equal(run('init', root).status, 0)
  const report = marketReport()
  await createMarketStore(root).saveReport(report)

  const wrongDigest = inspiration(report)
  wrongDigest.report_ref.sha256 = 'b'.repeat(64)
  const wrongDigestResult = run('put-document', root, 'market-inspiration', await writeJson(root, 'wrong-digest.json', wrongDigest))
  assert.notEqual(wrongDigestResult.status, 0)
  assert.match(wrongDigestResult.stderr, /SHA-256|摘要|报告/)

  const valid = inspiration(report)
  assert.equal(run('put-document', root, 'market-inspiration', await writeJson(root, 'valid-inspiration.json', valid)).status, 0)
  const mismatchedRef = { ...valid.report_ref, sha256: 'c'.repeat(64) }
  const brief = {
    title: '测试', logline: '', adaptation_mode: 'original', genre: '', audience: '', platform: '', tone: '', core_conflict: '', output_language: 'zh-CN', spoken_language: 'zh-CN', subtitle_language: 'zh-CN', aspect_ratio: '9:16', episode_count: 1, episode_duration_seconds: 30, rating: '', existing_materials: [], required_deliverables: [], prohibited_content: [], ending_type: '', creative_constraints: [], market_inspiration_ref: mismatchedRef, open_questions: [], approved: true,
  }
  const mismatchResult = run('put-document', root, 'brief', await writeJson(root, 'mismatched-brief.json', brief))
  assert.notEqual(mismatchResult.status, 0)
  assert.match(mismatchResult.stderr, /market-inspiration|引用|一致/)

  const tamperedReport = { ...report, limitations: ['报告已在引用生成后被篡改。'] }
  await writeJson(root, `.short-drama-market/reports/${report.report_id}.json`, tamperedReport)
  const tamperedResult = run('put-document', root, 'market-inspiration', await writeJson(root, 'tampered-report.json', valid))
  assert.notEqual(tamperedResult.status, 0)
  assert.match(tamperedResult.stderr, /SHA-256|摘要|报告/)
})

test('market-inspiration 引用拒绝空值和重复筛选数组，以及非 RFC 3339 时间', async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), 'project-market-inspiration-contract-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  assert.equal(run('init', root).status, 0)
  const report = marketReport()
  await createMarketStore(root).saveReport(report)

  for (const [name, mutate] of [
    ['empty-filter', (document) => { document.report_ref.filters.topic = [] }],
    ['duplicate-filter', (document) => { document.report_ref.filters.topic = ['悬疑推理', '悬疑推理'] }],
    ['loose-time', (document) => { document.report_ref.generated_at = '2026-09-16T15:30:00' }],
  ]) {
    const document = inspiration(report)
    mutate(document)
    const result = run('put-document', root, 'market-inspiration', await writeJson(root, `${name}.json`, document))
    assert.notEqual(result.status, 0, `${name} 不得通过`)
    assert.match(result.stderr, /filters|ISO|RFC|时间/)
  }
})

test('公开 Schema 要求筛选数组非空且唯一，并固定 RFC 3339 时间模式', async () => {
  const schema = JSON.parse(await readFile(resolve(scripts, '../skills/ideate-drama-from-market/references/market-inspiration.schema.json'), 'utf8'))
  const filterArray = schema.$defs.nonEmptyStrings
  assert.equal(filterArray.minItems, 1)
  assert.equal(filterArray.uniqueItems, true)
  assert.ok(schema.$defs.rfc3339DateTime.pattern.includes('T\\d{2}'))
  assert.ok(schema.$defs.rfc3339DateTime.pattern.includes('(?:Z|[+-]\\d{2}:\\d{2})'))
})

test('market-inspiration.v1 和 Brief 拒绝未知字段', async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), 'project-market-inspiration-invalid-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  assert.equal(run('init', root).status, 0)

  const invalidInspirationPath = await writeJson(root, 'invalid-market-inspiration.json', { ...inspiration(), injected: true })
  const invalidInspiration = run('put-document', root, 'market-inspiration', invalidInspirationPath)
  assert.notEqual(invalidInspiration.status, 0)
  assert.match(invalidInspiration.stderr, /market-inspiration 顶层字段必须且只能是/)

  const invalidBriefPath = await writeJson(root, 'invalid-brief.json', {
    title: '测试', logline: '', adaptation_mode: 'original', genre: '', audience: '', platform: '', tone: '', core_conflict: '', output_language: 'zh-CN', spoken_language: 'zh-CN', subtitle_language: 'zh-CN', aspect_ratio: '9:16', episode_count: 1, episode_duration_seconds: 30, rating: '', existing_materials: [], required_deliverables: [], prohibited_content: [], ending_type: '', creative_constraints: [], market_inspiration_ref: null, open_questions: [], approved: true, injected: true,
  })
  const invalidBrief = run('put-document', root, 'brief', invalidBriefPath)
  assert.notEqual(invalidBrief.status, 0)
  assert.match(invalidBrief.stderr, /brief 顶层字段必须且只能是/)
})
