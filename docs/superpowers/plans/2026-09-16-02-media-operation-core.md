# 媒体操作核心实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用统一 MCP、任务快照、派生资产和专项审核承载本地修复、对口型、局部重绘及视频超分。

**Architecture:** `media-operation-contract.mjs` 只负责参数和能力校验；`media-operations.mjs` 执行确定性 FFmpeg 操作或调用 Provider 的 `transform` 方法。MCP 负责项目门禁和任务登记，资产账本负责不可变输出，审核账本负责按操作类型放行。

**Tech Stack:** Node.js ESM、Node test runner、FFmpeg/FFprobe、JSON-RPC MCP、现有 task/asset/review ledgers。

**Spec:** `docs/superpowers/specs/2026-09-16-continuity-audio-media-pipeline-design.md` 第 10、12–13 节

## Global Constraints

- 操作枚举固定为 `trim|replace-audio|stabilize|denoise|color-match|mask-blur|frame-interpolate|lip-sync|video-inpaint|video-upscale`。
- 所有输入必须是当前 selected 且未失效的本地资产版本。
- 操作结果必须创建新版本并保存来源 key/version、来源 SHA-256、操作参数和任务 ID。
- 局部操作必须给出毫秒时间范围；遮罩类操作必须绑定本地 selected 遮罩资产。
- Provider 未声明对应细粒度能力时必须在远端提交前失败。

---

### Task 1: 媒体操作合同与 Provider 细粒度能力

**Files:**
- Create: `scripts/media-operation-contract.mjs`
- Create: `scripts/media-operation-contract.test.mjs`
- Modify: `scripts/generation/providers.mjs`
- Modify: `scripts/generation/runninghub.mjs`
- Modify: `scripts/generation/starrouter.mjs`
- Modify: `scripts/generation/bailian.mjs`
- Modify: `scripts/generation/comfly.mjs`

**Interfaces:**
- Produces: `operationCapability(operation: string): string`
- Produces: `validateMediaOperation(input: object): object`
- Produces: `providerSupports(providerName: string, capability: string): boolean`

- [ ] **Step 1: Write failing contract tests**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { operationCapability, validateMediaOperation } from './media-operation-contract.mjs'
import { providerSupports } from './generation/providers.mjs'

test('超分映射到细粒度 Provider 能力', () => {
  assert.equal(operationCapability('video-upscale'), 'transform.video-upscale')
})

test('局部遮罩操作缺少范围和遮罩时拒绝', () => {
  assert.throws(() => validateMediaOperation({ operation: 'mask-blur', source: { asset_key: 'shot-ep001-001', version_id: 'v001' }, parameters: {} }), /时间范围|遮罩/)
})

test('旧 video 布尔能力不能冒充 upscale', () => {
  assert.equal(providerSupports('starrouter', 'transform.video-upscale'), false)
})
```

- [ ] **Step 2: Run test and verify red**

Run: `node --test scripts/media-operation-contract.test.mjs`  
Expected: FAIL with missing module or export.

- [ ] **Step 3: Implement the discriminated contract**

```js
export const MEDIA_OPERATIONS = new Set(['trim', 'replace-audio', 'stabilize', 'denoise', 'color-match', 'mask-blur', 'frame-interpolate', 'lip-sync', 'video-inpaint', 'video-upscale'])
const CAPABILITIES = { 'lip-sync': 'transform.lip-sync', 'video-inpaint': 'transform.video-inpaint', 'video-upscale': 'transform.video-upscale' }
export const operationCapability = (operation) => CAPABILITIES[operation] || 'transform.local'

