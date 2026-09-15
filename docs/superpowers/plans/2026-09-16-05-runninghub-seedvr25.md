# RunningHub SeedVR2.5 视频高清化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 RunningHub 工作流 `2099866760106491906` 作为命名的 `seedvr2.5-video-upscale` 能力接入统一媒体操作流水线，并完成真实输出审核。

**Architecture:** 一个离线检查器从用户在 RunningHub 官方页面导出的 API JSON 中唯一识别视频输入和保存视频节点，生成可审计映射；RunningHub 适配器复用现有上传、提交、查询和单 Key 并发逻辑。超分输出进入派生资产和专项审核，不覆盖源视频。

**Tech Stack:** Node.js ESM、Node test runner、RunningHub OpenAPI、FFprobe、统一媒体操作 MCP。

**Spec:** `docs/superpowers/specs/2026-09-16-continuity-audio-media-pipeline-design.md` 第 11 节

## Global Constraints

- 工作流 ID 固定为 `2099866760106491906`，命名模型固定为 `seedvr2.5-video-upscale`。
- 必须使用该工作流真实导出的 API JSON；页面不可访问或导出缺失时任务阻塞。
- 不允许用空 `nodeInfoList` 试错、不猜节点、不用其他 SeedVR 工作流冒充。
- 输入必须是当前 selected 且未失效的本地视频资产。
- RunningHub 同一 API Key 最多 2 路提交并发。
- 真实冒烟属于付费并会上传本地视频，执行前必须再次向用户列出输入、节点覆盖和预计费用并取得确认。

---

### Task 1: RunningHub 工作流导出检查器

**Files:**
- Create: `scripts/generation/inspect-runninghub-workflow.mjs`
- Create: `scripts/generation/inspect-runninghub-workflow.test.mjs`
- Create: `scripts/generation/fixtures/seedvr25-workflow-shape.json`

**Interfaces:**
- Produces: `inspectVideoUpscaleWorkflow(workflow: object, workflowId: string): {workflow_id:string,video_input:{node_id:string,field_name:string},video_output:{node_id:string,class_type:string},optional_parameters:object}`
- Produces CLI: `node scripts/generation/inspect-runninghub-workflow.mjs "$SEEDVR25_API_EXPORT" 2099866760106491906 --output scripts/generation/seedvr2.5-video-upscale.mapping.json`

- [ ] **Step 1: Write failing shape tests**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { inspectVideoUpscaleWorkflow } from './inspect-runninghub-workflow.mjs'
import fixture from './fixtures/seedvr25-workflow-shape.json' with { type: 'json' }

test('唯一识别视频输入和保存节点', () => {
  assert.deepEqual(inspectVideoUpscaleWorkflow(fixture, '2099866760106491906'), { workflow_id: '2099866760106491906', video_input: { node_id: '12', field_name: 'video' }, video_output: { node_id: '98', class_type: 'VHS_VideoCombine' }, optional_parameters: {} })
})
test('多个视频输入节点时拒绝猜测', () => {
  assert.throws(() => inspectVideoUpscaleWorkflow({ ...fixture, 13: fixture['12'] }, '2099866760106491906'), /无法唯一识别视频输入节点/)
})
```

The fixture is a minimal synthetic shape containing node 12 `VHS_LoadVideo` with `inputs.video`, a processing node, and node 98 `VHS_VideoCombine`; it is not presented as the real workflow export.

- [ ] **Step 2: Run test and verify red**

Run: `node --test scripts/generation/inspect-runninghub-workflow.test.mjs`  
Expected: FAIL with missing inspector.

- [ ] **Step 3: Implement structural inspection**

```js
const INPUT_CLASSES = /(?:LoadVideo|VHS_LoadVideo|LoadVideoUpload)/i
const OUTPUT_CLASSES = /(?:SaveVideo|VideoCombine|VHS_VideoCombine)/i
const INPUT_FIELDS = ['video', 'file', 'path']

