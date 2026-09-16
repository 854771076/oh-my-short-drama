---
name: define-drama-brief
description: 把短剧想法收敛为可执行创作简报。用于确认题材、受众、平台、语言、画幅、集数、单集时长和内容边界。
---

# 定义短剧简报

当项目为 `viral-recreation` 时，额外读取 `.short-drama/recreation-compiled/<episode>/<version>.json` 中各分集 selected 版本，把其中的结构机制、权利模式、禁复制边界、画幅与声音约束作为已确认输入；brief 必须写入 `recreation_workflows:{"ep-001":"v001"}` 映射并由保存命令校验，不得绕过约束包自行从聊天内容推断复刻要求。

合并询问缺失且会改变创作结果的最少问题，不替用户选择题材或平台。由 Codex 使用 `assets/prompts/drama_brief.{zh,en}.txt` 直接输出结构化 `brief.json`，至少包含：一句话目标、题材/受众/基调、核心冲突、交付语言、画幅、集数、单集目标时长、内容分级、已有素材、明确禁区；确认后用 `project-store.mjs put-document <项目目录> brief <文件>` 保存，并用 `update-project` 同步 `format`、`languages` 和 `creative` 中对应的项目级事实。`episode_duration_seconds` 表示策划目标而非必须精确命中的硬截止；除非平台明确限长，后续优先保证动作完成、对白可读和结尾呼吸。

题材决策时按需读取 [题材指南](../../references/writing/genre-guide.md)。用户确认前不进入故事圣经。文本始终由 Codex 输出，不调用外部文本模型。

只有用户明确要求参考市场时，才读取用户选择的 `market_inspiration_ref`；它必须完整保留报告 ID、快照 IDs、生成时间、筛选、SHA-256 和已选假设 IDs。未使用市场时将该字段写为 `null`。市场灵感只提供带限制的创作假设，不得覆盖原文事实、合规要求或用户已经确认的创意决策，也不得直接读取榜单作品清单。
