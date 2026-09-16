import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { createStudioServer, DEFAULT_WORKSPACE_ROOT, initializeWorkspace } from './studio.mjs'
import { createMarketStore } from './market/store.mjs'
import { analyzeMarket } from './market/analyze.mjs'
import { renderDocument } from '../studio/document-view.js'
import { marketRoute, parseAppRoute, parseRoute, projectRoute } from '../studio/router.js'

const execute = promisify(execFile)
const pluginRoot = resolve(import.meta.dirname, '..')
const run = (script, args) => execute(process.execPath, [resolve(pluginRoot, 'scripts', script), ...args])

const briefFixture = () => ({
  title: '原有项目', logline: '', adaptation_mode: 'original', genre: '原有题材', audience: '', platform: '原有平台', tone: '', core_conflict: '', output_language: 'zh-CN', spoken_language: 'zh-CN', subtitle_language: 'zh-CN', aspect_ratio: '9:16', episode_count: 1, episode_duration_seconds: 30, rating: '', existing_materials: [], required_deliverables: [], prohibited_content: [], ending_type: '', creative_constraints: [], market_inspiration_ref: null, open_questions: [], approved: true,
})

function marketReportFixture() {
  return analyzeMarket({
    items: [
      { key: 'suspense-1', title: '悬疑样本', topics: ['悬疑'], rankingType: 'hot', ranking: 1, heatValue: 100, audience: '女频', format: '真人', provenance: { topicSource: 'source-tag' } },
      { key: 'romance-1', title: '甜宠样本', topics: ['甜宠'], rankingType: 'douyin', ranking: 2, heatValue: 80, audience: '女频', format: '真人', provenance: { topicSource: 'source-tag' } },
    ],
    successfulRankingTypes: ['hot', 'douyin'], snapshotIds: ['studio-inspiration-snapshot'],
  })
}

assert.equal(DEFAULT_WORKSPACE_ROOT, resolve(homedir(), 'darma_project'))

test('Dashboard 项目路由可在刷新后恢复', () => {
  assert.deepEqual(parseRoute(projectRoute('demo drama', 'assets')), { projectKey: 'demo drama', view: 'assets' })
  assert.deepEqual(parseRoute(projectRoute('demo', 'recreation')), { projectKey: 'demo', view: 'recreation' })
  assert.deepEqual(parseRoute('#/projects/demo/unknown'), { projectKey: 'demo', view: 'overview' })
  assert.equal(parseRoute('#/'), null)
})

