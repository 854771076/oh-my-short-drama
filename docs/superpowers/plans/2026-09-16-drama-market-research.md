# 短剧市场调研与题材分析 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为短剧工厂增加全局剧查查榜单采集、多维题材分析、可追溯报表和 Studio 市场调研模块。

**Architecture:** 使用零依赖 Node.js 共享引擎完成协议请求、榜单归一化、纯函数分析和工作区原子存储；Skill、CLI 与 Studio API 共用该引擎。浏览器只消费本地 API，不直接请求第三方服务；刷新由用户触发，失败时保留最后一次成功结果。

**Tech Stack:** Node.js ESM、原生 `fetch`、Node test runner、现有 Studio 原生 JavaScript/CSS、本地 JSON/Markdown、插件 Skill 合同。

**Spec:** `docs/superpowers/specs/2026-09-16-drama-market-research-design.md`

---

## File Map

**Create**

- `scripts/market/juchacha-client.mjs`：协议签名和 8 类榜单请求。
- `scripts/market/normalize.mjs`：排行榜字段归一化。
- `scripts/market/analyze.mjs`：题材聚合、评分与报告对象。
- `scripts/market/store.mjs`：快照、报告和索引存储。
- `scripts/market/report.mjs`：Markdown 报告渲染。
- `scripts/market-research.mjs`：CLI 编排入口。
- `scripts/market/juchacha-client.test.mjs`
- `scripts/market/normalize.test.mjs`
- `scripts/market/analyze.test.mjs`
- `scripts/market/store.test.mjs`
- `scripts/market-research.test.mjs`
- `skills/analyze-drama-market/SKILL.md`
- `skills/analyze-drama-market/agents/openai.yaml`
- `skills/analyze-drama-market/references/market-report.schema.json`
- `skills/analyze-drama-market/references/methodology.md`

**Modify**

- `scripts/studio.mjs`：市场 API 和刷新互斥锁。
- `scripts/studio.test.mjs`：市场 API 集成测试。
- `studio/router.js`：全局市场路由。
- `studio/app.js`：全局导航和市场调研交互。
- `studio/styles.css`：数据工作台、响应式和状态样式。
- `studio/index.html`：页面级可访问性文字或必要容器。
- `skills/short-drama-skill-index/SKILL.md`：登记市场分析路由。
- `skills/define-drama-brief/SKILL.md`：显式市场报告输入边界。
- `references/skill-map.json`：把新 Skill 登记为 support。
- `references/usage-guide.md`：增加市场调研流程。
- `README.md`：增加功能和 CLI 示例。
- `.codex-plugin/plugin.json`
- `.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`

### Task 1: 剧查查协议客户端

**Files:**
- Create: `scripts/market/juchacha-client.test.mjs`
- Create: `scripts/market/juchacha-client.mjs`

- [ ] **Step 1: 写固定签名和请求合同失败测试**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { createJuchachaClient, dateSignature, rankingDefinitions } from './juchacha-client.mjs'

test('上海日期固定样本生成已验证签名', () => {
  assert.equal(dateSignature(new Date('2026-09-16T08:00:00Z')), '0cdf73ff2b30ed7aa6206fde112bee77')
})

test('热力榜先解析最新日期再请求 Top 30', async () => {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options })
    return Response.json(calls.length === 1
      ? { statusCode: 200, content: { day: '2026-09-14' }, page: null, message: null }
      : { statusCode: 200, content: [{ ranking: 1, playletName: '样例剧' }], page: { pageId: 1, pageSize: 30 }, message: null })
  }
  const client = createJuchachaClient({ fetchImpl, now: () => new Date('2026-09-16T08:00:00Z') })
  const result = await client.fetchRanking('hot')
  assert.equal(result.content[0].playletName, '样例剧')
  assert.match(calls[1].url, /day=2026-09-14/)
  assert.equal(calls[1].options.headers.S, '0cdf73ff2b30ed7aa6206fde112bee77')
  assert.equal(calls[1].options.headers.authentication, '')
})

test('8 类榜单定义完整且收入榜不请求日期接口', () => {
  assert.deepEqual(Object.keys(rankingDefinitions), ['hot', 'motion', 'motion-ai', 'motion-comedy', 'douyin', 'kuaishou', 'hongguo', 'income'])
  assert.equal(rankingDefinitions.income.dateEndpoint, null)
})
```

- [ ] **Step 2: 运行测试并确认红灯**

Run: `node --test scripts/market/juchacha-client.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: 实现零依赖协议客户端**

