# 连续性与首尾帧实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增可批准的跨镜空间连续性计划，并把上一镜 selected 视频的真实尾帧安全绑定为下一镜首帧。

**Architecture:** `continuity-plan.mjs` 负责纯数据校验和相邻状态比较；`previous-tail.mjs` 负责从 selected 视频派生尾帧资产。项目存储、资产账本和视频引用校验各自维持现有职责，通过版本引用与 SHA-256 连接。

**Tech Stack:** Node.js ESM、Node test runner、FFmpeg、现有 project/asset/review ledgers。

**Spec:** `docs/superpowers/specs/2026-09-16-continuity-audio-media-pipeline-design.md` 第 5–6 节

## Global Constraints

- `previous-tail` 只对同场景、同 `camera_setup_id`、同轴线侧且时间连续的镜头自动建议。
- 第一镜只能是 `independent`；正反打、插入镜、跳切和跳时空不得自动继承尾帧。
- 尾帧必须来自上一镜当前 selected 且已批准的视频文件，不得来自分镜图或缩略图。
- 上一镜换版后，尾帧资产、下一镜提示词和依赖视频必须失效。
- 派生文件不得覆盖源视频；测试只写临时目录。

---

### Task 1: 连续性计划纯合同

**Files:**
- Create: `scripts/continuity-plan.mjs`
- Create: `scripts/continuity-plan.test.mjs`
- Modify: `scripts/project-store.mjs`

**Interfaces:**
- Produces: `validateContinuityPlan(document: object, episodeKey: string): void`
- Produces: `compareAdjacentStates(previous: object, current: object): Array<{field:string,reason:string}>`
- Produces: `recommendTailLink(previous: object, current: object): {recommended:boolean,reasons:string[]}`

- [ ] **Step 1: Write the failing contract tests**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { compareAdjacentStates, recommendTailLink, validateContinuityPlan } from './continuity-plan.mjs'

const actor = (zone, held = []) => ({ actor_key: 'char-a', zone, depth: 'mid', facing: 'right', eyeline_target: 'char-b', screen_direction: 'right', entry_edge: null, exit_edge: null, posture: 'standing', held_props: held })
const shot = (number, start, end, camera = 'cam-a') => ({ shot_number: number, scene_key: 'scene-001', camera_setup_id: camera, start_state: { actors: [start], props: [], axis_id: 'axis-a', camera_side: 'north', lighting_anchor: 'window-left' }, end_state: { actors: [end], props: [], axis_id: 'axis-a', camera_side: 'north', lighting_anchor: 'window-left' }, transition_link: number === 1 ? { mode: 'independent', enabled: false, reason: '首镜建立空间' } : { mode: 'previous-tail', source_shot_number: 1, source_camera_setup_id: 'cam-a', enabled: true, reason: '承接动作', required_provider_capability: 'video.first-frame' }, inherited_fields: ['actors', 'axis_id', 'camera_side', 'lighting_anchor'], allowed_changes: [], evidence: ['scene-001'] })

test('同机位连续状态可建议尾帧继承', () => {
  assert.deepEqual(recommendTailLink(shot(1, actor('left'), actor('center')), shot(2, actor('center'), actor('right'))), { recommended: true, reasons: [] })
})

test('无证据持物跳变会阻塞', () => {
  assert.match(compareAdjacentStates(shot(1, actor('left'), actor('center', ['prop-knife'])), shot(2, actor('center'), actor('right')))[0].field, /held_props/)
})

test('第一镜 previous-tail 被拒绝', () => {
  const document = { episode_key: 'ep-001', source_versions: { storyboard: 'v001', 'director-book': 'v001', 'production-plan': 'v001' }, scenes: [], shots: [shot(2, actor('left'), actor('right'))], unresolved: [], approved: true }
  assert.throws(() => validateContinuityPlan(document, 'ep-001'), /第一镜/)
})
```

- [ ] **Step 2: Run tests and verify red**

Run: `node --test scripts/continuity-plan.test.mjs`  
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `continuity-plan.mjs`.

- [ ] **Step 3: Implement the pure validator and recommendation rules**

```js
const POSITION_FIELDS = ['zone', 'depth', 'facing', 'eyeline_target', 'screen_direction', 'entry_edge', 'exit_edge', 'posture', 'held_props']

export function compareAdjacentStates(previous, current) {
  const allowed = new Set(current.allowed_changes || [])
  const before = new Map(previous.end_state.actors.map((actor) => [actor.actor_key, actor]))
  const issues = []
  for (const actor of current.start_state.actors) for (const field of POSITION_FIELDS) {
    if (JSON.stringify(before.get(actor.actor_key)?.[field]) !== JSON.stringify(actor[field]) && !allowed.has(`actors.${actor.actor_key}.${field}`)) issues.push({ field: `actors.${actor.actor_key}.${field}`, reason: '上一镜结束状态与下一镜开始状态不一致且没有允许变化' })
  }
  return issues
}