export function inspectVideoUpscaleWorkflow(workflow, workflowId) {
  if (String(workflowId) !== '2099866760106491906') throw new Error('SeedVR2.5 工作流 ID 不一致')
  const nodes = Object.entries(workflow || {}).map(([node_id, node]) => ({ node_id, ...node }))
  const inputs = nodes.flatMap((node) => INPUT_CLASSES.test(node.class_type || '') ? INPUT_FIELDS.filter((field_name) => typeof node.inputs?.[field_name] === 'string').map((field_name) => ({ node_id: node.node_id, field_name })) : [])
  const outputs = nodes.filter((node) => OUTPUT_CLASSES.test(node.class_type || ''))
  if (inputs.length !== 1) throw new Error('无法唯一识别视频输入节点')
  if (outputs.length !== 1) throw new Error('无法唯一识别保存视频节点')
  return { workflow_id: String(workflowId), video_input: inputs[0], video_output: { node_id: outputs[0].node_id, class_type: outputs[0].class_type }, optional_parameters: inspectSafeScalarParameters(nodes) }
}
```

`inspectSafeScalarParameters` may report only scalar fields with recognized names such as `scale`, `upscale_by`, `width`, `height`, `fps`, `tile_size`; it must not automatically override them.

The CLI computes the raw export SHA-256 and export timestamp, then writes the mapping atomically when `--output` is present. It refuses an output path outside the repository and never copies credentials or the full workflow graph into the mapping.

- [ ] **Step 4: Run inspector tests**

Run: `node --test scripts/generation/inspect-runninghub-workflow.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/generation/inspect-runninghub-workflow.mjs scripts/generation/inspect-runninghub-workflow.test.mjs scripts/generation/fixtures/seedvr25-workflow-shape.json
git commit -m "feat: 校验 RunningHub 视频超分工作流导出"
```

### Task 2: 获取并固化真实节点映射

**Files:**
- Create: `scripts/generation/seedvr2.5-video-upscale.mapping.json`
- Create: `scripts/generation/seedvr25-mapping.test.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: official API JSON exported from `https://www.runninghub.ai/post/2099866760106491906`
- Produces: committed mapping generated by `inspect-runninghub-workflow.mjs`

- [ ] **Step 1: Add a failing mapping test**

```js
test('内置映射绑定指定工作流且有唯一输入输出', async () => {
  const mapping = JSON.parse(await readFile(new URL('./seedvr2.5-video-upscale.mapping.json', import.meta.url)))
  assert.equal(mapping.workflow_id, '2099866760106491906')
  assert.match(mapping.video_input.node_id, /^\d+$/)
  assert.ok(mapping.video_input.field_name)
  assert.match(mapping.video_output.node_id, /^\d+$/)
})
```

- [ ] **Step 2: Run test and verify red**

Run: `node --test scripts/generation/seedvr25-mapping.test.mjs`  
Expected: FAIL because the real mapping file is absent.

- [ ] **Step 3: Export from the official page and generate mapping**

The user logs into RunningHub if needed, opens the exact workflow, chooses “下载 → 导出工作流 API”, and saves the downloaded JSON outside the repository or under an ignored temporary path. Then run:

```bash
test -n "$SEEDVR25_API_EXPORT"
node scripts/generation/inspect-runninghub-workflow.mjs "$SEEDVR25_API_EXPORT" 2099866760106491906 --output scripts/generation/seedvr2.5-video-upscale.mapping.json
```

Do not add the raw downloaded workflow if its redistribution terms are unknown. Add its SHA-256 and export timestamp to the generated mapping so the source can be audited without committing the full graph. If structural inspection finds multiple candidates, stop and inspect the visible RunningHub node labels; do not select the first node.

- [ ] **Step 4: Run mapping test and inspect diff**

Run: `node --test scripts/generation/seedvr25-mapping.test.mjs && git diff --check`  
Expected: PASS; the committed file contains the exact numeric nodes emitted by the inspector and no credentials or local download path.

- [ ] **Step 5: Commit**

```bash
git add scripts/generation/seedvr2.5-video-upscale.mapping.json scripts/generation/seedvr25-mapping.test.mjs .gitignore
git commit -m "chore: 固化 SeedVR2.5 工作流节点映射"
```

### Task 3: RunningHub SeedVR2.5 适配器

**Files:**
- Modify: `scripts/generation/runninghub.mjs`
- Modify: `scripts/generation/providers.mjs`
- Create: `scripts/generation/seedvr25-adapter.test.mjs`