实现并导出以下接口：

```js
export const rankingDefinitions = Object.freeze({
  hot: { title: '热力榜', dateEndpoint: '/playlet/getHotRankingDate', listEndpoint: '/playlet/listHotRanking', params: {} },
  motion: { title: '动态漫榜', dateEndpoint: '/playlet/motionComicDate', listEndpoint: '/playlet/motionComic', params: { rankType: 1 } },
  'motion-ai': { title: '真人AI榜', dateEndpoint: '/playlet/motionComicDate', listEndpoint: '/playlet/motionComic', params: { rankType: 2 } },
  'motion-comedy': { title: '沙雕漫榜', dateEndpoint: '/playlet/motionComicDate', listEndpoint: '/playlet/motionComic', params: { rankType: 3 } },
  douyin: { title: '抖音热播榜', dateEndpoint: '/playlet/getNativePlayCountDate', listEndpoint: '/playlet/selectNativePlayletPlayCountListByDate', params: {} },
  kuaishou: { title: '快手热播榜', dateEndpoint: '/playlet/getKuaishouNativePlayCountDate', listEndpoint: '/playlet/selectKuaishouNativePlayletPlayCountListByDate', params: {} },
  hongguo: { title: '红果榜', dateEndpoint: '/playlet/listHongGuoRankingDate', listEndpoint: '/playlet/listHongGuoRanking', params: {} },
  income: { title: '短剧收入榜', dateEndpoint: null, listEndpoint: '/playlet/getPlayletRevenueRankData', params: {} },
})

export function dateSignature(now = new Date())
export function createJuchachaClient({ baseUrl = 'https://playlet-applet.dataeye.com', fetchImpl = fetch, now = () => new Date(), timeoutMs = 20_000 } = {})
```

`fetchRanking(type, { day, week, month } = {})` 必须限制周期三选一，默认读取最新 `day`，固定请求 `pageId=1&pageSize=30`。使用 `AbortSignal.timeout(timeoutMs)`，检查 HTTP 状态、JSON 对象、数字型 `statusCode===200` 和数组型榜单内容；错误对象只能包含类型、端点和可公开消息，不带完整请求头。

- [ ] **Step 4: 增加超时、HTTP 错误、业务错误、脏 JSON 和部分榜单测试**

测试断言错误分别带 `JUCHACHA_TIMEOUT`、`JUCHACHA_HTTP_ERROR`、`JUCHACHA_API_ERROR`、`JUCHACHA_INVALID_RESPONSE`；验证 `fetchAllRankings()` 使用 `Promise.allSettled` 返回 `{ rankings, failures }`，单榜失败不抹掉成功榜单。

- [ ] **Step 5: 运行协议测试**

Run: `node --test scripts/market/juchacha-client.test.mjs`
Expected: PASS.

- [ ] **Step 6: 提交协议客户端**

```bash
git add scripts/market/juchacha-client.mjs scripts/market/juchacha-client.test.mjs
git commit -m "feat: 新增剧查查排行榜协议客户端"
```

### Task 2: 榜单归一化与受控题材词表

**Files:**
- Create: `scripts/market/normalize.test.mjs`
- Create: `scripts/market/normalize.mjs`
- Read: `references/writing/genre-guide.md`

- [ ] **Step 1: 写不同榜单字段归一化失败测试**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeRankings } from './normalize.mjs'