test('复刻项目的创建类型、复刻巡检与文档白名单', async (t) => {
  const workspace = await mkdtemp(resolve(tmpdir(), 'short-drama-studio-recreation-'))
  const server = createStudioServer({ workspaceRoot: workspace })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  t.after(async () => { await new Promise((done) => server.close(done)); await rm(workspace, { recursive: true, force: true }) })
  const base = `http://127.0.0.1:${server.address().port}`
  const csrfToken = (await fetch(`${base}/api/v1/workspace`).then((response) => response.json())).csrfToken
  const headers = { 'content-type': 'application/json', 'x-short-drama-csrf': csrfToken }

  const invalid = await fetch(`${base}/api/v1/projects`, { method: 'POST', headers, body: JSON.stringify({ key: 'bad-type', title: '非法类型', workflowType: 'clone' }) })
  assert.equal(invalid.status, 400)

  const created = await fetch(`${base}/api/v1/projects`, {
    method: 'POST', headers,
    body: JSON.stringify({ key: 'rec-demo', title: '复刻示例', workflowType: 'viral-recreation', episodeCount: 2 }),
  })
  assert.equal(created.status, 201, await created.text())
  const projectRoot = resolve(workspace, 'rec-demo')
  assert.equal(JSON.parse(await readFile(resolve(projectRoot, '.short-drama/project.json'), 'utf8')).workflow.type, 'viral-recreation')

  const standard = await fetch(`${base}/api/v1/projects`, { method: 'POST', headers, body: JSON.stringify({ key: 'std-demo', title: '原创示例' }) })
  assert.equal(standard.status, 201)
  const standardDetail = await fetch(`${base}/api/v1/projects/std-demo`).then((response) => response.json())
  assert.equal(standardDetail.project.workflow.type, 'standard')
  assert.equal(standardDetail.recreation, null)

  for (const [key, title, order] of [['ep-001', '第一集', 1], ['ep-002', '第二集', 2]]) {
    const record = resolve(workspace, `episode-${key}.json`)
    await writeFile(record, JSON.stringify({ key, title, order }))
    await run('project-store.mjs', ['put-episode', projectRoot, record])
  }

  const sha = 'a'.repeat(64)
  await writeFile(resolve(projectRoot, '.short-drama/reference-video-analysis.json'), `${JSON.stringify({
    schema_version: 1,
    source_ref: { key: 'src-hot-drama', version_id: 'v001', sha256: sha },
    rights: { status: 'reference-only', allowed_uses: [], restrictions: [] },
    confidence: 'medium',
    limitations: ['仅分析公开视频可见内容', '转写可能不完整'],
    coverage: { complete: false, analyzed_ms: 30000 },
  })}\n`)

  const workflowDir = resolve(projectRoot, 'episodes/ep-001/recreation-workflow')
  await mkdir(workflowDir, { recursive: true })
  await writeFile(resolve(workflowDir, 'selected.json'), `${JSON.stringify({ versionId: 'v001', path: 'episodes/ep-001/recreation-workflow/v001.json' })}\n`)
  await writeFile(resolve(workflowDir, 'v001.json'), `${JSON.stringify({
    rights_mode: 'structure-only',
    slots: [{ id: 'lead' }, { id: 'hook-line' }, { id: 'bgm' }],
    script: { segments: [{ id: 'seg-1' }, { id: 'seg-2' }] },
    media_tracks: [{ id: 'track-1' }],
    captions: { mode: 'word-aligned' },
    speech: { mode: 'post-dub' },
    film: { resolution: '1080x1920' },
    unresolved: [{ id: 'q1' }],
  })}\n`)
  await mkdir(resolve(projectRoot, '.short-drama/recreation-compiled/ep-001'), { recursive: true })
  await writeFile(resolve(projectRoot, '.short-drama/recreation-compiled/ep-001/v001.json'), '{}\n')

  const detail = await fetch(`${base}/api/v1/projects/rec-demo`).then((response) => response.json())
  assert.equal(detail.recreation.analysis.rightsStatus, 'reference-only')
  assert.equal(detail.recreation.analysis.sourceRef.key, 'src-hot-drama')
  assert.deepEqual(detail.recreation.episodes.map((item) => item.status), ['selected', 'none'])
  const ep1 = detail.recreation.episodes[0]
  assert.equal(ep1.versionId, 'v001')
  assert.equal(ep1.rightsMode, 'structure-only')
  assert.equal(ep1.slotCount, 3)
  assert.equal(ep1.compiled, true)
  assert.equal(ep1.unresolvedCount, 1)
  assert.equal(ep1.layers.script, 2)
  assert.equal(ep1.layers.captions, 'word-aligned')
  assert.equal(ep1.candidateCount, 1)
  assert.match(ep1.contentUrl, /documents\/content\?id=episodes%2Fep-001%2Frecreation-workflow%2Fv001\.json/)

  const labels = detail.documents.map((item) => item.label)
  assert.ok(labels.includes('参考视频分析'))
  assert.ok(labels.includes('复刻工作流'))
  assert.equal(detail.documents.find((item) => item.label === '复刻工作流').episodeKey, 'ep-001')
})

