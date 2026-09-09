---
name: generate-storyboard-images
description: 将确认的结构化分镜生成为单格、宫格或手绘故事板图片。用于分镜出图、宫格拆分高清化、连续性验收与选版。
---

# 生成分镜图片

只读取本地已选中的分镜版本、制作计划和人物、场景、道具完整设定板。按逐镜 `image_strategy.board_type` 选模板：默认 `shot-board` 使用 `single_panel_image` 生成单张成片构图分镜板；`storyboard` 使用 `panel_storyboard_image` 生成片场沟通故事版。只有计划明确要求宫格连续关键帧时才使用 `panel_grid_image`。

严格填充 [提示词索引](../../references/prompt-skill-index.md) 的变量；宫格必须同时提供 `grid_layout` 与 `panel_grid_size`，不得把相邻镜头剧情画进当前镜头。宫格切单格后只允许用 `panel_grid_enhance` 保真高清化，不得重构图。

逐镜调用 `generate_image` 时目标固定为 `board-epNNN-NNN`，传 `{kind:"storyboard",episode_key,version_id,shot_number}`，实际 prompt 必须等于本 Skill 当前阶段已留痕的 Provider 提示词输出。提交前确认模型、数量、尺寸、全部参考路径和费用。检查人物身份、服装、场景锚点、道具、轴线、格数、阅读顺序、裁切和禁字；随后用 `asset-ledger.mjs fetch` 将每个候选保存到本地 `assets/storyboards/`，写入相同分镜文档引用、Provider、模型、任务、参考资产和参数 provenance，选版后才能进入视频提示词。

使用 StarRouter 时明确从以下枚举取值：`model=gpt-image-2`；`resolution ∈ {1K,2K,4K}`；`aspect_ratio ∈ {1:1,16:9,9:16,4:3,3:4}`；`quality ∈ {auto,low,medium,high}`；`background ∈ {auto,opaque,transparent}`；`moderation ∈ {auto,low}`；`output_format ∈ {png,jpeg,webp}`；`n=1..4`。
