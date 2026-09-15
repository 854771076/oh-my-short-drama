# 0.8.0 媒体能力流水线集成审计实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用一套可重复、逐需求出证据的集成验收证明人物、连续性、声音、配乐、媒体编辑和 SeedVR2.5 在插件 `0.8.0` 中形成完整闭环。

**Architecture:** `next-version-acceptance.mjs` 不实现业务功能，只编排各阶段已有自检并生成结构化证据；集成测试在临时项目中串联真实本地账本和媒体操作；版本清单只在全部离线门禁通过、SeedVR 真实映射存在且付费冒烟审核完成后更新。发布 tag 和推送不属于本计划的自动动作。

**Tech Stack:** Node.js ESM、Node test runner、FFmpeg/FFprobe、现有插件审计与三清单、Git。

**Spec:** `docs/superpowers/specs/2026-09-16-continuity-audio-media-pipeline-design.md` 全文，重点为第 14 节

## Global Constraints

- 所有集成测试使用 `mkdtemp` 临时项目，不修改用户项目、插件缓存或真实资产。
- 每个需求必须有直接测试或运行证据；插件总审计通过不能替代专项验收。
- SeedVR2.5 的合成工作流 fixture 只能证明离线适配器，不得冒充真实节点映射或真实超分结果。
- 真实 RunningHub 冒烟必须使用任务句柄持续查询，不得因轮询超时重新提交。
- 三份清单最终版本固定为 `0.8.0`；版本不一致时拒绝完成验收。
- 不提交密钥、用户媒体、远程请求快照、任务账本、生成缓存或 `.research/`。

---

### Task 1: 需求到证据的可执行验收清单

**Files:**
- Create: `scripts/next-version-acceptance.mjs`
- Create: `scripts/next-version-acceptance.test.mjs`

**Interfaces:**
- Produces: `acceptanceChecks(): Array<{id:string,title:string,commands:string[],required_files:string[]}>`
- Produces CLI: `node scripts/next-version-acceptance.mjs [--json]`
- Requirement IDs: `character-appeal`, `tail-frame`, `spatial-continuity`, `native-audio`, `voice-lip-sync`, `licensed-music`, `media-editing-mcp`, `seedvr25`, `plugin-release`

- [ ] **Step 1: Write the failing coverage test**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { acceptanceChecks } from './next-version-acceptance.mjs'

