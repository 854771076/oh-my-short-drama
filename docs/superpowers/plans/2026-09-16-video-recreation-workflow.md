# Video Recreation Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为短剧工厂增加“上传本地参考视频→确定性拆解→声明式复刻工作流→复用现有生产链”的 MVP。

**Architecture:** 保持现有九阶段不变，在 `project.json.workflow.type` 上增加兼容 profile；本地脚本只生成媒体技术证据，两个 Codex Skill 分别生成参考分析和声明式复刻工作流。所有新增文档通过项目版本、SHA-256、Skill 凭证和 analysis 阶段门禁连接到现有流水线。

**Tech Stack:** Node.js ESM、原生 `node:test`、ffprobe/ffmpeg、JSON 合同、现有 Skill/Prompt 运行账本。

**Spec:** `docs/superpowers/specs/2026-09-16-video-recreation-workflow-design.md`

## Global Constraints

- 默认中文沟通；新增代码注释只用中文并解释业务意图、边界或兼容原因。
- 不新增全局 stage，不破坏旧项目和旧来源 manifest。
- 不直接依赖或复制 Hypit 源码。
- 不隐式下载参考视频 URL，不把原片登记为正式视频资产。
- 媒体哈希使用流式读取，路径必须限制在项目目录。
- 每项行为变更先写失败测试并确认因缺少该能力而失败。
- 发布前执行插件审计、集成自检、全部测试和三清单版本一致性检查。

---

### Task 1: Profile 与参考视频来源合同

**Files:**
- Modify: `scripts/project-store.mjs`
- Modify: `scripts/validate-project.mjs`
- Create: `scripts/recreation-workflow.test.mjs`

**Interfaces:**
- Produces: `project.workflow = { type: 'standard'|'viral-recreation', version: 1 }`
- Produces: `source.kind = 'document'|'reference-video'`
- Consumes later: `requiredSkills()` 和 reference prepare 命令读取这两个字段。

- [ ] **Step 1: 写失败测试**

测试 `validateProject()` 为旧项目补 `standard`、拒绝未知 profile；运行真实 `project-store.mjs put-source`，断言视频来源进入 source 账本且不进入资产账本。

- [ ] **Step 2: 验证红灯**

Run: `node --test scripts/recreation-workflow.test.mjs`

Expected: profile 字段或视频扩展名未被支持。

- [ ] **Step 3: 实现最小兼容合同**

在 defaults、validator、update invalidation 和 source import 中实现 profile、source kind 与视频扩展名；旧记录读时默认 document。

- [ ] **Step 4: 验证绿灯**

Run: `node --test scripts/recreation-workflow.test.mjs`

Expected: PASS。

### Task 2: 参考视频确定性准备器

**Files:**
- Create: `scripts/reference-video.mjs`
- Create: `scripts/reference-video.test.mjs`
- Modify: `scripts/media-tools.mjs`

**Interfaces:**
- Produces: `probeReferenceVideo(path)`
- Produces: `prepareReferenceVideo(projectRoot, { sourceKey, versionId, sceneThreshold, maxShots })`
- Produces: `.short-drama/reference-video/prepared.json`

- [ ] **Step 1: 写 probe 与准备清单失败测试**

用 ffmpeg lavfi 生成两段颜色和正弦波组成的短视频夹具；测试技术信息、至少两个镜头、关键帧和音轨都落在项目目录，来源哈希一致。

- [ ] **Step 2: 验证红灯**

Run: `node --test scripts/reference-video.test.mjs`

Expected: `ERR_MODULE_NOT_FOUND`。

- [ ] **Step 3: 实现 probe、scene detect、抽帧和抽音轨**

所有子进程使用参数数组；限制镜头数；零 scene cut 时生成覆盖整片的单镜；所有输出用原子 JSON 写入。

- [ ] **Step 4: 增加错误边界测试并验证绿灯**

覆盖未选择来源、document 来源、来源 SHA 漂移、路径逃逸、无视频流和 maxShots 非法。

Run: `node --test scripts/reference-video.test.mjs`

Expected: PASS。

### Task 3: 分析与声明式工作流验证器

**Files:**
- Create: `scripts/recreation-workflow.mjs`
- Extend: `scripts/recreation-workflow.test.mjs`
- Modify: `scripts/project-store.mjs`
- Modify: `scripts/validate-project.mjs`

**Interfaces:**
- Produces: `validateReferenceVideoAnalysis(value)`
- Produces: `validateRecreationWorkflow(value, episodeKey)`
- Produces: episode document kind `recreation-workflow`

- [ ] **Step 1: 写合法与非法合同失败测试**

测试合法结构；拒绝未授权 close recreation、无时间码证据、trigger 引用不存在 segment、裸秒触发、批准文档存在 unresolved、重复 slot/segment id。