test('合并数组和字符串标签并保留来源', () => {
  const result = normalizeRankings({
    hot: [{ playletId: 1, playletName: '公司扣我年终奖，我不忍了', ranking: 1, consumeNum: 889000, newFlag: true, playletTags: ['男频', null, '现代', '都市日常'], relatedPartyCompany: ['快创'] }],
    douyin: [{ playletId: 2, playletName: '今晚查寝，别开门', ranking: 1, playCountAddRaw: 900000, tags: '["女频","悬疑"]', isNew: 1 }],
  }, { observedAt: '2026-09-16T15:30:00+08:00' })
  assert.deepEqual(result[0].topics, ['都市日常'])
  assert.equal(result[0].audience, '男频')
  assert.equal(result[0].provenance.topicSource, 'source-tag')
  assert.equal(result[1].growthValue, 900000)
})
```

- [ ] **Step 2: 运行测试并确认红灯**

Run: `node --test scripts/market/normalize.test.mjs`
Expected: FAIL with missing module.

- [ ] **Step 3: 实现统一作品合同**

```js
export function parseList(value) {}
export function normalizeRankingItem(rankingType, item, context) {}
export function normalizeRankings(rankings, context) {}
export function mergePlayletObservations(items) {}
```

输出字段固定为 `key, playletId, title, rankingType, ranking, observedAt, topics, audience, era, format, heatValue, growthValue, isNew, persistenceDays, companies, provenance`。关键词推断只使用 `genre-guide.md` 已有题材及显式词根；推断结果必须标记 `title-keyword`，没有证据时使用 `未分类`，不得猜测受众或时代。

- [ ] **Step 4: 覆盖脏数据和跨榜单合并**

测试 `null` 标签、非法 JSON、重复公司、缺少 ID、同一作品跨榜单、动态漫表现形式、`topNum/listDays` 和不同封面字段；合并键优先 `playletId`，缺失时使用规范化标题哈希。

- [ ] **Step 5: 运行归一化测试**

Run: `node --test scripts/market/normalize.test.mjs`
Expected: PASS.

- [ ] **Step 6: 提交归一化模块**

```bash
git add scripts/market/normalize.mjs scripts/market/normalize.test.mjs
git commit -m "feat: 统一市场榜单题材字段"
```

### Task 3: 多维分析与机会评分

**Files:**
- Create: `scripts/market/analyze.test.mjs`
- Create: `scripts/market/analyze.mjs`

- [ ] **Step 1: 写评分、覆盖和置信度失败测试**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeMarket } from './analyze.mjs'

test('机会分可解释且高需求低拥挤题材排名更高', () => {
  const items = [
    { key: 'a', topics: ['悬疑探案'], rankingType: 'douyin', ranking: 1, heatValue: 1000, growthValue: 800, isNew: true, persistenceDays: 3, provenance: { topicSource: 'source-tag' }, companies: {} },
    { key: 'b', topics: ['都市情感'], rankingType: 'hot', ranking: 20, heatValue: 10, growthValue: 0, isNew: false, persistenceDays: 1, provenance: { topicSource: 'title-keyword' }, companies: {} },
    { key: 'c', topics: ['都市情感'], rankingType: 'douyin', ranking: 25, heatValue: 5, growthValue: 0, isNew: false, persistenceDays: 1, provenance: { topicSource: 'source-tag' }, companies: {} },
  ]
  const report = analyzeMarket({ items, successfulRankingTypes: ['hot', 'douyin'], snapshotIds: ['s1'] })
  assert.equal(report.topic_metrics[0].topic, '悬疑探案')
  assert.ok(report.topic_metrics[0].opportunity_score > report.topic_metrics[1].opportunity_score)
  assert.match(report.limitations.join(' '), /单次快照/)
})
```

- [ ] **Step 2: 运行测试并确认红灯**

Run: `node --test scripts/market/analyze.test.mjs`
Expected: FAIL with missing module.

- [ ] **Step 3: 实现纯函数指标管线**

```js
export function percentileRanks(values) {}
export function topicMetrics(items, successfulRankingTypes) {}
export function platformMatrix(items) {}
export function companyConcentration(items) {}
export function compareSnapshots(current, previous) {}
export function analyzeMarket({ items, successfulRankingTypes, snapshotIds, previousItems = [], filters = {} }) {}
```

机会分严格使用规格中的权重与 `clamp`。不同榜单先独立计算百分位，再按题材聚合。公司集中度使用去重作品数计算 CR3；没有两个同口径快照时 `trend` 为 `null` 并写入限制。报告必须包含 `coverage.sample_count`、成功/失败榜单、低置信题材数量和公式版本 `topic-opportunity-v1`。

- [ ] **Step 4: 增加边界测试**

覆盖全零数值、单作品、并列值、部分榜单失败、标题推断降权、跨平台同剧去重、过滤后空结果、历史口径不同和 CR3 分母为零。

- [ ] **Step 5: 运行分析测试**

Run: `node --test scripts/market/analyze.test.mjs`
Expected: PASS.

- [ ] **Step 6: 提交分析引擎**