**Interfaces:**
- Produces: `submitSeedVr25(input): Promise<{task_id:string,provider:'runninghub',media_type:'video',model:'seedvr2.5-video-upscale',workflow_id:string,status:'submitted'}>`
- Produces provider method: `runninghub.transform(input)`

- [ ] **Step 1: Write failing adapter tests with mocked fetch**

```js
test('上传视频后只覆盖映射声明的输入节点', async () => {
  const result = await submitSeedVr25({ operation: 'video-upscale', model: 'seedvr2.5-video-upscale', source_video_path: fixtureVideo, confirmed: true })
  const body = JSON.parse(calls.find((call) => call.url.endsWith('/task/openapi/create')).body)
  assert.equal(body.workflowId, '2099866760106491906')
  assert.deepEqual(body.nodeInfoList, [{ nodeId: mapping.video_input.node_id, fieldName: mapping.video_input.field_name, fieldValue: uploadedFileName }])
  assert.equal(result.model, 'seedvr2.5-video-upscale')
})
```

- [ ] **Step 2: Run test and verify red**

Run: `node --test scripts/generation/seedvr25-adapter.test.mjs`  
Expected: FAIL with missing export/method.

- [ ] **Step 3: Reuse upload, submit and concurrency primitives**

```js
async function submitSeedVr25(input) {
  confirm(input)
  if (input.operation !== 'video-upscale' || input.model !== SEEDVR25_MODEL) throw new Error('SeedVR2.5 只支持 video-upscale')
  const fileName = await upload(input.source_video_path)
  const nodeInfoList = [{ nodeId: SEEDVR25_MAPPING.video_input.node_id, fieldName: SEEDVR25_MAPPING.video_input.field_name, fieldValue: fileName }]
  const payload = await request('/task/openapi/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: apiKey(), workflowId: SEEDVR25_WORKFLOW_ID, nodeInfoList, addMetadata: false }) })
  if (Number(payload.code) !== 0 || !payload?.data?.taskId) throw new Error(`RUNNINGHUB_SEEDVR25_SUBMIT_FAILED: ${String(payload.msg || payload.code)}`)
  return { task_id: payload.data.taskId, provider: 'runninghub', media_type: 'video', model: SEEDVR25_MODEL, workflow_id: SEEDVR25_WORKFLOW_ID, status: 'submitted' }
}
```

Route `runninghub.transform` through the same `withSubmissionSlot(apiKey(), ...)` used by image, video and audio. Add the model under transform catalog and `transform.video-upscale:true`; do not list it as a video generator.

- [ ] **Step 4: Run adapter and concurrency tests**

Run: `node --test scripts/generation/seedvr25-adapter.test.mjs && node scripts/generation/runninghub.mjs --self-check && node scripts/generation/providers.mjs --self-check`  
Expected: PASS, including maximum observed concurrent submissions equal to 2.

- [ ] **Step 5: Commit**

```bash
git add scripts/generation/runninghub.mjs scripts/generation/providers.mjs scripts/generation/seedvr25-adapter.test.mjs
git commit -m "feat: 接入 RunningHub SeedVR2.5 视频超分"
```

### Task 4: 统一 MCP、回写和超分审核

**Files:**
- Modify: `scripts/generation/mcp.mjs`
- Modify: `scripts/task-sync.mjs`
- Modify: `scripts/media-operation-review.mjs`
- Create: `scripts/seedvr25-flow.test.mjs`
- Modify: `.mcp.json`

**Interfaces:**
- Consumes MCP: `submit_media_operation(operation='video-upscale', provider='runninghub', model='seedvr2.5-video-upscale')`
- Consumes MCP: `get_media_operation`
- Produces selected transformed video only after `video-upscale` review

- [ ] **Step 1: Write failing offline flow tests**

```js
test('预览摘要包含上传、工作流和节点覆盖且不提交', async () => {
  const preview = await call('submit_media_operation', { ...request, confirmed: false })
  assert.equal(preview.workflow_id, '2099866760106491906')
  assert.equal(preview.uploads.length, 1)
  assert.deepEqual(preview.node_overrides, [mapping.video_input])
  assert.equal(remoteCalls.length, 0)
})
test('非 selected 或失效输入在上传前拒绝', async () => {
  await assert.rejects(call('submit_media_operation', { ...request, confirmed: true, source: staleSource }), /selected|失效/)
  assert.equal(remoteCalls.length, 0)
})
```