- [ ] **Step 2: 验证红灯**

Run: `node --test scripts/recreation-workflow.test.mjs`

Expected: validators 未导出。

- [ ] **Step 3: 实现独立严格验证器并接入 project-store**

分析写到 `.short-drama/reference-video-analysis.json`；复刻工作流使用既有版本目录与 selected 机制。任何更新从 analysis 失效。

- [ ] **Step 4: 验证绿灯与项目级校验**

Run: `node --test scripts/recreation-workflow.test.mjs`

Expected: PASS。

### Task 4: 条件 Skill 与阶段门禁

**Files:**
- Create: `skills/analyze-reference-video/SKILL.md`
- Create: `skills/analyze-reference-video/agents/openai.yaml`
- Create: `skills/analyze-reference-video/assets/prompts/reference_video_analysis.zh.txt`
- Create: `skills/analyze-reference-video/assets/prompts/reference_video_analysis.en.txt`
- Create: `skills/design-video-recreation/SKILL.md`
- Create: `skills/design-video-recreation/agents/openai.yaml`
- Create: `skills/design-video-recreation/assets/prompts/video_recreation_workflow.zh.txt`
- Create: `skills/design-video-recreation/assets/prompts/video_recreation_workflow.en.txt`
- Modify: `references/skill-map.json`
- Modify: `references/prompt-skill-index.md`
- Modify: `scripts/skill-runs.mjs`
- Modify: `scripts/workflow-gates.mjs`
- Extend: `scripts/recreation-workflow.test.mjs`

**Interfaces:**
- Produces: viral profile analysis required Skills。
- Consumes: prepared manifest、reference analysis、selected recreation workflow。

- [ ] **Step 1: 写条件 required Skills 和门禁失败测试**

standard 项目不出现新 Skill；viral 项目必须出现两个 Skill；缺准备清单、分析或工作流时 analysis gate 给出明确缺口。

- [ ] **Step 2: 验证红灯**

Run: `node --test scripts/recreation-workflow.test.mjs`

Expected: required Skills 或 gate 缺失。

- [ ] **Step 3: 编写双语 Codex 合同、Skill 和动态门禁**

分析 Skill 只从 prepared evidence 产出事实、推断和限制；设计 Skill 使用 segment/word 锚点生成五层工作流。两个 Skill 都必须绑定 Codex prompt-run 和本地产物。

- [ ] **Step 4: 验证绿灯**

Run: `node --test scripts/recreation-workflow.test.mjs`

Expected: PASS。

### Task 5: 文档、索引和既有审计修复

**Files:**
- Modify: `skills/short-drama-skill-index/SKILL.md`
- Modify: `skills/use-short-drama-studio/SKILL.md`
- Modify: `skills/orchestrate-short-drama/SKILL.md`
- Modify: `references/usage-guide.md`
- Modify: `references/project-spec-v1.md`
- Modify: `references/pipeline.md`
- Modify: `README.md`
- Modify: `references/skill-map.json`

**Interfaces:**
- Documents the user command and recovery path.
- Registers existing `analyze-drama-market` as support so audit sees the already committed Skill.

- [ ] **Step 1: 更新人工索引和使用合同**

明确本地文件入口、权利门禁、语义锚点、九阶段复用、prepared/analyze/workflow 产物和恢复规则。

- [ ] **Step 2: 修复既有市场 Skill 清单遗漏**

只将 `analyze-drama-market` 登记为 support，不把市场研究接入复刻流程。

- [ ] **Step 3: 运行插件审计**

Run: `node scripts/audit-plugin.mjs --self-check`

Expected: PASS。

### Task 6: 全量验证

**Files:**
- Modify as required by failures only within feature scope.

**Interfaces:**
- Produces fresh completion evidence.

- [ ] **Step 1: 运行定向测试**

Run: `node --test scripts/reference-video.test.mjs scripts/recreation-workflow.test.mjs`

- [ ] **Step 2: 运行全部离线测试**

Run: `node --test scripts/*.test.mjs scripts/market/*.test.mjs`

- [ ] **Step 3: 运行插件和集成自检**

Run: `node scripts/audit-plugin.mjs --self-check && node scripts/integration-self-check.mjs --self-check`

- [ ] **Step 4: 校验三清单版本一致**

Run: `node -e "const fs=require('fs'); const v=JSON.parse(fs.readFileSync('.codex-plugin/plugin.json')).version; if (JSON.parse(fs.readFileSync('.claude-plugin/plugin.json')).version!==v || JSON.parse(fs.readFileSync('.claude-plugin/marketplace.json')).plugins[0].version!==v) process.exit(1)"`

- [ ] **Step 5: 检查 diff 和未跟踪文件边界**

Run: `git status --short && git diff --check && git diff --stat`

确认 `.research/`、`sdk/` 未被本功能修改或加入。