export function recommendTailLink(previous, current) {
  const reasons = []
  if (previous.scene_key !== current.scene_key) reasons.push('scene_changed')
  if (previous.camera_setup_id !== current.camera_setup_id) reasons.push('camera_changed')
  if (previous.end_state.axis_id !== current.start_state.axis_id || previous.end_state.camera_side !== current.start_state.camera_side) reasons.push('axis_changed')
  reasons.push(...compareAdjacentStates(previous, current).map((item) => item.field))
  return { recommended: reasons.length === 0, reasons }
}
```

Add exact-key validation for the top-level, scene, shot, state and actor contracts; reject approved documents with `unresolved` or adjacency issues. Add `continuity-plan` to `project-store.mjs` document contracts and its self-check fixture.

- [ ] **Step 4: Run focused and store tests**

Run: `node --test scripts/continuity-plan.test.mjs && node scripts/project-store.mjs --self-check`  
Expected: all tests PASS and both commands print no contract error.

- [ ] **Step 5: Commit**

```bash
git add scripts/continuity-plan.mjs scripts/continuity-plan.test.mjs scripts/project-store.mjs
git commit -m "feat: 新增跨镜空间连续性合同"
```

### Task 2: 资产账本编程接口与来源失效

**Files:**
- Modify: `scripts/asset-ledger.mjs`
- Create: `scripts/asset-ledger-api.test.mjs`
- Modify: `scripts/invalidate-workflow.mjs`

**Interfaces:**
- Produces: `putAsset(root: string, record: object): Promise<object>`
- Produces: `addAssetVersion(root: string, key: string, version: object): Promise<object>`
- Produces: `selectedAssetVersion(root: string, key: string): Promise<{asset:object,version:object,path:string}>`
- Produces: `invalidateDerivedAssets(root: string, source: {key:string,version_id:string}): Promise<string[]>`

- [ ] **Step 1: Write failing API and invalidation tests**

```js
test('来源换版使尾帧及其下游视频失效', async () => {
  await putAsset(root, { key: 'shot-ep001-001', type: 'video', name: '镜头 1' })
  await addAssetVersion(root, 'shot-ep001-001', generatedVideo('v001'))
  await putAsset(root, { key: 'other-transition-ep001-002', type: 'other', name: '镜头 2 首帧' })
  await addAssetVersion(root, 'other-transition-ep001-002', transformedFrame('v001', 'shot-ep001-001', 'v001'))
  assert.deepEqual(await invalidateDerivedAssets(root, { key: 'shot-ep001-001', version_id: 'v001' }), ['other-transition-ep001-002@v001'])
})
```

- [ ] **Step 2: Run test and verify red**

Run: `node --test scripts/asset-ledger-api.test.mjs`  
Expected: FAIL because the four exported functions do not exist.

- [ ] **Step 3: Extract CLI logic into exported functions**

Move the existing `put` and `add-version` bodies without changing validation into `putAsset` and `addAssetVersion`; keep CLI commands as thin callers. Implement `selectedAssetVersion` with stale, existence, standard-path and SHA-256 checks. Implement transitive invalidation by repeatedly finding versions whose `provenance.source_assets` contains a newly stale source.

```js
export async function invalidateDerivedAssets(rootArg, source) {
  const root = resolve(rootArg)
  return withFileLock(ledgerPath(root), async () => {
    const ledger = await readLedger(root)
    const queue = [`${source.key}@${source.version_id}`]
    const stale = []
    for (let index = 0; index < queue.length; index += 1) for (const asset of Object.values(ledger.assets)) for (const version of asset.versions) {
      if (!(version.provenance?.source_assets || []).some((item) => `${item.key}@${item.version_id}` === queue[index])) continue
      asset.staleVersionIds ||= []
      if (asset.staleVersionIds.includes(version.id)) continue
      asset.staleVersionIds.push(version.id); stale.push(`${asset.key}@${version.id}`); queue.push(`${asset.key}@${version.id}`)
      if (asset.selectedVersionId === version.id) asset.selectedVersionId = null
    }
    await save(root, ledger)
    return stale
  })
}
```

- [ ] **Step 4: Run focused and ledger self-checks**

Run: `node --test scripts/asset-ledger-api.test.mjs && node scripts/asset-ledger.mjs --self-check && node scripts/task-ledger.mjs --self-check`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/asset-ledger.mjs scripts/asset-ledger-api.test.mjs scripts/invalidate-workflow.mjs
git commit -m "refactor: 开放派生资产与失效接口"
```

### Task 3: 尾帧派生服务

**Files:**
- Modify: `scripts/media-tools.mjs`
- Create: `scripts/previous-tail.mjs`
- Create: `scripts/previous-tail.test.mjs`