```bash
git add scripts/market/analyze.mjs scripts/market/analyze.test.mjs
git commit -m "feat: 新增多维题材机会分析"
```

### Task 4: 全局快照、报告存储与 Markdown

**Files:**
- Create: `scripts/market/store.test.mjs`
- Create: `scripts/market/store.mjs`
- Create: `scripts/market/report.mjs`

- [ ] **Step 1: 写原子存储和路径边界失败测试**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createMarketStore } from './store.mjs'

test('成功快照更新索引且拒绝路径穿越 ID', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'market-store-'))
  const store = createMarketStore(root)
  await store.saveSnapshot({ schema_version: 1, snapshot_id: '20260916T153000+0800', rankings: { hot: [] }, failures: [] })
  const index = JSON.parse(await readFile(resolve(root, '.short-drama-market/index.json'), 'utf8'))
  assert.equal(index.latest_snapshot_id, '20260916T153000+0800')
  await assert.rejects(store.readReport('../secret'), /ID/)
})
```

- [ ] **Step 2: 运行测试并确认红灯**

Run: `node --test scripts/market/store.test.mjs`
Expected: FAIL with missing module.

- [ ] **Step 3: 实现存储接口**

```js
export function createMarketStore(workspaceRoot) {
  return {
    saveSnapshot,
    saveReport,
    readSnapshot,
    readReport,
    readLatest,
    listHistory,
  }
}

export function renderMarketReportMarkdown(report) {}
```

所有写入先进入同目录临时文件再 `rename`；文件名只接受 `/^[A-Za-z0-9+_-]{1,80}$/`。`saveSnapshot` 只有至少一个成功榜单时才更新索引；报告 JSON 和 Markdown 必须绑定相同 `report_id` 与快照集合。

- [ ] **Step 4: 增加恢复和报告测试**

测试索引不存在、索引损坏、部分成功、全部失败不落盘、按时间倒序、Markdown 转义与限制章节始终存在。

- [ ] **Step 5: 运行存储测试**

Run: `node --test scripts/market/store.test.mjs`
Expected: PASS.

- [ ] **Step 6: 提交存储模块**

```bash
git add scripts/market/store.mjs scripts/market/store.test.mjs scripts/market/report.mjs
git commit -m "feat: 保存市场快照与分析报告"
```

### Task 5: CLI 编排与 Skill 合同

**Files:**
- Create: `scripts/market-research.test.mjs`
- Create: `scripts/market-research.mjs`
- Create: `skills/analyze-drama-market/SKILL.md`
- Create: `skills/analyze-drama-market/agents/openai.yaml`
- Create: `skills/analyze-drama-market/references/market-report.schema.json`
- Create: `skills/analyze-drama-market/references/methodology.md`

- [ ] **Step 1: 写 CLI 自检和离线报告失败测试**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const execute = promisify(execFile)

test('市场 CLI 自检输出稳定合同', async () => {
  const { stdout } = await execute(process.execPath, ['scripts/market-research.mjs', '--self-check'])
  assert.deepEqual(JSON.parse(stdout), { status: 'ok', rankingTypes: 8, schemaVersion: 1 })
})
```

- [ ] **Step 2: 运行测试并确认红灯**

Run: `node --test scripts/market-research.test.mjs`
Expected: FAIL because the CLI does not exist.

- [ ] **Step 3: 实现 CLI 命令**

```text
node scripts/market-research.mjs refresh <workspace>
node scripts/market-research.mjs analyze <workspace> [snapshot-id]
node scripts/market-research.mjs report <workspace> [report-id]
node scripts/market-research.mjs list <workspace>
node scripts/market-research.mjs --self-check
```

`refresh` 采集、归一化、保存快照并生成报告；`analyze` 只读已有快照；`report` 输出 JSON 与 Markdown 路径；`list` 输出摘要 JSON。参数错误退出码为 2，上游请求错误为 3，存储错误为 4。

- [ ] **Step 4: 编写 Skill 与报告 Schema**

`SKILL.md` frontmatter：

```yaml
---
name: analyze-drama-market
description: 分析近期短剧市场、剧查查公开排行榜、题材趋势、平台差异、竞争拥挤度、新剧势能和公司集中度，并生成带数据证据与置信度的市场调研报告；不用于分析单部小说/剧本，不预测投资收益，不绕过付费或登录权限。
---
```