test('复刻 Dashboard 前端合同完整', async () => {
  const [appSource, html, styles] = await Promise.all([
    readFile(resolve(pluginRoot, 'studio/app.js'), 'utf8'),
    readFile(resolve(pluginRoot, 'studio/index.html'), 'utf8'),
    readFile(resolve(pluginRoot, 'studio/styles.css'), 'utf8'),
  ])
  for (const token of ['name="workflowType"', 'value="viral-recreation"', 'value="standard"', 'data-workflow-hint', 'analyze-reference-video']) assert.match(html, new RegExp(token))
  for (const token of ['爆款复刻', 'recreationView', 'recreation-table', '参考视频分析', 'rights-tag', 'rec-status']) assert.match(appSource, new RegExp(token))
  for (const token of ['.workflow-options', '.recreation-badge', '.recreation-table', '.rights-tag', '.cover-tag.recreation']) assert.match(styles, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})

test('市场路由可在刷新后恢复', () => {
  assert.equal(marketRoute(), '#/market')
  assert.deepEqual(parseAppRoute('#/market'), { kind: 'market' })
  assert.deepEqual(parseAppRoute('#/projects/demo/assets'), { kind: 'project', projectKey: 'demo', view: 'assets' })
})

test('市场页面和样式合同完整', async () => {
  const [appSource, styles] = await Promise.all([
    readFile(resolve(pluginRoot, 'studio/app.js'), 'utf8'),
    readFile(resolve(pluginRoot, 'studio/styles.css'), 'utf8'),
  ])
  for (const token of ['市场调研', 'data-market-refresh', 'data-market-filter', 'data-market-filter-key', 'data-market-sort', 'data-market-clear', 'data-market-report', 'aria-live="polite"', '公司格局', '新剧观察', '历史趋势', '灵感板', 'data-market-inspiration-topic', 'data-market-generate', 'data-market-register', '题材 × 榜单热度', '置信度']) assert.match(appSource, new RegExp(token))
  assert.doesNotMatch(appSource, /renderMarketLegacy/)
  for (const token of ['market-shell', 'market-filterbar', 'market-metrics', 'market-opportunity-layout', 'market-topic-table', 'market-platform-matrix', 'market-evidence-drawer', 'market-detail-grid', 'market-history', 'market-first-run', 'market-inspiration-board']) assert.match(styles, new RegExp(token))
  assert.match(styles, /@media \(max-width:900px\)/)
  assert.match(styles, /@media \(max-width:560px\)/)
  assert.match(styles, /:focus-visible/)
  assert.match(styles, /prefers-reduced-motion/)
})

test('市场页面真实 DOM 渲染缺失榜内值为破折号，并在切换题材或周期时复位灵感状态', async (t) => {
  const original = { document: globalThis.document, window: globalThis.window, history: globalThis.history, location: globalThis.location, fetch: globalThis.fetch, setInterval: globalThis.setInterval }
  const listeners = new Map(), app = { innerHTML: '', addEventListener: () => {} }, dialog = { addEventListener: () => {}, close: () => {}, showModal: () => {} }, toast = { textContent: '', classList: { add: () => {}, remove: () => {} } }
  const dispatch = (type, target) => {
    let stopped = false
    const event = { target, stopImmediatePropagation: () => { stopped = true } }
    for (const listener of listeners.get(type) || []) {
      listener(event)
      if (stopped) break
    }
  }
  globalThis.document = { querySelector: (selector) => selector === '#app' ? app : selector === '#toast' ? toast : dialog, addEventListener: (type, listener) => listeners.set(type, [...(listeners.get(type) || []), listener]) }
  globalThis.window = { confirm: () => true, addEventListener: () => {}, localStorage: { getItem: () => null, setItem: () => {} } }
  globalThis.history = { replaceState: () => {}, pushState: () => {} }
  globalThis.location = { hash: '#/market' }
  const report = marketReportFixture()
  const pendingGenerations = []
  const response = (body) => ({ ok: true, json: async () => body })
  globalThis.fetch = async (url) => {
    if (String(url).startsWith('/api/v1/workspace')) return response({ workspace: { title: '测试工作区', path: '/tmp' }, projects: [], csrfToken: 'test' })
    if (String(url) === '/api/v1/market/inspirations/generate') return new Promise((resolve) => pendingGenerations.push(resolve))
    return response({ status: 'ready', latestReport: report, latestSnapshot: {}, history: [report], filterOptions: { topics: ['悬疑', '甜宠'], audiences: ['女频'], formats: ['真人'], rankingTypes: ['douyin', 'hot'] } })
  }
  globalThis.setInterval = () => 0
  t.after(() => Object.assign(globalThis, original))
  await import(`../studio/app.js?market-dom=${Date.now()}`)
  await new Promise((done) => setImmediate(done))
  assert.match(app.innerHTML, /题材 × 榜单热度/)
  assert.match(app.innerHTML, /— \(n=0\)/)
  assert.match(app.innerHTML, /<option value="甜宠"/)

  const click = (dataset) => {
    const target = { dataset, closest: (selector) => selector === 'button' ? target : null }
    dispatch('click', target)
  }
  click({ marketInspirationTopic: '悬疑' })
  click({ marketGenerate: '' })
  await new Promise((done) => setImmediate(done))
  assert.match(app.innerHTML, /生成中…/)
  pendingGenerations.shift()(response({ candidates: [{ id: 'old-candidate', topic: '悬疑', confidence: '低', inference: '旧候选' }] }))
  await new Promise((done) => setImmediate(done))
  assert.match(app.innerHTML, /old-candidate/)

  click({ marketInspirationTopic: '甜宠' })
  assert.doesNotMatch(app.innerHTML, /old-candidate/)
  click({ marketGenerate: '' })
  await new Promise((done) => setImmediate(done))
  assert.match(app.innerHTML, /生成中…/)
  dispatch('change', { value: report.report_id, dataset: {}, matches: (selector) => selector === '[data-market-period]' })
  await new Promise((done) => setImmediate(done))
  assert.doesNotMatch(app.innerHTML, /生成中…/)
  pendingGenerations.shift()(response({ candidates: [{ id: 'stale-candidate', topic: '甜宠', confidence: '低', inference: '过期响应' }] }))
  await new Promise((done) => setImmediate(done))
  assert.doesNotMatch(app.innerHTML, /stale-candidate|生成中…/)
})

test('结构化文档递归展示字段并转义内容', () => {
  const html = renderDocument({ episode_key: 'ep-001', characters: [{ name: '<林乔>' }] })
  assert.match(html, /分集/)
  assert.match(html, /人物/)
  assert.match(html, /&lt;林乔&gt;/)
  assert.match(renderDocument({ selected_version: null }), /未设置/)
})

test('市场 API 支持空态、刷新锁和报告读取', async (t) => {
  const workspace = await mkdtemp(resolve(tmpdir(), 'short-drama-market-api-'))
  let releaseRefresh
  const refreshGate = new Promise((resolveGate) => { releaseRefresh = resolveGate })
  const marketService = {
    overview: async () => ({ status: 'empty', latestReport: null, latestSnapshot: null, history: [] }),
    refresh: async () => { await refreshGate; return { status: 'ready', latestReport: { report_id: 'r1' }, history: [{ report_id: 'r1' }] } },
    report: async (id) => id === 'r1' ? { report_id: 'r1' } : null,
    markdown: async () => '# 市场报告\n',
  }
  const server = createStudioServer({ workspaceRoot: workspace, marketService })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  t.after(async () => { releaseRefresh(); await new Promise((done) => server.close(done)); await rm(workspace, { recursive: true, force: true }) })
  const base = `http://127.0.0.1:${server.address().port}`
  const bootstrap = await fetch(`${base}/api/v1/workspace`).then((response) => response.json())
  assert.deepEqual(await fetch(`${base}/api/v1/market`).then((response) => response.json()), { status: 'empty', latestReport: null, latestSnapshot: null, history: [] })
  assert.equal((await fetch(`${base}/api/v1/market/refresh`, { method: 'POST' })).status, 403)
  const refresh = fetch(`${base}/api/v1/market/refresh`, { method: 'POST', headers: { 'x-short-drama-csrf': bootstrap.csrfToken } })
  await new Promise((done) => setImmediate(done))
  assert.equal((await fetch(`${base}/api/v1/market/refresh`, { method: 'POST', headers: { 'x-short-drama-csrf': bootstrap.csrfToken } })).status, 409)
  releaseRefresh()
  assert.equal((await refresh).status, 201)
  assert.equal((await fetch(`${base}/api/v1/market/reports/missing`)).status, 404)
  const traversal = await fetch(`${base}/api/v1/market/reports/..%2F..%2Fsecret/markdown`)
  assert.equal(traversal.status, 400)
  assert.doesNotMatch(await traversal.text(), /secret contents/)
  assert.equal((await fetch(`${base}/api/v1/market/reports/%E0%A4%A/markdown`)).status, 400)
  const markdown = await fetch(`${base}/api/v1/market/reports/r1/markdown`)
  assert.equal(markdown.headers.get('content-type'), 'text/markdown; charset=utf-8')
})

test('市场 API 默认服务在空工作区保持离线空态', async (t) => {
  const workspace = await mkdtemp(resolve(tmpdir(), 'short-drama-market-empty-'))
  const server = createStudioServer({ workspaceRoot: workspace })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  t.after(async () => { await new Promise((done) => server.close(done)); await rm(workspace, { recursive: true, force: true }) })
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/market`)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: 'empty', latestReport: null, latestSnapshot: null, history: [] })
})

test('市场 API 筛选使用最新快照重算全部指标', async (t) => {
  const workspace = await mkdtemp(resolve(tmpdir(), 'short-drama-market-filter-'))
  const store = createMarketStore(workspace)
  await store.saveSnapshot({
    schema_version: 1,
    snapshot_id: 'filter-snapshot',
    retrieved_at: '2026-09-16T10:00:00+08:00',
    source: { provider: 'dataeye-juchacha', coverage: 'public-top-30' },
    rankings: { hot: { content: [
      { playletId: 1, playletName: '男频剧', audience: '男频', playletTags: ['异能'], ranking: 1, consumeNum: 100 },
      { playletId: 2, playletName: '女频剧', audience: '女频', playletTags: ['甜宠'], ranking: 2, consumeNum: 50 },
    ] } },
    failures: [],
  })
  const oldReportId = JSON.parse((await run('market-research.mjs', ['analyze', workspace])).stdout).report_id
  await store.saveSnapshot({
    schema_version: 1,
    snapshot_id: 'filter-snapshot-new',
    retrieved_at: '2026-09-16T11:00:00+08:00',
    source: { provider: 'dataeye-juchacha', coverage: 'public-top-30' },
    rankings: { hot: { content: [{ playletId: 3, playletName: '新女频剧', audience: '女频', playletTags: ['甜宠'], ranking: 1, consumeNum: 90 }] } },
    failures: [],
  })
  await run('market-research.mjs', ['analyze', workspace])
  const server = createStudioServer({ workspaceRoot: workspace })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  t.after(async () => { await new Promise((done) => server.close(done)); await rm(workspace, { recursive: true, force: true }) })
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/market?audience=${encodeURIComponent('男频')}&reportId=${oldReportId}`)
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.equal(body.filtered, true)
  assert.equal(body.selectedReportId, oldReportId)
  assert.equal(body.latestReport.coverage.sample_count, 1)
  assert.deepEqual(body.latestReport.filters, { audience: '男频' })
  assert.deepEqual(body.latestReport.topic_metrics.map((item) => item.topic), ['异能'])
  assert.deepEqual(body.filterOptions.topics, ['甜宠', '异能'])
})

