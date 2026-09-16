---
name: ideate-drama-from-market
description: 基于用户指定的已保存市场报告生成可追溯、反仿写的短剧创作灵感，并在用户明确要求时登记为项目的市场灵感引用；不用于复制榜单作品或预测收益。
---

# 从市场洞察短剧灵感

用于用户明确希望参考市场报告、榜单信号或题材机会来构思短剧时。只读取用户指定或已确认使用的本地 `market-report.v2`；不自行联网刷新，不把“近期”理解为刷新授权。

先读取 [市场灵感合同](references/market-inspiration.schema.json) 和报告中的 `coverage`、`limitations`、`evidence`。输出前把内容分层：

- `signals[].fact` 只陈述报告中可由 `evidence` 回链的市场事实，并保留对应置信度和限制；低置信信号不得升格为确定结论。
- `hypotheses[].inference` 说明由事实推出的有限判断，必须列出 `derived_signal_ids` 与前提。
- `creative_transformation`、开场钩子和连续集引擎是原创创作假设，必须能被后续用户或样片验证，不得伪装为市场事实。

不得复用或改写榜单作品标题、人物关系、具体情节、独特台词或故事结构；不得承诺收入、投放效果或市场必然成功。差异化字段应明确原创变换，风险和验证问题不得省略。

使用 `assets/prompts/market_inspiration.{zh,en}.txt` 生成严格 JSON。用户选定假设后，必须运行 `node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/project-store.mjs" market-report-ref <项目目录> <report ID> <已选 hypothesis ID>...`，把命令输出逐字段原样用作 `report_ref`；不得自行计算或猜测 SHA-256。该入口从指定的已保存报告生成报告 ID、快照 IDs、生成时间、筛选、规范 JSON SHA-256 和已选假设 IDs，并与保存校验复用相同摘要规则。`decision.selected_hypothesis_ids` 必须与生成引用一致。完成后可用 `node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/project-store.mjs" put-document <项目目录> market-inspiration <JSON>` 保存。

保存到项目不是默认动作：只有用户明确要求将市场灵感用于该项目时，才写入 `market-inspiration.json`，并在 Brief 的 `market_inspiration_ref` 中写入相同的完整 `report_ref`。不得自动改写项目题材、平台、来源事实、合规约束或用户已确认的创意决定。