Skill 必须先验证工作区和最新报告；只有用户要求刷新时才联网。读取 `methodology.md` 后按“事实、机会、风险、平台、新剧、创作启示、限制”输出，不得隐藏 Top 30 边界。Schema 使用 `additionalProperties: false` 校验规格第 8 节全部顶层字段。

- [ ] **Step 5: 增加 Skill 静态断言**

测试 frontmatter 名称、正负触发边界、CLI 五个命令、Schema 必填字段和中文报告顺序；执行 `node scripts/audit-plugin.mjs --self-check` 验证 Skill 可被插件发现。

- [ ] **Step 6: 运行 CLI 与 Skill 测试**

Run: `node --test scripts/market-research.test.mjs && node scripts/market-research.mjs --self-check && node scripts/audit-plugin.mjs --self-check`
Expected: PASS and self-check JSON reports 8 ranking types.

- [ ] **Step 7: 提交 CLI 与 Skill**

```bash
git add scripts/market-research.mjs scripts/market-research.test.mjs skills/analyze-drama-market
git commit -m "feat: 新增短剧市场分析 Skill"
```

### Task 6: Studio 市场 API

**Files:**
- Modify: `scripts/studio.mjs`
- Modify: `scripts/studio.test.mjs`

- [ ] **Step 1: 写市场 API 失败集成测试**

在现有临时工作区测试中注入 `marketService`：

```js
const marketService = {
  overview: async () => ({ status: 'empty', latestReport: null, history: [] }),
  refresh: async () => ({ status: 'ready', latestReport: { report_id: 'r1' }, history: [{ report_id: 'r1' }] }),
  report: async (id) => id === 'r1' ? { report_id: 'r1' } : null,
  markdown: async () => '# 市场报告\n',
}
const server = createStudioServer({ workspaceRoot: workspace, marketService })
```

断言 `GET /api/v1/market` 返回空态，未带 CSRF 的 `POST /api/v1/market/refresh` 返回 403，合法刷新返回 201，重复刷新返回 409，未知报告返回 404，Markdown 使用 `text/markdown; charset=utf-8`。

- [ ] **Step 2: 运行聚焦测试并确认红灯**

Run: `node --test --test-name-pattern='市场 API' scripts/studio.test.mjs`
Expected: FAIL with 404 for `/api/v1/market`.

- [ ] **Step 3: 扩展 Studio 服务依赖与路由**

```js
export function createStudioServer({
  workspaceRoot: rootArg,
  providerTester = testProviderConnection,
  marketService = createDefaultMarketService(rootArg),
})
```

增加四个规格 API。刷新锁在 `createStudioServer` 闭包内，以 `marketRefreshPromise` 表示；锁存在时返回 `{ error: '市场数据正在刷新' }` 和 409。上游协议错误统一返回 502，文件合同错误返回 500，不返回堆栈。

- [ ] **Step 4: 测试真实默认服务的离线空态**

临时工作区没有 `.short-drama-market` 时，`GET /api/v1/market` 必须返回 200 和 `{ status: 'empty', latestReport: null, latestSnapshot: null, history: [] }`，且不触发网络请求。

- [ ] **Step 5: 运行 Studio API 回归**

Run: `node --test scripts/studio.test.mjs`
Expected: PASS.

- [ ] **Step 6: 提交 Studio API**

```bash
git add scripts/studio.mjs scripts/studio.test.mjs
git commit -m "feat: 暴露市场调研 Studio API"
```

### Task 7: 全局市场路由和界面行为

**Files:**
- Modify: `studio/router.js`
- Modify: `studio/app.js`
- Modify: `scripts/studio.test.mjs`

- [ ] **Step 1: 写全局路由与 HTML 合同失败测试**

```js
import { marketRoute, parseAppRoute } from '../studio/router.js'

test('市场路由可在刷新后恢复', () => {
  assert.equal(marketRoute(), '#/market')
  assert.deepEqual(parseAppRoute('#/market'), { kind: 'market' })
  assert.deepEqual(parseAppRoute('#/projects/demo/assets'), { kind: 'project', projectKey: 'demo', view: 'assets' })
})
```

静态 HTML 断言包含 `市场调研`、`data-market-refresh`、`data-market-filter`、`data-market-topic` 和可访问状态区域 `aria-live="polite"`。

- [ ] **Step 2: 运行聚焦测试并确认红灯**