export function validateMediaOperation(value) {
  if (!MEDIA_OPERATIONS.has(value?.operation)) throw new Error('媒体操作类型无效')
  if (!/^[-a-z0-9]+$/.test(value.source?.asset_key || '') || !/^v\d{3}$/.test(value.source?.version_id || '')) throw new Error('媒体操作必须绑定来源资产版本')
  if (!value.parameters || typeof value.parameters !== 'object' || Array.isArray(value.parameters)) throw new Error('媒体操作 parameters 必须是对象')
  if (['trim', 'replace-audio', 'mask-blur', 'lip-sync', 'video-inpaint'].includes(value.operation) && !(Number.isInteger(value.range?.start_ms) && Number.isInteger(value.range?.end_ms) && value.range.start_ms >= 0 && value.range.end_ms > value.range.start_ms)) throw new Error('局部媒体操作必须提供有效时间范围')
  if (['mask-blur', 'video-inpaint'].includes(value.operation) && !value.mask?.asset_key) throw new Error('遮罩媒体操作必须绑定遮罩资产')
  return structuredClone(value)
}
```

Normalize each adapter’s capability object to dotted keys while retaining the existing `image/video/audio` fields for one version. `providerSupports` must only inspect the dotted key for new operations.

- [ ] **Step 4: Run contract and provider checks**

Run: `node --test scripts/media-operation-contract.test.mjs && node scripts/generation/providers.mjs --self-check && node scripts/generation/mcp.mjs --self-check`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/media-operation-contract.mjs scripts/media-operation-contract.test.mjs scripts/generation/providers.mjs scripts/generation/{runninghub,starrouter,bailian,comfly}.mjs
git commit -m "refactor: 细化媒体生成与变换能力"
```

### Task 2: 请求快照和任务账本支持媒体操作

**Files:**
- Modify: `scripts/task-ledger.mjs`
- Modify: `scripts/task-sync.mjs`
- Create: `scripts/media-operation-ledger.test.mjs`

**Interfaces:**
- Consumes: `validateMediaOperation(input)`
- Produces request tool: `submit_media_operation`
- Produces provenance parameters: `{operation,range,mask,parameters,source_sha256}`

- [ ] **Step 1: Write failing ledger test**

```js
test('媒体操作快照保留来源且完成资产必须一致', async () => {
  const snapshot = await createRequestSnapshot(root, { tool: 'submit_media_operation', target: 'shot-ep001-001', type: 'video', provider: 'local', modelOrWorkflow: 'ffmpeg', promptDocument: null, arguments: { operation: 'stabilize', source: { asset_key: 'shot-ep001-001', version_id: 'v001' }, parameters: { shakiness: 5 } } })
  assert.match(snapshot.requestId, /^req-/)
  const request = JSON.parse(await readFile(resolve(root, snapshot.requestPath), 'utf8'))
  assert.equal(request.arguments.operation, 'stabilize')
})
```

- [ ] **Step 2: Run test and verify red**

Run: `node --test scripts/media-operation-ledger.test.mjs`  
Expected: FAIL with `请求工具无效：submit_media_operation`.

- [ ] **Step 3: Extend snapshot and completion validation**

Allow `submit_media_operation` in `createRequestSnapshot`. Update `validateTaskOutput` so media operations always compare `request.arguments.source` and optional mask/audio references with `provenance.source_assets`, and require `provenance.origin === 'transformed'`.

```js
if (request.tool === 'submit_media_operation') {
  if (provenance.origin !== 'transformed') throw new Error('媒体操作输出必须是 transformed 资产')
  const expected = [request.arguments.source, request.arguments.audio, request.arguments.mask].filter(Boolean).map((item) => ({ key: item.asset_key, version_id: item.version_id }))
  if (JSON.stringify(expected) !== JSON.stringify(provenance.source_assets)) throw new Error('媒体操作来源与 provenance 不一致')
}
```

- [ ] **Step 4: Run ledger regression**