test('市场灵感 API 限制题材选择、生成本地候选并只登记灵感和 Brief 引用', async (t) => {
  const workspace = await mkdtemp(resolve(tmpdir(), 'short-drama-market-inspiration-'))
  const report = marketReportFixture()
  await createMarketStore(workspace).saveReport(report)
  const projectRoot = resolve(workspace, 'target-drama')
  await run('project-store.mjs', ['init', projectRoot])
  const briefPath = resolve(workspace, 'brief.json')
  await writeFile(briefPath, `${JSON.stringify(briefFixture())}\n`)
  await run('project-store.mjs', ['put-document', projectRoot, 'brief', briefPath])
  const beforeProject = JSON.parse(await readFile(resolve(projectRoot, '.short-drama/project.json'), 'utf8'))
  const server = createStudioServer({ workspaceRoot: workspace })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  t.after(async () => { await new Promise((done) => server.close(done)); await rm(workspace, { recursive: true, force: true }) })
  const base = `http://127.0.0.1:${server.address().port}`
  const csrfToken = (await fetch(`${base}/api/v1/workspace`).then((response) => response.json())).csrfToken
  const headers = { 'content-type': 'application/json', 'x-short-drama-csrf': csrfToken }

  const tooMany = await fetch(`${base}/api/v1/market/inspirations/generate`, { method: 'POST', headers, body: JSON.stringify({ reportId: report.report_id, topics: ['悬疑', '甜宠', '都市', '古装'] }) })
  assert.equal(tooMany.status, 400)
  const generated = await fetch(`${base}/api/v1/market/inspirations/generate`, { method: 'POST', headers, body: JSON.stringify({ reportId: report.report_id, topics: ['悬疑', '甜宠'] }) })
  const generatedBody = await generated.json()
  assert.equal(generated.status, 201, generatedBody.error)
  assert.equal(generatedBody.candidates.length, 2)
  assert.equal(new Set(generatedBody.candidates.map((item) => item.id)).size, generatedBody.candidates.length)
  assert.deepEqual(generatedBody.candidates.map((item) => item.topic), ['悬疑', '甜宠'])
  assert.equal(generatedBody.candidates[0].confidence, '低')
  const regenerated = await fetch(`${base}/api/v1/market/inspirations/generate`, { method: 'POST', headers, body: JSON.stringify({ reportId: report.report_id, topics: ['甜宠', '悬疑'] }) }).then((response) => response.json())
  assert.notEqual(regenerated.candidates[0].id, generatedBody.candidates[0].id)

  const registered = await fetch(`${base}/api/v1/market/inspirations/register`, { method: 'POST', headers, body: JSON.stringify({ projectKey: 'target-drama', candidateId: generatedBody.candidates[0].id }) })
  const registeredBody = await registered.json()
  assert.equal(registered.status, 201, registeredBody.error)
  assert.equal(registeredBody.marketInspiration.decision.selected_hypothesis_ids[0], generatedBody.candidates[0].id)
  assert.equal(registeredBody.brief.market_inspiration_ref.report_id, report.report_id)
  assert.deepEqual(JSON.parse(await readFile(resolve(projectRoot, '.short-drama/market-inspiration.json'), 'utf8')), registeredBody.marketInspiration)
  assert.equal(JSON.parse(await readFile(resolve(projectRoot, '.short-drama/brief.json'), 'utf8')).platform, '原有平台')
  assert.equal(JSON.parse(await readFile(resolve(projectRoot, '.short-drama/project.json'), 'utf8')).creative.genre, beforeProject.creative.genre)
  const reRegistered = await fetch(`${base}/api/v1/market/inspirations/register`, { method: 'POST', headers, body: JSON.stringify({ projectKey: 'target-drama', candidateId: regenerated.candidates[0].id }) }).then((response) => response.json())
  assert.equal(reRegistered.marketInspiration.decision.selected_hypothesis_ids[0], regenerated.candidates[0].id)
})

