# 授权音乐目录与短剧选曲实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留 Suno 生成配乐的同时，提供可扩展的在线音乐目录发现、授权凭证登记、素材导入和时间线使用门禁。

**Architecture:** 目录 Provider 只负责把剧情音乐需求映射为受控搜索或本地结果，不绕过站点登录和下载许可。`music-license-ledger.mjs` 保存下载时许可证证据，音频资产 provenance 绑定收据，`editing-store` 在时间线使用前验证用途兼容性。

**Tech Stack:** Node.js ESM、Node test runner、JSON-RPC MCP、现有 audio-plan/asset ledger、Pixabay/YouTube Audio Library/Uppbeat 官方入口。

**Spec:** `docs/superpowers/specs/2026-09-16-continuity-audio-media-pipeline-design.md` 第 9 节

## Global Constraints

- 不解析普通 YouTube 视频、不绕过登录、不抓取付费内容、不下载未授权商业热曲。
- “网络热曲”没有同步权和母带权凭证时只能作为风格参考，不能登记为可用配乐资产。
- 每个目录导入资产必须绑定不可变许可证收据；收据保存来源 URL、许可证 URL、下载时间、署名和 Content ID 风险。
- Pixabay、YouTube Audio Library、Uppbeat 的使用范围分别校验，不能把一个站点的许可证套到另一个站点。
- 现有 `generate_music` 和旧 `audio-plan.music_tracks` 保持兼容。

---

### Task 1: 音乐目录 Provider 接口与剧情查询编译

**Files:**
- Create: `scripts/music-catalog/providers.mjs`
- Create: `scripts/music-catalog/external-sites.mjs`
- Create: `scripts/music-catalog/providers.test.mjs`

**Interfaces:**
- Produces: `musicCatalogNames: string[]`
- Produces: `listMusicCatalogs(): Array<object>`
- Produces: `compileMusicSearch(input): {query:string,genre:string[],mood:string[],duration_seconds:number|null}`
- Produces: `searchMusicCatalog(input): Promise<{mode:'browser'|'results',search_url?:string,results?:object[]}>`

- [ ] **Step 1: Write failing catalog tests**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { compileMusicSearch, listMusicCatalogs, searchMusicCatalog } from './providers.mjs'

