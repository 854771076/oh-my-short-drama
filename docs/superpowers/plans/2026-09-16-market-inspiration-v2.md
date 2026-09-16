# 市场洞察与创作灵感闭环 Implementation Plan

**Spec:** `docs/superpowers/specs/2026-09-16-market-inspiration-v2-design.md`

**Goal:** 修正市场指标口径，增加规范题材和多维洞察，并打通排行榜到创作 Brief 的可追溯灵感闭环。

## Global Constraints

- 只读取用户已保存的公开 Top 30 快照，不新增后台轮询、登录态采集或收益预测。
- 缺失指标保持 `null`，机会分按可用指标重归一；原始标签保留，分析使用规范题材。
- 市场事实、推断、创作假设和用户决定分层；不得复制榜单作品标题、人物关系或具体情节。
- 市场灵感保持显式可选，不进入所有项目的必经流程，不覆盖来源事实、合规要求和用户已确认创意。
- 严格 TDD；新增注释使用中文；不修改原工作区未提交的视频复刻文件。
- 三份插件清单版本统一为 `0.9.0`。

### Task 1: 修正市场分析口径并增加规范题材洞察

**Files:**

- Modify: `scripts/market/normalize.mjs`
- Modify: `scripts/market/normalize.test.mjs`
- Modify: `scripts/market/analyze.mjs`
- Modify: `scripts/market/analyze.test.mjs`
- Modify: `skills/analyze-drama-market/references/market-report.schema.json`
- Modify: `scripts/market-research.test.mjs`

**Requirements:**

1. 先写失败测试，证明缺失热度/增长/新剧/持久度不会按 0 计分。
2. 机会分仅对可用正向指标重归一，拥挤度惩罚仍使用原始权重；完全缺失的指标返回 `null`。
3. 增加每题材 `metric_coverage`；置信度纳入指标覆盖。
4. 区分采集榜单和分析榜单；单榜筛选时 `platform_coverage` 分母为当前分析集合。
5. 趋势增加 `elapsed_hours` 和 `period_kind`；小于 24 小时为 `instant`。
6. 实现可解释的规范题材映射，同时保留 `rawTopics` 和 `provenance.topicMappings`。
7. 报告增加题材共现、供需象限和平台偏好派生结果，全部可回链现有证据。
8. Schema 升级为 `market-report.v2` 并覆盖上述合同。

### Task 2: 新增市场灵感产物、Skill 与 Brief 引用

**Files:**

- Create: `skills/ideate-drama-from-market/SKILL.md`
- Create: `skills/ideate-drama-from-market/agents/openai.yaml`
- Create: `skills/ideate-drama-from-market/references/market-inspiration.schema.json`
- Create: `skills/ideate-drama-from-market/assets/prompts/market_inspiration.zh.txt`
- Create: `skills/ideate-drama-from-market/assets/prompts/market_inspiration.en.txt`
- Modify: `skills/define-drama-brief/SKILL.md`
- Modify: `skills/define-drama-brief/assets/prompts/drama_brief.zh.txt`
- Modify: `skills/define-drama-brief/assets/prompts/drama_brief.en.txt`
- Modify: `scripts/project-store.mjs`
- Modify: `scripts/integration-self-check.mjs`
- Modify: `references/skill-map.json`
- Modify: `skills/short-drama-skill-index/SKILL.md`
- Test: relevant project store and integration tests

**Requirements:**

1. 先写失败测试，证明 `market-inspiration.v1` 能验证、保存和回读，未知字段仍被拒绝。
2. 引用必须包含报告 ID、快照 IDs、生成时间、筛选、SHA-256 和已选假设 IDs。
3. Brief 增加可空 `market_inspiration_ref`，未使用市场时为 `null`。
4. 新 Skill 明确事实/推断/假设分层、证据要求、低置信继承和反仿写边界。
5. Skill 保持可自动发现，但只有用户明确要求参考市场时才写入项目。
6. 不把新 Skill 加入 analysis 阶段 required，只作为 support action 登记。

### Task 3: Studio 灵感板与可视化闭环

**Files:**

- Modify: `scripts/studio.mjs`
- Modify: `scripts/studio.test.mjs`
- Modify: `studio/app.js`
- Modify: `studio/style.css`

**Requirements:**

1. 先写失败的 API/交互测试。
2. 删除 `renderMarketLegacy`。
3. 筛选选项始终来自当前周期未过滤报告。
4. 题材 × 榜单矩阵显示百分位、有效样本数和 `—` 缺失态。
5. 新剧排名显示榜单名称，置信度显示中文。
6. 增加灵感板：选择最多 3 个题材、生成本地候选、选择候选、登记到指定项目。
7. 登记动作只写 `market-inspiration` 文档和 Brief 引用，不自动改写项目题材或平台。
8. 增加真实 API/DOM 行为测试，覆盖选择上限、空态、周期联合筛选、缺失值显示和项目登记。

### Task 4: 文档、版本与全量验收

**Files:**

- Modify: `README.md`
- Modify: `references/usage-guide.md`
- Modify: `references/pipeline.md`
- Modify: `.codex-plugin/plugin.json`
- Modify: `.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: tests or audit fixtures required by the version/skill additions

**Requirements:**

1. 文档说明市场分析与市场灵感的边界和完整使用路径。
2. 三份清单版本统一为 `0.9.0`。
3. 运行所有市场、项目存储、Studio 与集成测试。
4. 运行 `node scripts/audit-plugin.mjs --self-check`、`node scripts/integration-self-check.mjs --self-check`。
5. 运行三清单版本一致性命令。
6. 在真实保存报告的临时工作区完成一次离线市场灵感 smoke test，不联网刷新。