**Interfaces:**
- Consumes: `selectedAssetVersion`, `putAsset`, `addAssetVersion`, `validateContinuityPlan`
- Produces: `extractFrame(input: string, output: string, position: 'first'|'last'|number): void`
- Produces: `preparePreviousTail(input): Promise<{asset_key:string,version_id:string,local_path:string,source_sha256:string}>`

- [ ] **Step 1: Write failing end-to-end tail extraction test**

Use FFmpeg `lavfi color` to create a 24 fps two-second MP4 in a temporary project, register and select it, save a selected approved continuity plan whose shot 2 links shot 1, then assert:

```js
const result = await preparePreviousTail({ projectRoot: root, episodeKey: 'ep-001', shotNumber: 2, continuityVersion: 'v001' })
assert.equal(result.asset_key, 'other-transition-ep001-002')
assert.match(result.version_id, /^v\d{3}$/)
assert.equal((await selectedAssetVersion(root, result.asset_key)).version.provenance.source_assets[0].key, 'shot-ep001-001')
```

- [ ] **Step 2: Run test and verify red**

Run: `node --test scripts/previous-tail.test.mjs`  
Expected: FAIL with missing `previous-tail.mjs`.

- [ ] **Step 3: Export deterministic extraction and implement preparation**

```js
export async function preparePreviousTail({ projectRoot, episodeKey, shotNumber, continuityVersion }) {
  const plan = await readSelectedContinuityPlan(projectRoot, episodeKey, continuityVersion)
  const link = plan.shots.find((shot) => shot.shot_number === shotNumber)?.transition_link
  if (link?.mode !== 'previous-tail' || link.enabled !== true) throw new Error('目标镜头没有启用 previous-tail')
  const sourceKey = `shot-${episodeKey.replace('-', '')}-${String(link.source_shot_number).padStart(3, '0')}`
  const source = await selectedAssetVersion(projectRoot, sourceKey)
  await requireApprovedReview(projectRoot, sourceKey, source.version.id)
  const key = `other-transition-${episodeKey.replace('-', '')}-${String(shotNumber).padStart(3, '0')}`
  const versionId = await nextAssetVersion(projectRoot, key)
  const output = resolve(projectRoot, 'assets', 'other', key, `${versionId}.png`)
  extractFrame(source.path, output, 'last')
  await putAsset(projectRoot, { key, type: 'other', name: `镜头 ${shotNumber} 继承首帧` })
  await addAssetVersion(projectRoot, key, { id: versionId, localPath: relative(projectRoot, output), provenance: { origin: 'transformed', created_by: 'codex', provider: null, model_or_workflow: 'ffmpeg-extract-frame', task_id: null, prompt_document: { kind: 'continuity-plan', episode_key: episodeKey, version_id: continuityVersion, shot_number: shotNumber }, source_assets: [{ key: sourceKey, version_id: source.version.id }], parameters: { position: 'last', source_sha256: source.version.sha256 } } })
  return { asset_key: key, version_id: versionId, local_path: relative(projectRoot, output), source_sha256: source.version.sha256 }
}
```

Extend `validDocumentReferenceShape` in the implementation if `continuity-plan` references are stored in provenance; the exact shape is `{kind,episode_key,version_id,shot_number}`.

- [ ] **Step 4: Run media and tail tests**

Run: `node scripts/media-tools.mjs --self-check && node --test scripts/previous-tail.test.mjs`  
Expected: PASS and extracted PNG is inside the temporary project only.

- [ ] **Step 5: Commit**

```bash
git add scripts/media-tools.mjs scripts/previous-tail.mjs scripts/previous-tail.test.mjs scripts/document-reference.mjs
git commit -m "feat: 支持从选中视频派生尾帧资产"
```

### Task 4: MCP 与视频提示词首帧绑定

**Files:**
- Modify: `scripts/generation/mcp.mjs`
- Modify: `scripts/reference-bindings.mjs`
- Modify: `scripts/project-store.mjs`
- Modify: `skills/write-drama-video-prompts/SKILL.md`
- Modify: `skills/write-drama-video-prompts/assets/prompts/seedance2_video.zh.txt`
- Modify: `skills/write-drama-video-prompts/assets/prompts/seedance2_video.en.txt`
- Modify: `skills/write-drama-video-prompts/assets/prompts/h3_video.zh.txt`
- Modify: `skills/write-drama-video-prompts/assets/prompts/h3_video.en.txt`
- Create: `scripts/previous-tail-binding.test.mjs`

**Interfaces:**
- Consumes: `preparePreviousTail(input)`
- Produces MCP: `prepare_previous_tail`
- Produces: `validatePreviousTailBinding(root, shot, manifest): Promise<void>`