test('九项验收均有文件与可执行命令证据', () => {
  const checks = acceptanceChecks()
  assert.deepEqual(checks.map((item) => item.id), ['character-appeal','tail-frame','spatial-continuity','native-audio','voice-lip-sync','licensed-music','media-editing-mcp','seedvr25','plugin-release'])
  for (const check of checks) {
    assert.ok(check.required_files.length > 0, `${check.id} 缺少文件证据`)
    assert.ok(check.commands.length > 0, `${check.id} 缺少运行证据`)
  }
})
```

- [ ] **Step 2: Run test and verify red**

Run: `node --test scripts/next-version-acceptance.test.mjs`  
Expected: FAIL with missing module.

- [ ] **Step 3: Implement a fail-closed command runner**

```js
export function acceptanceChecks() {
  return [
    { id: 'character-appeal', title: '人物银幕吸引力与儿童保护', required_files: ['scripts/character-appeal.mjs','scripts/character-appeal-review.mjs'], commands: ['node --test scripts/character-appeal.test.mjs scripts/character-appeal-review.test.mjs'] },
    { id: 'tail-frame', title: '上一镜尾帧绑定下一镜首帧', required_files: ['scripts/previous-tail.mjs'], commands: ['node --test scripts/previous-tail.test.mjs scripts/previous-tail-binding.test.mjs'] },
    { id: 'spatial-continuity', title: '连续镜头空间方位', required_files: ['scripts/continuity-plan.mjs'], commands: ['node --test scripts/continuity-plan.test.mjs'] },
    { id: 'native-audio', title: '原生音频优先与受控兜底', required_files: ['scripts/audio-plan-contract.mjs','scripts/native-audio-audit.mjs'], commands: ['node --test scripts/audio-plan-contract.test.mjs scripts/native-audio-audit.test.mjs scripts/audio-fallback.test.mjs'] },
    { id: 'voice-lip-sync', title: '语音生成、外部音频与口型', required_files: ['scripts/generation/musetalk.mjs'], commands: ['node --test scripts/audio-fallback-flow.test.mjs scripts/generation/musetalk.test.mjs scripts/lip-sync-flow.test.mjs'] },
    { id: 'licensed-music', title: '授权音乐目录', required_files: ['scripts/music-catalog/providers.mjs','scripts/music-license-ledger.mjs'], commands: ['node --test scripts/music-catalog/providers.test.mjs scripts/music-license-ledger.test.mjs scripts/licensed-music-flow.test.mjs'] },
    { id: 'media-editing-mcp', title: '视频局部修复 MCP', required_files: ['scripts/media-operation-contract.mjs','scripts/media-operations.mjs'], commands: ['node --test scripts/media-operation-contract.test.mjs scripts/media-operation-mcp.test.mjs scripts/media-operation-review.test.mjs'] },
    { id: 'seedvr25', title: 'RunningHub SeedVR2.5 超分', required_files: ['scripts/generation/seedvr2.5-video-upscale.mapping.json'], commands: ['node --test scripts/generation/seedvr25-mapping.test.mjs scripts/generation/seedvr25-adapter.test.mjs scripts/seedvr25-flow.test.mjs'] },
    { id: 'plugin-release', title: '插件回归与版本一致性', required_files: ['.codex-plugin/plugin.json','.claude-plugin/plugin.json','.claude-plugin/marketplace.json'], commands: ['node scripts/integration-self-check.mjs','node scripts/audit-plugin.mjs --self-check'] },
  ]
}
```

The CLI verifies every required file, runs each command with `spawnSync` argument arrays, captures exit code and a bounded output tail, emits one result per requirement and exits non-zero if any result fails. It does not skip missing external SeedVR evidence.

- [ ] **Step 4: Run acceptance unit tests**

Run: `node --test scripts/next-version-acceptance.test.mjs`  
Expected: PASS without running the full suite.

- [ ] **Step 5: Commit**

```bash
git add scripts/next-version-acceptance.mjs scripts/next-version-acceptance.test.mjs
git commit -m "test: 新增下一版本逐需求验收清单"
```

### Task 2: 临时项目端到端集成场景

**Files:**
- Create: `scripts/media-pipeline.integration.test.mjs`
- Modify: `scripts/integration-self-check.mjs`

**Interfaces:**
- Consumes all public functions produced by stages 1–6
- Produces one temporary-project scenario with immutable versions, source hashes, stale propagation and review gates

- [ ] **Step 1: Write a failing end-to-end scenario**

```js
test('人物、连续性、声音和媒体操作在同一临时项目闭环', async () => {
  const root = await createTemporaryProject()
  await seedApprovedAdultAndChildProfiles(root)
  await seedApprovedContinuityPlan(root)
  const tail = await preparePreviousTail({ projectRoot: root, episodeKey: 'ep-001', shotNumber: 2, continuityVersion: 'v001' })
  assert.equal(tail.asset_key, 'other-transition-ep001-002')
  const audio = validateAudioPlan(nativeFirstAudioPlan)
  assert.equal(audio.audio_strategy.mode, 'native-first')
  const repaired = await executeLocalMediaOperation(root, trimRequest)
  assert.notEqual(repaired.output_path, sourceVideoPath)
  await invalidateDerivedAssets(root, { key: 'shot-ep001-001', version_id: 'v001' })
  await assert.rejects(selectedAssetVersion(root, tail.asset_key), /失效|selected/)
})
```

- [ ] **Step 2: Run test and verify red**

Run: `node --test scripts/media-pipeline.integration.test.mjs`  
Expected: FAIL at the first missing integration fixture/helper or contract mismatch.

- [ ] **Step 3: Build deterministic fixtures and assert negative gates**

Use FFmpeg `lavfi` to create a two-second 640×360 video with a sine-wave audio stream. The fixture includes one approved adult, one approved child, two same-camera shots, one approved `native-first` audio plan, one local trim operation and one catalog-license record. Add negative assertions for unknown age, child adultization, unexplained actor movement, stale tail source, narration without performance, music without compatible receipt and media operation without selected input.

```js
await assert.rejects(submitVideoWithUnknownAge(root), /年龄证据/)
assert.throws(() => validateContinuityPlan(planWithUnexplainedMove, 'ep-001'), /不一致/)
assert.throws(() => validateAudioPlan(narrationWithoutPerformance), /旁白.*表演合同/)
await assert.rejects(validateTimeline(root, timelineWithUnlicensedMusic), /许可证用途/)
```

- [ ] **Step 4: Run integration and existing regressions**

Run: `node --test scripts/media-pipeline.integration.test.mjs && node scripts/integration-self-check.mjs && node scripts/studio.test.mjs`  
Expected: PASS; all temporary directories are removed and no file appears under a user project path.

- [ ] **Step 5: Commit**

```bash
git add scripts/media-pipeline.integration.test.mjs scripts/integration-self-check.mjs
git commit -m "test: 串联媒体能力流水线端到端验收"
```

### Task 3: 插件入口、Skill 索引和用户流程回归

**Files:**
- Modify: `skills/short-drama/SKILL.md`
- Modify: `skills/short-drama-skill-index/SKILL.md`
- Modify: `skills/orchestrate-short-drama/SKILL.md`
- Modify: `skills/use-short-drama-studio/SKILL.md`
- Modify: `references/pipeline.md`
- Modify: `references/feature-completeness.md`
- Modify: `references/usage-guide.md`
- Modify: `references/skill-map.json`
- Modify: `scripts/workflow-stages.mjs`
- Create: `scripts/workflow-stages.test.mjs`
- Modify: `scripts/workflow-gates.mjs`
- Modify: `scripts/audit-plugin.mjs`

**Interfaces:**
- Produces documented order: character appeal → continuity/tail → native audio plan → generation/audit → controlled fallback/lip-sync → licensed music/editing → upscale → delivery
- Produces: `mediaPipelineStages(): string[]`
- Produces: `stageFallback(stage: string): string[]`

- [ ] **Step 1: Add a failing stage-order audit**

```js
test('新能力在主编排流程中有唯一顺序和回退边', () => {
  assert.deepEqual(mediaPipelineStages(), ['character-appeal','continuity-plan','previous-tail','native-audio','native-audio-review','audio-fallback','lip-sync','licensed-music','media-editing','video-upscale','delivery'])
  assert.deepEqual(stageFallback('native-audio-review'), ['audio-fallback'])
})
```

- [ ] **Step 2: Run workflow checks and verify red**

Run: `node --test scripts/workflow-stages.test.mjs && node scripts/audit-plugin.mjs --self-check`  
Expected: FAIL until the stage graph and docs include the new capabilities.

- [ ] **Step 3: Wire the explicit stage graph and fail-closed gates**

```js
export const MEDIA_PIPELINE_STAGES = ['character-appeal','continuity-plan','previous-tail','native-audio','native-audio-review','audio-fallback','lip-sync','licensed-music','media-editing','video-upscale','delivery']
export const MEDIA_PIPELINE_FALLBACKS = { 'native-audio-review': ['audio-fallback'] }
export const mediaPipelineStages = () => [...MEDIA_PIPELINE_STAGES]
export const stageFallback = (stage) => [...(MEDIA_PIPELINE_FALLBACKS[stage] || [])]
```

Document optional edges: `previous-tail` only for eligible same-scene/same-camera shots; `audio-fallback` only after a failed native audit; `lip-sync` only for visible independently sourced dialogue; `video-upscale` only after editing selection. Main Skills must link to the owning atomic Skill instead of duplicating execution details.

- [ ] **Step 4: Run workflow, studio and plugin audits**

Run: `node --test scripts/workflow-stages.test.mjs && node scripts/studio.test.mjs && node scripts/integration-self-check.mjs && node scripts/audit-plugin.mjs --self-check`  
Expected: PASS and audit reports `status:"covered"`.

- [ ] **Step 5: Commit**

```bash
git add skills/short-drama/SKILL.md skills/short-drama-skill-index/SKILL.md skills/orchestrate-short-drama/SKILL.md skills/use-short-drama-studio/SKILL.md references/pipeline.md references/feature-completeness.md references/usage-guide.md references/skill-map.json scripts/workflow-stages.mjs scripts/workflow-gates.mjs scripts/audit-plugin.mjs
git commit -m "feat: 串联下一版媒体能力主流程"
```

### Task 4: 版本 0.8.0、全量验收与发布准备

**Files:**
- Modify: `.codex-plugin/plugin.json`
- Modify: `.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `CHANGELOG.md`
- Modify: `README.md`