test('剧情功能被编译为具体选曲条件', () => {
  assert.deepEqual(compileMusicSearch({ purpose: 'bgm', dramatic_function: '秘密揭露前持续加压', pace: 'slow-build', dialogue_density: 'high', duration_seconds: 32 }), { query: 'suspense tension minimal instrumental', genre: ['cinematic'], mood: ['suspense'], duration_seconds: 32 })
})
test('外部站点返回官方搜索入口而不是盗链', async () => {
  const result = await searchMusicCatalog({ catalog: 'pixabay', query: 'cinematic suspense' })
  assert.equal(result.mode, 'browser')
  assert.match(result.search_url, /^https:\/\/pixabay\.com\/music\/search\//)
})
test('目录声明许可证和登录特性', () => {
  assert.deepEqual(listMusicCatalogs().map((item) => item.key), ['local-licensed', 'pixabay', 'youtube-audio-library', 'uppbeat'])
})
```

- [ ] **Step 2: Run test and verify red**

Run: `node --test scripts/music-catalog/providers.test.mjs`  
Expected: FAIL with missing module.

- [ ] **Step 3: Implement providers without scraping**

```js
const catalogs = {
  'local-licensed': { label: '本地授权音乐', mode: 'results', requires_login: false, attribution_varies: true },
  pixabay: { label: 'Pixabay Music', mode: 'browser', requires_login: false, attribution_varies: false, buildUrl: (query) => `https://pixabay.com/music/search/${encodeURIComponent(query)}/` },
  'youtube-audio-library': { label: 'YouTube Audio Library', mode: 'browser', requires_login: true, attribution_varies: true, buildUrl: () => 'https://www.youtube.com/audiolibrary' },
  uppbeat: { label: 'Uppbeat', mode: 'browser', requires_login: true, attribution_varies: true, buildUrl: (query) => `https://uppbeat.io/browse/music/${encodeURIComponent(query)}` },
}

export async function searchMusicCatalog(input) {
  const selected = catalogs[input.catalog]
  if (!selected) throw new Error('未知音乐目录 Provider')
  if (selected.mode === 'browser') return { mode: 'browser', search_url: selected.buildUrl(input.query), license_review_required: true }
  return { mode: 'results', results: await listLicensedLocalTracks(input.project_root, input) }
}
```

`compileMusicSearch` uses an explicit mapping table from purpose/dramatic function/pace/dialogue density to English catalog terms and never invents a track title or artist.

- [ ] **Step 4: Run catalog tests**

Run: `node --test scripts/music-catalog/providers.test.mjs`  
Expected: PASS with no network request.

- [ ] **Step 5: Commit**

```bash
git add scripts/music-catalog
git commit -m "feat: 新增可扩展授权音乐目录接口"
```

### Task 2: 不可变音乐许可证收据

**Files:**
- Create: `scripts/music-license-ledger.mjs`
- Create: `scripts/music-license-ledger.test.mjs`

**Interfaces:**
- Produces: `putMusicLicense(root: string, receipt: object): Promise<object>`
- Produces: `getMusicLicense(root: string, receiptKey: string): Promise<object>`
- Produces: `validateMusicUse(receipt: object, use: {commercial:boolean,paid_ad:boolean,client_project:boolean,broadcast:boolean,platform?:string}): void`

- [ ] **Step 1: Write failing license tests**

```js
test('Pixabay 收据必须保存来源和 Content ID 风险', async () => {
  await assert.rejects(putMusicLicense(root, { ...pixabayReceipt, source_url: '', content_id_risk: null }), /source_url|content_id_risk/)
})
test('Uppbeat Basic 不得用于未覆盖的付费广告', () => {
  assert.throws(() => validateMusicUse({ ...uppbeatBasic, allowed_uses: ['online-video'] }, { commercial: true, paid_ad: true, client_project: false, broadcast: false }), /paid_ad/)
})
test('收据不可覆盖', async () => {
  await putMusicLicense(root, receipt)
  await assert.rejects(putMusicLicense(root, receipt), /已存在/)
})
```

- [ ] **Step 2: Run test and verify red**

Run: `node --test scripts/music-license-ledger.test.mjs`  
Expected: FAIL with missing ledger.

- [ ] **Step 3: Implement exact receipt contract**

```js
const fields = ['receipt_key','catalog','track_id','title','creator','source_url','license_name','license_url','downloaded_at','attribution_required','attribution_text','content_id_risk','allowed_uses','proof_path']
export async function putMusicLicense(rootArg, receipt) {
  exactKeys(receipt, fields, 'music license receipt')
  if (!/^music-license-[a-z0-9-]+$/.test(receipt.receipt_key)) throw new Error('receipt_key 无效')
  if (!/^https:\/\//.test(receipt.source_url) || !/^https:\/\//.test(receipt.license_url)) throw new Error('许可证来源必须是 HTTPS')
  if (typeof receipt.content_id_risk !== 'boolean') throw new Error('content_id_risk 必须明确为布尔值')
  const path = resolve(rootArg, '.short-drama', 'music-licenses', `${receipt.receipt_key}.json`)
  await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' })
  return receipt
}
```

Validate `proof_path` stays inside the project when present. Do not save cookies, account names, access tokens or payment information.

- [ ] **Step 4: Run license tests**

Run: `node --test scripts/music-license-ledger.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/music-license-ledger.mjs scripts/music-license-ledger.test.mjs
git commit -m "feat: 保存不可变音乐许可证凭证"
```

### Task 3: 音乐目录 MCP 与授权导入

**Files:**
- Modify: `scripts/generation/mcp.mjs`
- Create: `scripts/music-catalog-mcp.test.mjs`
- Modify: `scripts/asset-ledger.mjs`

**Interfaces:**
- Produces MCP: `list_music_catalogs`
- Produces MCP: `search_music_catalog`
- Produces MCP: `register_licensed_music`
- Consumes: `putMusicLicense`, `putAsset`, `addAssetVersion`

- [ ] **Step 1: Write failing MCP tests**

```js
test('搜索目录是只读操作', async () => {
  const result = await call('search_music_catalog', { catalog: 'pixabay', purpose: 'bgm', dramatic_function: '追逐升级', pace: 'fast', dialogue_density: 'low', duration_seconds: 20 })
  assert.equal(result.mode, 'browser')
  assert.equal(existsSync(resolve(root, '.short-drama', 'assets.json')), false)
})
test('导入必须同时登记收据和音频资产', async () => {
  const result = await call('register_licensed_music', licensedImport)
  assert.match(result.version_id, /^v\d{3}$/)
  assert.equal((await getMusicLicense(root, licensedImport.receipt.receipt_key)).track_id, licensedImport.receipt.track_id)
})
```

- [ ] **Step 2: Run test and verify red**

Run: `node --test scripts/music-catalog-mcp.test.mjs`  
Expected: FAIL because tools are absent.

- [ ] **Step 3: Register tools and atomic import ordering**

`register_licensed_music` requires `project_root,target,local_file,receipt,usage_scope,rights_confirmed:true,confirmed:true`. Probe an audio stream before writing. Save the license receipt first, then import the audio with provenance parameters `{music_license_receipt,usage_scope}`; if asset import fails, keep the receipt as evidence but return failure and do not create a selected asset.

```js
['register_licensed_music', '把用户已下载且获授权的音乐文件及许可证凭证登记到本地资产库。', {
  project_root: { type: 'string' }, target: { type: 'string', pattern: '^audio-' }, local_file: { type: 'string' }, receipt: { type: 'object' }, usage_scope: { type: 'string' }, rights_confirmed: { const: true }, confirmed: { const: true },
}, ['project_root','target','local_file','receipt','usage_scope','rights_confirmed','confirmed']]
```

- [ ] **Step 4: Run MCP and asset checks**

Run: `node --test scripts/music-catalog-mcp.test.mjs && node scripts/generation/mcp.mjs --self-check && node scripts/asset-ledger.mjs --self-check`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/generation/mcp.mjs scripts/music-catalog-mcp.test.mjs scripts/asset-ledger.mjs
git commit -m "feat: 支持授权音乐搜索与导入"
```

### Task 4: Audio plan 和时间线授权门禁

**Files:**
- Modify: `scripts/project-store.mjs`
- Modify: `scripts/document-reference.mjs`
- Modify: `scripts/editing-store.mjs`
- Create: `scripts/licensed-music-flow.test.mjs`

**Interfaces:**
- Produces track discriminator: `source_mode: 'generated'|'catalog'`
- Produces catalog binding: `source_asset`, `license_receipt`, `intended_use`
- Consumes: `validateAudioPlan(document, episodeKey)` from `scripts/audio-plan-contract.mjs`

- [ ] **Step 1: Write failing plan/timeline tests**

```js
test('catalog 曲目必须绑定资产和许可证', () => {
  assert.throws(() => validateAudioPlan(planWith({ source_mode: 'catalog', source_asset: null, license_receipt: null })), /许可证|资产/)
})
test('许可证不覆盖项目用途时拒绝时间线', async () => {
  await assert.rejects(validateTimeline(root, timelineUsingUppbeatBasicInPaidAd), /许可证用途/)
})
```

- [ ] **Step 2: Run test and verify red**

Run: `node --test scripts/licensed-music-flow.test.mjs`  
Expected: FAIL.

- [ ] **Step 3: Add discriminated music-track validation**

Read old tracks without `source_mode` as `generated`, but newly saved tracks must include it. `generated` retains prompt/tags/lyrics/provider/model. `catalog` requires selected `source_asset`, `license_receipt`, `intended_use`, `matched_shots`, while prompt fields are absent. Update `document-reference` so `generate_music` only accepts generated tracks. Update `editing-store` so catalog BGM must reference the exact selected audio version and a compatible receipt.

- [ ] **Step 4: Run flow regression**

Run: `node --test scripts/licensed-music-flow.test.mjs && node scripts/project-store.mjs --self-check && node scripts/editing-store.mjs --self-check`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/project-store.mjs scripts/document-reference.mjs scripts/editing-store.mjs scripts/licensed-music-flow.test.mjs
git commit -m "feat: 校验短剧配乐资产与授权范围"
```

### Task 5: 配乐 Skill、来源说明与审计

**Files:**
- Modify: `skills/design-drama-audio/SKILL.md`
- Modify: `skills/edit-drama-timeline/SKILL.md`
- Modify: `references/pipeline.md`
- Modify: `references/feature-completeness.md`
- Create: `references/music-catalog-providers.md`
- Modify: `scripts/audit-plugin.mjs`

**Interfaces:**
- Documents `music.generate`, `music.catalog` and the four catalog providers

- [ ] **Step 1: Add failing plugin audit requirements**

Require `local-licensed`, `pixabay`, `youtube-audio-library`, `uppbeat`, `music.catalog`, `content_id_risk`, `license_receipt`, `register_licensed_music`, and the explicit prohibition on ordinary YouTube extraction and unlicensed commercial hits.

- [ ] **Step 2: Run audit and verify red**

Run: `node scripts/audit-plugin.mjs --self-check`  
Expected: FAIL until documentation coverage exists.

- [ ] **Step 3: Document practical selection flow**

For each site document the official entry, login behavior, attribution, Content ID risk, allowed-use verification and manual download/import boundary. Describe how `dramatic_function`, pace, dialogue density and duration compile into search terms, and how the user previews before importing.

- [ ] **Step 4: Run all music checks**

Run:

```bash
node --test scripts/music-catalog/providers.test.mjs scripts/music-license-ledger.test.mjs scripts/music-catalog-mcp.test.mjs scripts/licensed-music-flow.test.mjs
node scripts/integration-self-check.mjs
node scripts/audit-plugin.mjs --self-check
git diff --check
```

Expected: PASS without logging into or downloading from external sites.

- [ ] **Step 5: Commit**

```bash
git add skills/design-drama-audio/SKILL.md skills/edit-drama-timeline/SKILL.md references/pipeline.md references/feature-completeness.md references/music-catalog-providers.md scripts/audit-plugin.mjs
git commit -m "docs: 加入授权配乐选择与使用流程"
```