Run: `node --test --test-name-pattern='市场路由|市场页面' scripts/studio.test.mjs`
Expected: FAIL for missing exports and markup.

- [ ] **Step 3: 扩展路由合同**

```js
export const marketRoute = () => '#/market'
export function parseAppRoute(hash) {
  if (hash === '#/market') return { kind: 'market' }
  const project = parseRoute(hash)
  return project ? { kind: 'project', ...project } : { kind: 'home' }
}
```

保持 `parseRoute`、`projectRoute` 向后兼容，启动和 `popstate` 改用 `parseAppRoute`。

- [ ] **Step 4: 实现市场页面渲染和交互**

在 `state` 增加：

```js
market: null,
marketLoading: false,
marketError: null,
marketFilters: { rankingType: 'all', topic: 'all', audience: 'all', format: 'all' },
marketSort: 'opportunity_score',
selectedMarketTopic: null,
```

实现 `loadMarket()`、`renderMarket()`、`refreshMarket()`、`filteredTopicMetrics()` 和证据抽屉。全局侧栏按钮设置 `data-market-home`；刷新请求携带 CSRF。首次空态、刷新骨架、部分失败提示、过期提示、无筛选结果和单快照限制均从 API 数据推导，不使用假数字。

- [ ] **Step 5: 增加交互回归测试**

使用导出的纯渲染 helper 或字符串合同测试：筛选只影响可见题材；机会分排序稳定；点击题材能按 evidence ref 找到作品；错误态仍保留旧报告；刷新按钮在请求期间禁用。

- [ ] **Step 6: 运行 Studio 前端回归**

Run: `node --test scripts/studio.test.mjs`
Expected: PASS.

- [ ] **Step 7: 提交路由与界面行为**

```bash
git add studio/router.js studio/app.js scripts/studio.test.mjs
git commit -m "feat: 新增全局市场调研页面"
```

### Task 8: 市场数据视觉系统与响应式

**Files:**
- Modify: `studio/styles.css`
- Modify: `studio/index.html`
- Modify: `scripts/studio.test.mjs`

- [ ] **Step 1: 写样式质量失败断言**

断言市场模块定义 `market-shell`、`market-filterbar`、`market-metrics`、`market-opportunity-layout`、`market-topic-table`、`market-platform-matrix`、`market-evidence-drawer`；CSS 包含 `@media (max-width: 900px)`、`@media (max-width: 560px)`、`:focus-visible` 和 `prefers-reduced-motion`。

- [ ] **Step 2: 运行样式合同并确认红灯**

Run: `node --test --test-name-pattern='市场样式' scripts/studio.test.mjs`
Expected: FAIL listing missing selectors.

- [ ] **Step 3: 实现桌面高密度布局**

沿用现有 CSS 变量，只增加语义变量 `--market-accent`、`--market-positive`、`--market-warning`。主区使用 `grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr)`；指标不套四个悬浮卡片，而用连续面板和细分隔线。数字使用 `font-variant-numeric: tabular-nums`，热度条提供文本值。

- [ ] **Step 4: 实现移动端和无障碍状态**

900px 以下主区单列，560px 以下筛选条横向滚动且正文不溢出；按钮最小高度 44px。证据抽屉在桌面从右侧进入，在移动端占满视口。所有过渡只使用 `transform/opacity`，降低动效偏好下禁用。

- [ ] **Step 5: 浏览器验证**

Run: `node scripts/studio.mjs <临时工作区>`
Expected: `#/market` 可打开；分别在 1440px、900px、375px 检查无重叠和水平滚动，键盘可进入筛选、刷新、题材行和关闭抽屉；空态、加载、成功、部分失败、错误五种 fixture 均可辨认。

- [ ] **Step 6: 提交视觉系统**

```bash
git add studio/styles.css studio/index.html scripts/studio.test.mjs
git commit -m "feat: 完成市场调研数据界面"
```

### Task 9: 工作流路由、文档与版本发布合同