**Interfaces:**
- Produces manifest version: `0.8.0`
- Produces acceptance JSON from `node scripts/next-version-acceptance.mjs --json`

- [ ] **Step 1: Run the full acceptance before version edits**

Run: `node scripts/next-version-acceptance.mjs --json`  
Expected: PASS for all nine requirement IDs. If `seedvr25` fails because the real mapping or paid-output review is absent, stop at this external gate; do not weaken the checker or use the synthetic fixture as proof.

- [ ] **Step 2: Update all manifests and release notes together**

Set `.codex-plugin/plugin.json.version`, `.claude-plugin/plugin.json.version` and `.claude-plugin/marketplace.json.plugins[0].version` to exactly `0.8.0`. Add a `0.8.0` changelog section covering all nine acceptance IDs and document the new optional Provider configuration without including credentials or local paths.

```json
{
  "version": "0.8.0"
}
```

- [ ] **Step 3: Run mandatory release checks**

Run:

```bash
node -e "const fs=require('fs'); const v=JSON.parse(fs.readFileSync('.codex-plugin/plugin.json')).version; if (JSON.parse(fs.readFileSync('.claude-plugin/plugin.json')).version!==v || JSON.parse(fs.readFileSync('.claude-plugin/marketplace.json')).plugins[0].version!==v) process.exit(1)"
node scripts/audit-plugin.mjs --self-check
node scripts/integration-self-check.mjs
node scripts/next-version-acceptance.mjs --json
git diff --check
```

Expected: all commands PASS; the acceptance output contains nine `passed:true` entries and manifest version is `0.8.0`.

- [ ] **Step 4: Audit the commit scope and sensitive files**

Run:

```bash
git status --short
git diff --name-only
git diff -- .codex-plugin/plugin.json .claude-plugin/plugin.json .claude-plugin/marketplace.json CHANGELOG.md README.md
test -z "$(git ls-files -- '.env' '.env.*' '.research/**' '*.mp4' '*.wav')"
```

Expected: only intended plugin code/docs/manifests are tracked; no credential, research cache or generated user media is listed.

- [ ] **Step 5: Commit**

Commit release preparation without tagging or pushing.

```bash
git add .codex-plugin/plugin.json .claude-plugin/plugin.json .claude-plugin/marketplace.json CHANGELOG.md README.md
git commit -m "chore: 准备 0.8.0 媒体能力版本"
```

After the commit, report every acceptance ID and its evidence to the user. Create tag `v0.8.0` and push only in a separate user-approved release action.
