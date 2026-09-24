# 分析短剧市场

用于用户询问近期短剧题材趋势、平台榜单、市场机会、竞争格局或要求市场报告。不得用于分析单部小说或剧本、预测投资收益，或绕过付费或登录权限获取数据。

先确认用户提供的工作区存在且可访问，再执行 `node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/market-research.mjs" list <workspace>`，核对最新快照、最新报告和报告覆盖范围。必须先读取本 Skill 的 [方法说明](analyze-drama-market/methodology.md)，再解读任何指标。

默认不联网：优先使用最新已保存报告；若有快照但没有所需报告，执行 `node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/market-research.mjs" analyze <workspace> [snapshot-id]`。只有用户明确要求刷新时才联网，才可执行 `node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/market-research.mjs" refresh <workspace>`。刷新后用 `report <workspace> [report-id]` 回读 JSON 与 Markdown 路径；不要把“近期”“最新”自行解释为授权刷新。

可用命令合同：

- `refresh <workspace>`：采集公开榜单、保存快照并生成报告。
- `analyze <workspace> [snapshot-id]`：只读取已有快照并生成报告。
- `report <workspace> [report-id]`：输出 JSON 与 Markdown 路径。
- `list <workspace>`：输出已保存报告摘要 JSON。
- `--self-check`：检查 CLI 合同。

引用量化结论时说明 `report_id` 及对应 evidence 条目；标题关键词推断仅是低置信度线索，不得叙述为确定事实。持续展示并重复适用边界：数据仅覆盖剧查查公开 Top 30 榜单样本，不代表全量市场，也不构成收入、投资或投放承诺。

输出固定为以下顺序；无数据时保留标题并说明原因。

## 事实

报告 ID、快照时间、成功/失败榜单、样本数与公开 Top 30 覆盖边界。

## 机会

列出题材机会分、样本量、置信度和支持证据，不将机会分等同于收益预测。

## 风险

说明拥挤度、公司集中度、低置信标签、缺失榜单和趋势可比性风险。

## 平台

按平台矩阵比较作品覆盖和榜内排名，不跨榜单直接比较原始热度数值。

## 新剧

说明新剧观察名单、榜单排名和证据；未明确标为新剧的数据不得补推。

## 创作启示

把题材机会转为可验证的创作假设，明确其不能覆盖来源事实、合规要求或用户已确认创意。

## 限制

保留报告全部限制，特别是公开 Top 30、单快照、失败榜单、标签来源和趋势不可比边界。
