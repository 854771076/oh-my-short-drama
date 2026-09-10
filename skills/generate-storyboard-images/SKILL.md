---
name: generate-storyboard-images
description: 将确认的结构化分镜生成为单格、宫格或手绘故事板图片。用于分镜出图、宫格拆分高清化、连续性验收与选版。
---

# 生成分镜图片

只读取本地已选中的分镜版本、制作计划和人物、场景、道具完整设定板。严格按逐镜 `image_strategy.board_type` 和 `panel_grid_size` 选模板并生成：`single`（单图）使用 `single_panel_image`，固定 1 格；`storyboard`（故事版）使用 `panel_grid_image`，按计划格数生成同一连续镜头的时间关键帧宫格；`shot-board`（分镜板）使用 `panel_storyboard_image`，按计划格数生成叙事节拍驱动、用于现场沟通的多格分镜工作稿；其分框和标注是工作稿结构，主画面必须使用项目成片画风，不得默认成铅笔或纸张媒介。格数已由制作计划阶段的 Codex 根据叙事节拍判断，本 Skill 不擅自改成默认 4 格，也不得把 `shot-board` 路由成单图。

严格填充 [提示词索引](../../references/prompt-skill-index.md) 的变量；多格图根据计划中的 `panel_grid_size` 选择可读布局并同时提供 `grid_layout`，不得减少、留空、重复格子或把相邻镜头剧情画进当前镜头。宫格切单格后只允许用 `panel_grid_enhance` 保真高清化，不得重构图。

整集所有门禁已通过的镜头必须全量并发调用 `generate_image`，不设本地并发上限；每镜目标固定为 `board-epNNN-NNN`，传 `{kind:"storyboard",episode_key,version_id,shot_number}`，实际 prompt 必须等于本 Skill 当前阶段已留痕的 Provider 提示词输出。本地参考图统一放入 `reference_paths`，不得使用仅供视频或 RunningHub H3 分类素材使用的 `reference_image_paths`；`reference_manifest` 必须与路径等长且逐项包含 `{type:"image",order,asset_key,version_id,role}`，其中 order 从 1 连续递增、资产必须是当前 selected 本地版本。无参考图时两个数组都传 `[]`。提交前确认模型、数量、尺寸、全部参考路径和费用。检查人物身份、服装、场景锚点、道具、轴线、格数、阅读顺序、裁切和禁字；随后用 `asset-ledger.mjs fetch` 将每个候选保存到本地 `assets/storyboards/`，写入相同分镜文档引用、Provider、模型、任务、参考资产和参数 provenance，选版后才能进入视频提示词。

使用 StarRouter 时明确从以下枚举取值：`model=gpt-image-2`；`resolution ∈ {1K,2K,4K}`；`aspect_ratio ∈ {1:1,16:9,9:16,4:3,3:4}`；`quality ∈ {auto,low,medium,high}`；`background ∈ {auto,opaque,transparent}`；`moderation ∈ {auto,low}`；`output_format ∈ {png,jpeg,webp}`；`n=1..4`。