Run: `node --test scripts/media-operation-ledger.test.mjs && node scripts/task-ledger.mjs --self-check && node scripts/task-sync.mjs --self-check`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/task-ledger.mjs scripts/task-sync.mjs scripts/media-operation-ledger.test.mjs
git commit -m "feat: 记录媒体操作任务与来源证据"
```

### Task 3: 确定性本地修复执行器

**Files:**
- Create: `scripts/media-operations.mjs`
- Create: `scripts/media-operations.test.mjs`
- Modify: `scripts/media-tools.mjs`

**Interfaces:**
- Consumes: `selectedAssetVersion`, `addAssetVersion`, `validateMediaOperation`
- Produces: `executeLocalMediaOperation(root: string, request: object): Promise<{output_path:string,probe:object}>`
- Produces: `operationOutputPath(root: string, target: string, versionId: string, extension: string): string`

- [ ] **Step 1: Write failing FFmpeg operation tests**

Generate a two-second 640×360 video with audio in a temporary project. Assert that `trim` outputs one second, `replace-audio` retains video, and `mask-blur` rejects a range outside source duration.

```js
const result = await executeLocalMediaOperation(root, { operation: 'trim', source: { asset_key: key, version_id: 'v001' }, range: { start_ms: 250, end_ms: 1250 }, parameters: {} })
assert.ok(Math.abs(result.probe.duration_ms - 1000) <= 50)
assert.notEqual(resolve(result.output_path), sourcePath)
```

- [ ] **Step 2: Run tests and verify red**

Run: `node --test scripts/media-operations.test.mjs`  
Expected: FAIL with missing executor.

- [ ] **Step 3: Implement explicit FFmpeg argument builders**

Use `spawnSync('ffmpeg', args)` with arrays only; never construct a shell string. Each operation gets its own builder and an allowlist of numeric/string parameters.

```js
const builders = {
  trim: ({ input, output, range }) => ['-nostdin', '-y', '-ss', String(range.start_ms / 1000), '-to', String(range.end_ms / 1000), '-i', input, '-map', '0', '-c:v', 'libx264', '-c:a', 'aac', output],
  denoise: ({ input, output, parameters }) => ['-nostdin', '-y', '-i', input, '-vf', `hqdn3d=${number(parameters.luma, 1.5, 0, 10)}`, '-c:v', 'libx264', '-c:a', 'copy', output],
  'frame-interpolate': ({ input, output, parameters }) => ['-nostdin', '-y', '-i', input, '-vf', `minterpolate=fps=${integer(parameters.fps, 48, 1, 120)}`, '-c:v', 'libx264', '-c:a', 'copy', output],
}
```

Implement stabilize as an explicit two-pass operation with a temporary transforms file; remove it in `finally`. Probe input and output, reject overwrite, duration drift outside the operation’s declared behavior, missing streams and output outside `assets/videos/<target>/`.

- [ ] **Step 4: Run local operation and media checks**

Run: `node --test scripts/media-operations.test.mjs && node scripts/media-tools.mjs --self-check`  
Expected: PASS on systems with FFmpeg; missing required FFmpeg filter must return a named capability error rather than partial output.

- [ ] **Step 5: Commit**

```bash
git add scripts/media-operations.mjs scripts/media-operations.test.mjs scripts/media-tools.mjs
git commit -m "feat: 新增可追溯的本地视频修复操作"
```

### Task 4: 统一媒体操作 MCP

**Files:**
- Modify: `scripts/generation/mcp.mjs`
- Create: `scripts/media-operation-mcp.test.mjs`
- Modify: `.mcp.json`

**Interfaces:**
- Produces MCP: `submit_media_operation`
- Produces MCP: `get_media_operation`
- Produces MCP: `register_media_operation_output`
- Consumes Provider: `adapter.transform(input): Promise<{task_id,status,media_type,model}>`

- [ ] **Step 1: Write failing MCP schema and call tests**

```js
test('未确认的远端媒体操作只返回摘要且不建任务', async () => {
  const preview = await call('submit_media_operation', { ...upscale, confirmed: false })
  assert.equal(preview.requires_confirmation, true)
  assert.equal((await listTasks(root)).length, 0)
})