test('市场刷新失败返回可重试错误且不泄露上游细节', async (t) => {
  const workspace = await mkdtemp(resolve(tmpdir(), 'short-drama-market-failure-'))
  const previous = { report_id: 'existing-report', coverage: { sample_count: 30 } }
  const marketService = {
    overview: async () => ({ status: 'ready', latestReport: previous, latestSnapshot: {}, history: [previous] }),
    refresh: async () => { throw Object.assign(new Error('剧查查公开榜单刷新失败，请稍后重试'), { status: 502 }) },
    report: async () => null,
    markdown: async () => '',
  }
  const server = createStudioServer({ workspaceRoot: workspace, marketService })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  t.after(async () => { await new Promise((done) => server.close(done)); await rm(workspace, { recursive: true, force: true }) })
  const base = `http://127.0.0.1:${server.address().port}`
  const bootstrap = await fetch(`${base}/api/v1/workspace`).then((response) => response.json())
  const response = await fetch(`${base}/api/v1/market/refresh`, { method: 'POST', headers: { 'x-short-drama-csrf': bootstrap.csrfToken } })
  assert.equal(response.status, 502)
  const text = await response.text()
  assert.match(text, /请稍后重试/)
  assert.doesNotMatch(text, /https?:|authorization|cookie|stack/iu)
  assert.deepEqual((await fetch(`${base}/api/v1/market`).then((value) => value.json())).latestReport, previous)
})