**Files:**
- Modify: `skills/short-drama-skill-index/SKILL.md`
- Modify: `skills/define-drama-brief/SKILL.md`
- Modify: `references/skill-map.json`
- Modify: `references/usage-guide.md`
- Modify: `README.md`
- Modify: `.codex-plugin/plugin.json`
- Modify: `.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `scripts/integration-self-check.mjs`

- [ ] **Step 1: 写插件发现与版本失败断言**

在集成自检中断言：

```js
assert.ok(skillMap.support.includes('analyze-drama-market'))
assert.match(skillIndex, /市场.*analyze-drama-market/)
assert.match(usageGuide, /market-research\.mjs refresh/)
assert.equal(codexManifest.version, '0.8.0')
assert.equal(claudeManifest.version, codexManifest.version)
assert.equal(marketplace.plugins[0].version, codexManifest.version)
```

- [ ] **Step 2: 运行集成自检并确认红灯**

Run: `node scripts/integration-self-check.mjs --self-check`
Expected: FAIL for missing Skill registration and version 0.8.0.

- [ ] **Step 3: 更新工作流边界**

索引新增“市场题材、榜单、平台和竞争格局 → `analyze-drama-market`”。`define-drama-brief` 增加可选 `market_report_ref`，只有用户明确要求参考市场时才读取，报告结论不能覆盖来源事实、合规要求或用户已确认创意。

- [ ] **Step 4: 更新使用文档和版本**

README 与使用手册提供刷新、读取最新报告、指定历史报告和 Studio `#/market` 示例。将三个清单版本统一从 `0.7.0` 更新为 `0.8.0`，不添加构建元数据。

- [ ] **Step 5: 运行版本一致性与集成测试**

Run:

```bash
node -e "const fs=require('fs'); const v=JSON.parse(fs.readFileSync('.codex-plugin/plugin.json')).version; if (JSON.parse(fs.readFileSync('.claude-plugin/plugin.json')).version!==v || JSON.parse(fs.readFileSync('.claude-plugin/marketplace.json')).plugins[0].version!==v) process.exit(1)"
node scripts/integration-self-check.mjs --self-check
node scripts/audit-plugin.mjs --self-check
```

Expected: all commands exit 0 and version is `0.8.0`.

- [ ] **Step 6: 提交索引、文档和版本**

```bash
git add skills/short-drama-skill-index/SKILL.md skills/define-drama-brief/SKILL.md references/skill-map.json references/usage-guide.md README.md scripts/integration-self-check.mjs .codex-plugin/plugin.json .claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "feat: 发布市场调研工作流 0.8.0"
```

### Task 10: 全量验证与真实公开榜单烟测

**Files:**
- Modify only if a verification defect is found in files owned by Tasks 1–9.

- [ ] **Step 1: 运行全部市场测试**

Run:

```bash
node --test scripts/market/*.test.mjs scripts/market-research.test.mjs
```

Expected: all tests pass with no live network requirement.

- [ ] **Step 2: 运行 Studio 和插件回归**

Run:

```bash
node --test scripts/studio.test.mjs
node scripts/audit-plugin.mjs --self-check
node scripts/integration-self-check.mjs --self-check
```

Expected: all commands exit 0.

- [ ] **Step 3: 在显式临时工作区执行真实烟测**

Run:

```bash
market_smoke_root="$(mktemp -d /tmp/short-drama-market-smoke.XXXXXX)"
node scripts/market-research.mjs refresh "$market_smoke_root"
node scripts/market-research.mjs list "$market_smoke_root"
```

Expected: 至少一个榜单成功，最多每类 30 条；输出包含 `snapshot_id`、`report_id`、成功榜单数、失败榜单清单和 `public-top-30`。

- [ ] **Step 4: 校验真实报告证据**

检查最新报告的 `coverage.sample_count > 0`、所有 `topic_metrics[*].opportunity_score` 在 0–100、每条 evidence 能解析到快照作品、`limitations` 包含 Top 30 说明，文件中不存在非空 `authentication`、`token`、`cookie` 或 `sessionid`。

- [ ] **Step 5: 浏览器验收市场中心**

启动 Studio，打开 `#/market`，完成一次刷新、一个题材排序、一次筛选、一次证据抽屉开关和历史报告切换。确认控制台无错误，375px 和桌面视口无重叠，远端失败时旧报告仍可读。

- [ ] **Step 6: 检查工作区状态**

Run: `git status --short && git diff --check`
Expected: 没有测试缓存、临时快照、密钥或生成媒体进入版本控制；只保留计划内源码、Skill、文档和清单变更。

- [ ] **Step 7: 提交最终验证修正**

如果验证阶段产生了必要修正，只提交对应源码与测试；若没有修正，不创建空提交。