test('本地操作不伪造远端任务', async () => {
  const done = await call('submit_media_operation', { ...trim, provider: 'local', confirmed: true })
  assert.equal(done.status, 'completed')
  assert.match(done.output_version_id, /^v\d{3}$/)
})
```

- [ ] **Step 2: Run tests and verify red**

Run: `node --test scripts/media-operation-mcp.test.mjs`  
Expected: FAIL because tools are not registered.

- [ ] **Step 3: Add schemas and routing**

The shared input schema requires `project_root,target,operation,provider,source,parameters,confirmed`; optional `range,audio,mask,model,workflow_id,node_info_list`. `confirmed=false` performs all local validation and returns source, capability, estimated provider and upload summary without writing a request or task. `confirmed=true` executes local operations or uses the existing reserve/settle pattern for Provider transforms.

```js
if (name === 'submit_media_operation') {
  const normalized = await validateProjectMediaOperation(args)
  if (!args.confirmed) return { requires_confirmation: normalized.remote, operation: normalized.operation, source: normalized.source, uploads: normalized.uploads }
  return normalized.remote ? submitProviderOperation(normalized) : executeAndRegisterLocalOperation(normalized)
}
```

`get_media_operation` must reuse Provider task query and `syncTaskResult`; `register_media_operation_output` is only for a completed task whose output has not yet been downloaded, and must validate task/request identity before registration.

- [ ] **Step 4: Run MCP and integration checks**

Run: `node --test scripts/media-operation-mcp.test.mjs && node scripts/generation/mcp.mjs --self-check && node scripts/integration-self-check.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/generation/mcp.mjs scripts/media-operation-mcp.test.mjs .mcp.json
git commit -m "feat: 提供统一媒体修复 MCP"
```

### Task 5: 媒体操作专项审核

**Files:**
- Create: `scripts/media-operation-review.mjs`
- Create: `scripts/media-operation-review.test.mjs`
- Modify: `scripts/review-ledger.mjs`
- Modify: `skills/transform-drama-media/SKILL.md`
- Modify: `skills/edit-drama-timeline/SKILL.md`
- Modify: `references/editing-workflow.md`

**Interfaces:**
- Produces: `validateMediaOperationReview(operation: string, review: object): void`
- Produces MCP/CLI behavior: `review_media_operation`

- [ ] **Step 1: Write failing per-operation review tests**

```js
test('局部修复必须记录范围内和范围外观察', () => {
  assert.throws(() => validateMediaOperationReview('video-inpaint', { approved: true, watched_full: true, observations: { inside_range: '瑕疵消失' } }), /outside_range/)
})

test('超分必须记录分辨率、时长、细节和伪影', () => {
  assert.throws(() => validateMediaOperationReview('video-upscale', { approved: true, watched_full: true, observations: {} }), /resolution/)
})
```

- [ ] **Step 2: Run test and verify red**

Run: `node --test scripts/media-operation-review.test.mjs`  
Expected: FAIL with missing module.

- [ ] **Step 3: Implement review profiles and selection gate**

Define exact required observation keys: local visual repairs require `inside_range,outside_range,identity,temporal_consistency`; lip-sync requires `sync_timing,identity,mouth_artifacts,non_target_faces,duration`; upscale requires `resolution,duration_fps,audio_preservation,faces_hands_text,motion_artifacts,color_crop`. Every approved review also requires full structured QC and `watched_full:true`. Only after validation may it call `selectAssetVersion`.

- [ ] **Step 4: Run review and plugin audits**

Run: `node --test scripts/media-operation-review.test.mjs && node scripts/review-ledger.mjs --self-check && node scripts/audit-plugin.mjs --self-check`  
Expected: PASS and docs name every review profile.

- [ ] **Step 5: Commit**

```bash
git add scripts/media-operation-review.mjs scripts/media-operation-review.test.mjs scripts/review-ledger.mjs skills/transform-drama-media/SKILL.md skills/edit-drama-timeline/SKILL.md references/editing-workflow.md
git commit -m "feat: 增加媒体修复专项审核门禁"
```