test('Dashboard 通过本地 HTTP API 初始化工作区并创建项目', async (t) => {
  const workspace = await mkdtemp(resolve(tmpdir(), 'short-drama-studio-'))
  await t.test('工作区与项目写入既有项目合同', async () => {
    const originalStarrouterKey = process.env.STARROUTER_API_KEY
    const originalCredentialFile = process.env.SHORT_DRAMA_CREDENTIALS_FILE
    process.env.STARROUTER_API_KEY = 'studio-test-key'
    process.env.SHORT_DRAMA_CREDENTIALS_FILE = resolve(workspace, 'credentials.json')
    t.after(() => originalStarrouterKey === undefined ? delete process.env.STARROUTER_API_KEY : process.env.STARROUTER_API_KEY = originalStarrouterKey)
    t.after(() => originalCredentialFile === undefined ? delete process.env.SHORT_DRAMA_CREDENTIALS_FILE : process.env.SHORT_DRAMA_CREDENTIALS_FILE = originalCredentialFile)
    await initializeWorkspace(workspace, '我的短剧')
    const testedProviders = []
    const server = createStudioServer({ workspaceRoot: workspace, providerTester: async (key) => { testedProviders.push(key); if (key === 'runninghub') throw new Error('RUNNINGHUB_REQUEST_FAILED(401)') } })
    await new Promise((done) => server.listen(0, '127.0.0.1', done))
    t.after(() => new Promise((done) => server.close(done)))

    const base = `http://127.0.0.1:${server.address().port}`
    const home = await fetch(base)
    assert.equal(home.status, 200)
    assert.match(await home.text(), /短剧工厂/)
    assert.equal((await fetch(`${base}/favicon.ico`)).status, 404)
    assert.equal((await fetch(`${base}/api/v1/workspace`)).status, 200)
    const bootstrap = await fetch(`${base}/api/v1/workspace`).then((response) => response.json())
    assert.equal(bootstrap.workspace.title, '我的短剧')
    assert.deepEqual(bootstrap.projects, [])

    const providerText = await fetch(`${base}/api/v1/providers`).then((response) => response.text())
    const providerCatalog = JSON.parse(providerText).providers
    const starrouter = providerCatalog.find((item) => item.key === 'starrouter')
    assert.equal(starrouter.configured, true)
    assert.ok(starrouter.models.image.some((item) => item.id === 'gpt-image-2'))
    assert.doesNotMatch(providerText, /studio-test-key/)
    const artStyles = await fetch(`${base}/api/v1/art-styles`).then((response) => response.json())
    assert.ok(artStyles.styles.some((style) => style.id === 'system-japanese-anime'))

    const credentialResponse = await fetch(`${base}/api/v1/providers/runninghub/credential`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-short-drama-csrf': bootstrap.csrfToken }, body: JSON.stringify({ credential: 'runninghub-test-key' }),
    })
    const credentialResult = await credentialResponse.text()
    assert.equal(credentialResponse.status, 200, credentialResult)
    assert.doesNotMatch(credentialResult, /runninghub-test-key/)
    assert.equal((await stat(process.env.SHORT_DRAMA_CREDENTIALS_FILE)).mode & 0o777, 0o600)
    assert.equal(JSON.parse(await readFile(process.env.SHORT_DRAMA_CREDENTIALS_FILE, 'utf8')).RUNNINGHUB_API_KEY, 'runninghub-test-key')
    assert.equal((await fetch(`${base}/api/v1/providers`).then((response) => response.json())).providers.find((item) => item.key === 'runninghub').configured, true)

    const connection = await fetch(`${base}/api/v1/providers/starrouter/test`, { method: 'POST', headers: { 'x-short-drama-csrf': bootstrap.csrfToken } })
    assert.deepEqual(await connection.json(), { provider: 'starrouter', ok: true, message: '连接成功' })
    const rejectedConnection = await fetch(`${base}/api/v1/providers/runninghub/test`, { method: 'POST', headers: { 'x-short-drama-csrf': bootstrap.csrfToken } })
    assert.equal(rejectedConnection.status, 502)
    assert.deepEqual(await rejectedConnection.json(), { error: '凭据无效或无权访问' })
    assert.deepEqual(testedProviders, ['starrouter', 'runninghub'])

    const denied = await fetch(`${base}/api/v1/projects`, { method: 'POST' })
    assert.equal(denied.status, 403)

    const created = await fetch(`${base}/api/v1/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-short-drama-csrf': bootstrap.csrfToken },
      body: JSON.stringify({ key: 'demo-drama', title: '示例短剧', genre: '悬疑', episodeCount: 8, episodeDurationSeconds: 90 }),
    })
    assert.equal(created.status, 201, await created.text())

    const project = JSON.parse(await readFile(resolve(workspace, 'demo-drama/.short-drama/project.json'), 'utf8'))
    assert.equal(project.key, 'demo-drama')
    assert.equal(project.creative.genre, '悬疑')
    assert.equal(project.automation_mode, true)
    assert.equal(project.format.episode_count, 8)
    assert.equal(project.storyboard.type, 'shot-board')
    assert.equal(project.storyboard.default_panel_grid_size, 4)
    assert.equal(project.storyboard.preferred_medium, 'blender')

    const projectRoot = resolve(workspace, 'renamed-folder')
    await rename(resolve(workspace, 'demo-drama'), projectRoot)
    const detailResponse = await fetch(`${base}/api/v1/projects/demo-drama`)
    const detail = await detailResponse.json()
    assert.equal(detailResponse.status, 200, detail.error)
    assert.equal(detail.project.title, '示例短剧')
    assert.equal(detail.path, await realpath(projectRoot))
    assert.deepEqual(detail.assets, [])

    const providerHeaders = { 'content-type': 'application/json', 'x-short-drama-csrf': bootstrap.csrfToken }
    const customArtStyle = { ...artStyles.styles.find((style) => style.id === 'system-japanese-anime'), id: 'custom-test', name: '自定义画风' }
    const providerSelection = await fetch(`${base}/api/v1/projects/demo-drama/providers`, {
      method: 'POST', headers: providerHeaders, body: JSON.stringify({ providers: { image: { provider: 'starrouter', model_or_workflow: 'gpt-image-2' } }, creative: { art_style: customArtStyle } }),
    })
    const configuredProject = await providerSelection.json()
    assert.equal(providerSelection.status, 200, configuredProject.error)
    assert.equal(configuredProject.project.providers.image.provider, 'starrouter')
    assert.equal(configuredProject.project.creative.art_style.id, 'custom-test')
    assert.equal(JSON.parse(await readFile(resolve(workspace, 'art-styles.custom.json'), 'utf8'))[0].id, 'custom-test')
    assert.equal(configuredProject.project.providers.video.provider, null)

    const automationResponse = await fetch(`${base}/api/v1/projects/demo-drama/automation`, {
      method: 'POST', headers: providerHeaders, body: JSON.stringify({ enabled: false }),
    })
    const automationProject = await automationResponse.json()
    assert.equal(automationResponse.status, 200, automationProject.error)
    assert.equal(automationProject.project.automation_mode, false)
    assert.equal(automationProject.state.stage, 'analysis')

    const invalidProvider = await fetch(`${base}/api/v1/projects/demo-drama/providers`, {
      method: 'POST', headers: providerHeaders, body: JSON.stringify({ providers: { video: { provider: 'unknown', model_or_workflow: 'missing' } } }),
    })
    assert.equal(invalidProvider.status, 400)

    const assetRecord = resolve(workspace, 'asset.json')
    const image = resolve(workspace, 'image.png')
    await writeFile(assetRecord, JSON.stringify({ key: 'char-demo', type: 'character', name: '示例人物' }))
    await writeFile(image, Buffer.from([1, 2, 3, 4]))
    await run('asset-ledger.mjs', ['put', projectRoot, assetRecord])
    await run('asset-ledger.mjs', ['import', projectRoot, 'char-demo', image, 'v001'])
    await run('asset-ledger.mjs', ['select', projectRoot, 'char-demo', 'v001'])
    await run('asset-ledger.mjs', ['import', projectRoot, 'char-demo', image, 'v002'])

    const selectionHeaders = { 'content-type': 'application/json', 'x-short-drama-csrf': bootstrap.csrfToken }
    const selected = await fetch(`${base}/api/v1/projects/demo-drama/assets/char-demo/select`, { method: 'POST', headers: selectionHeaders, body: JSON.stringify({ versionId: 'v002', confirmed: true }) })
    const selectedBody = await selected.json()
    assert.equal(selected.status, 200, selectedBody.error)
    assert.equal(selectedBody.assets[0].selectedVersionId, 'v002')

    const preview = await fetch(`${base}/api/v1/projects/demo-drama/assets/char-demo/versions/v002/content`, { headers: { range: 'bytes=1-2' } })
    assert.equal(preview.status, 206)
    assert.deepEqual([...new Uint8Array(await preview.arrayBuffer())], [2, 3])

    const reverted = await fetch(`${base}/api/v1/projects/demo-drama/assets/char-demo/revert`, { method: 'POST', headers: selectionHeaders, body: JSON.stringify({ confirmed: true }) })
    const revertedBody = await reverted.json()
    assert.equal(reverted.status, 200, revertedBody.error)
    assert.equal(revertedBody.assets[0].selectedVersionId, 'v001')

    const episodeRecord = resolve(workspace, 'episode.json')
    const script = resolve(workspace, 'v001.md')
    await writeFile(episodeRecord, JSON.stringify({ key: 'ep-001', title: '第一集' }))
    await writeFile(script, '# 第一集\n\n真实剧本内容。\n')
    await run('project-store.mjs', ['put-episode', projectRoot, episodeRecord])
    await run('project-store.mjs', ['put-script', projectRoot, 'ep-001', 'v001', script])
    await run('project-store.mjs', ['select-script', projectRoot, 'ep-001', 'v001', '.md'])

    const documents = await fetch(`${base}/api/v1/projects/demo-drama`).then((response) => response.json())
    assert.deepEqual(documents.documents.map((item) => item.id), ['episodes/ep-001/scripts/v001.md'])
    const document = await fetch(`${base}${documents.documents[0].contentUrl}`)
    assert.equal(document.status, 200)
    assert.match(await document.text(), /真实剧本内容/)

    await mkdir(resolve(projectRoot, 'delivery/ep-001'), { recursive: true })
    await writeFile(resolve(projectRoot, 'delivery/ep-001/final.mp4'), Buffer.from([5, 6, 7, 8]))
    await writeFile(resolve(projectRoot, 'delivery/ep-001/manifest.json'), JSON.stringify({ version: 2, project: 'demo-drama', episode_key: 'ep-001', files: { video: { path: 'delivery/ep-001/final.mp4', sizeBytes: 4, sha256: '0'.repeat(64) } } }))
    const deliveryDetail = await fetch(`${base}/api/v1/projects/demo-drama`).then((response) => response.json())
    assert.equal(deliveryDetail.deliveries[0].files.video.sizeBytes, 4)
    const delivery = await fetch(`${base}${deliveryDetail.deliveries[0].files.video.contentUrl}`, { headers: { range: 'bytes=2-3' } })
    assert.equal(delivery.status, 206)
    assert.deepEqual([...new Uint8Array(await delivery.arrayBuffer())], [7, 8])

    const validation = await fetch(`${base}/api/v1/projects/demo-drama/validation`).then((response) => response.json())
    assert.equal(typeof validation.valid, 'boolean')
    assert.ok(Array.isArray(validation.issues))

    const imported = await fetch(`${base}/api/v1/projects/demo-drama/assets/import?assetKey=scene-demo&type=scene&name=${encodeURIComponent('示例场景')}&versionId=v001&filename=scene.png`, {
      method: 'POST', headers: { 'x-short-drama-csrf': bootstrap.csrfToken, 'x-short-drama-confirmed': 'true' }, body: Buffer.from([9, 10, 11]),
    })
    const importedBody = await imported.json()
    assert.equal(imported.status, 201, importedBody.error)
    assert.equal(importedBody.assets.find((item) => item.key === 'scene-demo').versions[0].sizeBytes, 3)

    const unconfirmedDelete = await fetch(`${base}/api/v1/projects/demo-drama`, { method: 'DELETE', headers: { 'x-short-drama-csrf': bootstrap.csrfToken } })
    assert.equal(unconfirmedDelete.status, 400)
    assert.equal((await fetch(`${base}/api/v1/projects/demo-drama`)).status, 200)

    const deleted = await fetch(`${base}/api/v1/projects/demo-drama`, { method: 'DELETE', headers: { 'x-short-drama-csrf': bootstrap.csrfToken, 'x-short-drama-confirmed': 'true' } })
    assert.equal(deleted.status, 200, await deleted.text())
    await assert.rejects(stat(projectRoot), { code: 'ENOENT' })
    assert.deepEqual((await fetch(`${base}/api/v1/workspace`).then((response) => response.json())).projects, [])
  })
  await rm(workspace, { recursive: true, force: true })
})
