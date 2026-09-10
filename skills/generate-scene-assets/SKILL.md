---
name: generate-scene-assets
description: 从剧本提取并生成大场景、局部场景的视觉描述和图片候选。用于场景创建、修改、重生成、参考图修订与选版。
---

# 生成场景资产

先用 `select_location` 从目标文本提取需要独立背景图的 macro/micro 场景；不得把跨地点空间强行嵌套。输出 `locations[]`，每项保留三条 `descriptions`、2–6 个 `available_slots`，且站位锚点必须真实出现在描述中。

临时创建使用 `location_create`；后续按操作选 `location_modify`、`location_regenerate` 或 `location_description_update`。严格使用 [提示词索引](../../references/prompt-skill-index.md) 中的变量与 JSON 合同。图片候选默认生成无人空镜；只有原文明示且公共活动是空间语义的一部分时，才允许无名、非主体背景人群。具名人物、剧情动作、字幕和水印不得写入场景提示词。

`asset-plan` 中场景存在 `derived_from` 时，不得从零重画：先读取母场景当前 selected 本地图片，把它作为结构与材质参考，只生成版本证据明确要求的时段、天气、前景或陈设变化，并保持建筑骨架、出入口、固定锚点、尺度和磨损一致。母场景没有可用选版时将该变体保持 blocked，不用文字描述冒充视觉继承。

调用 `generate_image` 时传 `{kind:"asset-plan",episode_key,version_id,asset_key}`，实际 prompt 必须等于 `scene_asset_sheet` 的已留痕输出；提交前确认模型、数量、尺寸、参考路径和费用。检查父子空间、固定锚点、时代、建筑结构和光线方向，用 `asset-ledger.mjs fetch|decode` 保存候选、写入相同制作文档引用并选版。

正式出图必须用 `scene_asset_sheet` 生成同一场景的九视角网格、平面布局、轴测图、色卡和关键材质样本；各视角共享同一空间结构。不得在调用处退化为单张泛化背景。

StarRouter 图片枚举：`model=gpt-image-2`；`resolution ∈ {1K,2K,4K}`；`aspect_ratio ∈ {1:1,16:9,9:16,4:3,3:4}`；`quality ∈ {auto,low,medium,high}`；`background ∈ {auto,opaque,transparent}`；`moderation ∈ {auto,low}`；`output_format ∈ {png,jpeg,webp}`；`n=1..4`。