- [ ] **Step 2: Run test and verify red**

Run: `node --test scripts/seedvr25-flow.test.mjs`  
Expected: FAIL until SeedVR route and summary are wired.

- [ ] **Step 3: Implement preview, submission, sync and review gates**

Use the generic operation request snapshot and task ledger. Preserve source audio: if the RunningHub result lacks audio, create a deterministic post-process derivative that maps the source audio back onto the upscaled video and records both the provider output and audio-remux source in provenance. Reject duration or frame-rate changes not declared by the workflow mapping.

- [ ] **Step 4: Run offline flow and plugin tests**

Run: `node --test scripts/seedvr25-flow.test.mjs && node scripts/generation/mcp.mjs --self-check && node scripts/task-sync.mjs --self-check && node scripts/audit-plugin.mjs --self-check`  
Expected: PASS without contacting RunningHub.

- [ ] **Step 5: Commit**

```bash
git add scripts/generation/mcp.mjs scripts/task-sync.mjs scripts/media-operation-review.mjs scripts/seedvr25-flow.test.mjs .mcp.json
git commit -m "feat: 完成 SeedVR2.5 超分任务与审核闭环"
```

### Task 5: 真实付费冒烟和结果证据

**Files:**
- Modify: `scripts/generation/live-smoke-test.mjs`
- Create at runtime only: user project media-operation request, task, output and review records
- Modify: `references/runninghub-provider.md`
- Modify: `skills/configure-generation-providers/SKILL.md`
- Modify: `skills/transform-drama-media/SKILL.md`

**Interfaces:**
- Produces CLI mode: `node scripts/generation/live-smoke-test.mjs runninghub seedvr2.5-video-upscale "$SEEDVR25_PROJECT_ROOT" "$SEEDVR25_ASSET_KEY" "$SEEDVR25_VERSION_ID" --confirmed`

- [ ] **Step 1: Add a dry-run smoke test**

```js
test('SeedVR smoke 默认只输出付费摘要', async () => {
  const summary = await seedVrSmoke({ root, assetKey: key, versionId: 'v001', confirmed: false })
  assert.equal(summary.requires_confirmation, true)
  assert.equal(summary.workflow_id, '2099866760106491906')
})
```

- [ ] **Step 2: Run dry-run test and verify red, then implement it**

Run: `node --test scripts/generation/live-smoke-test.mjs`  
Expected before implementation: FAIL for missing SeedVR mode. Add the mode by calling the same MCP `confirmed:false` path; rerun and expect PASS with no remote task.

- [ ] **Step 3: Present the exact action-time confirmation**

Before the real call, report the selected local source asset/version, SHA-256, duration, resolution, workflow ID, node override, upload fact, output expectation and RunningHub cost estimate if the API exposes it. Do not proceed until the user explicitly confirms that specific paid upload.

- [ ] **Step 4: Run and audit one real upscale after confirmation**

Run:

```bash
test -n "$SEEDVR25_PROJECT_ROOT"
test -n "$SEEDVR25_ASSET_KEY"
test -n "$SEEDVR25_VERSION_ID"
node scripts/generation/live-smoke-test.mjs runninghub seedvr2.5-video-upscale "$SEEDVR25_PROJECT_ROOT" "$SEEDVR25_ASSET_KEY" "$SEEDVR25_VERSION_ID" --confirmed
```

Poll the returned task ID rather than resubmitting, download the output, run `media-tools.mjs qc`, inspect resolution/duration/fps/audio, fully watch the result, save the `video-upscale` review, and only then select it. Expected: output resolution is larger than input, no undeclared duration/fps drift, source audio is present, QC passes, and the review covers all required keys.

- [ ] **Step 5: Commit**

Commit code and documentation only; do not include runtime project evidence.

```bash
git add scripts/generation/live-smoke-test.mjs references/runninghub-provider.md skills/configure-generation-providers/SKILL.md skills/transform-drama-media/SKILL.md
git commit -m "test: 增加 SeedVR2.5 真实冒烟与验收流程"
```

Do not commit user media, request snapshots, task records, credentials or generated output.