- [ ] **Step 1: Write failing binding tests**

```js
test('previous-tail 必须是第一个 image/first_frame 引用', async () => {
  await assert.rejects(validatePreviousTailBinding(root, shot, [{ type: 'image', order: 1, asset_key: 'board-ep001-002', version_id: 'v001', role: 'reference_image' }]), /first_frame/)
})

test('不支持首帧能力的模型被提交前拒绝', async () => {
  await assert.rejects(call('submit_video', unsupportedInput), /video.first-frame/)
})
```

- [ ] **Step 2: Run tests and verify red**

Run: `node --test scripts/previous-tail-binding.test.mjs`  
Expected: FAIL because MCP and validator do not exist.

- [ ] **Step 3: Add MCP schema and strict binding**

Add this MCP schema and route it before paid generation routing:

```js
['prepare_previous_tail', '从上一镜当前选中且通过审核的视频提取尾帧，并登记为下一镜首帧资产。', {
  project_root: { type: 'string' }, episode_key: { type: 'string', pattern: '^ep-\\d{3}$' }, shot_number: { type: 'integer', minimum: 2 }, continuity_version: { type: 'string', pattern: '^v\\d{3}$' },
}, ['project_root', 'episode_key', 'shot_number', 'continuity_version']]
```

When `shot.continuity.mode === 'previous-tail'`, require `input_mode` `first-last-frame`, `I2VA`, or `FL2VA`; require the transition asset as the first image entry with role `first_frame`; compare its provenance source version and SHA-256 with the current selected previous shot.

- [ ] **Step 4: Update prompt contracts and run full focused checks**

Prompt contracts must say that `previous-tail` inherits exact position, posture, movement, held props, light and axis; it must not re-establish the scene. Run:

```bash
node --test scripts/previous-tail-binding.test.mjs
node scripts/generation/mcp.mjs --self-check
node scripts/project-store.mjs --self-check
node scripts/audit-plugin.mjs --self-check
```

Expected: all PASS; audit reports `status:"covered"`.

- [ ] **Step 5: Commit**

```bash
git add scripts/generation/mcp.mjs scripts/reference-bindings.mjs scripts/project-store.mjs skills/write-drama-video-prompts scripts/previous-tail-binding.test.mjs
git commit -m "feat: 接通上一镜尾帧到下一镜首帧"
```

### Task 5: 连续性 Skill 与专项审计

**Files:**
- Create: `skills/plan-shot-continuity/SKILL.md`
- Create: `skills/plan-shot-continuity/agents/openai.yaml`
- Create: `skills/plan-shot-continuity/assets/prompts/continuity_plan.zh.txt`
- Create: `skills/plan-shot-continuity/assets/prompts/continuity_plan.en.txt`
- Modify: `skills/build-drama-storyboard/SKILL.md`
- Modify: `skills/review-drama-shots/SKILL.md`
- Modify: `references/pipeline.md`
- Modify: `references/feature-completeness.md`
- Modify: `references/skill-map.json`
- Modify: `scripts/audit-plugin.mjs`

**Interfaces:**
- Consumes: approved storyboard, director-book and production-plan versions
- Produces: selected approved `continuity-plan/vNNN.json`

- [ ] **Step 1: Add an audit failure for missing skill coverage**

Extend `audit-plugin.mjs` to require the new skill, bilingual prompts, `previous-tail`, `camera_setup_id`, `start_state`, `end_state`, `prepare_previous_tail`, and pipeline placement between production planning and video prompt compilation.

- [ ] **Step 2: Run audit and verify red**

Run: `node scripts/audit-plugin.mjs --self-check`  
Expected: FAIL listing the missing continuity skill files or tokens.

- [ ] **Step 3: Add the atomic skill and workflow documentation**

The skill must instruct Codex to build semantic positions from evidence, copy Blender coordinates only when an approved previz contract provides them, call `recommendTailLink`, record every unexplained mismatch in `unresolved`, save with `project-store`, and explicitly select the approved version. It must never infer props, entrances or exact metric coordinates.

- [ ] **Step 4: Run all stage-1 checks**

Run:

```bash
node --test scripts/continuity-plan.test.mjs scripts/asset-ledger-api.test.mjs scripts/previous-tail.test.mjs scripts/previous-tail-binding.test.mjs
node scripts/integration-self-check.mjs
node scripts/audit-plugin.mjs --self-check
git diff --check
```

Expected: every command PASS; integration self-check must leave no files outside its temporary project.

- [ ] **Step 5: Commit**

```bash
git add skills/plan-shot-continuity skills/build-drama-storyboard/SKILL.md skills/review-drama-shots/SKILL.md references/pipeline.md references/feature-completeness.md references/skill-map.json scripts/audit-plugin.mjs
git commit -m "feat: 加入跨镜连续性规划与审计流程"
```

