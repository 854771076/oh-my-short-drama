# 连续性、声音与媒体后期能力化流水线实施路线

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 分七个可独立验收的实施计划交付人物银幕吸引力、首尾帧、空间连续性、原生音频优先与口型、授权配乐、媒体修复 MCP 和 RunningHub SeedVR2.5 超分。

**Architecture:** 所有计划共享不可变项目文档、资产版本、请求快照和任务账本。连续性计划负责决策，媒体操作负责变换，Provider 只实现细粒度能力；任何上游换版都通过版本和哈希使派生结果失效。

**Tech Stack:** Node.js ESM、Node test runner、FFmpeg/FFprobe、JSON-RPC MCP、RunningHub OpenAPI、现有本地 JSON 账本。

**Spec:** `docs/superpowers/specs/2026-09-16-continuity-audio-media-pipeline-design.md`

## Global Constraints

- 不修改用户项目目录或客户端插件缓存；测试只能使用临时目录。
- 不覆盖源媒体；每个生成或变换结果必须成为新资产版本。
- RunningHub 同一 API Key 的所有提交共用最多 2 路并发，任务查询不占槽位。
- 所有付费提交和本地素材上传必须在动作发生前取得用户确认。
- 不猜测 RunningHub `nodeId`、`fieldName` 或工作流结构。
- 不自动下载或使用没有可验证同步权和母带权的商业热曲。
- 人物年龄没有剧本或已批准档案证据时，不得生成成年魅力或儿童形象；儿童保护失败不得被美观评分抵消。
- 视频模型原生对白、旁白、环境声和动作声优先；只有记录受控失败原因后才允许按区间兜底。
- 新增代码注释只能使用中文，并解释业务意图、边界或兼容原因。
- 本功能版本为 `0.8.0`；发布时三个清单版本必须完全一致并使用 tag `v0.8.0`。

---

## 执行顺序

- [ ] **阶段 1：连续性与首尾帧** — 执行 `docs/superpowers/plans/2026-09-16-01-continuity-and-tail-frame.md`。
- [ ] **阶段 2：媒体操作核心** — 执行 `docs/superpowers/plans/2026-09-16-02-media-operation-core.md`。
- [ ] **阶段 3：人物银幕吸引力** — 执行 `docs/superpowers/plans/2026-09-16-character-audience-appeal.md`。
- [ ] **阶段 4：声音与对口型** — 执行 `docs/superpowers/plans/2026-09-16-03-audio-and-lip-sync.md`。
- [ ] **阶段 5：授权音乐目录** — 执行 `docs/superpowers/plans/2026-09-16-04-licensed-music-catalog.md`。
- [ ] **阶段 6：SeedVR2.5 超分** — 执行 `docs/superpowers/plans/2026-09-16-05-runninghub-seedvr25.md`。
- [ ] **阶段 7：总审计与发布准备** — 执行 `docs/superpowers/plans/2026-09-16-06-integration-audit.md`。

每个阶段必须先完成自己的红灯测试、最小实现、绿灯测试和专项审计，再提交并进入下一阶段。阶段 6 的真实工作流导出和付费冒烟属于独立外部门禁；该门禁不允许用假节点映射绕过。
