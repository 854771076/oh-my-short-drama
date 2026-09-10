---
name: generate-character-images
description: 把已确认人物档案转换为完整角色原画设定板和图片候选。用于主形象、换装、脸部特写、正侧背主视图、辅助设定、修改与选版。
---

# 生成人物形象

主流程使用 `agent_character_visual`：`character_profiles` 只传已确认档案，`candidate_count` 传每个形象的候选数；输出必须是严格 JSON `characters[].appearances[].descriptions[]`。无档案的单人物请求才使用 `character_create`；修改、重生成和参考图反推分别使用 `character_modify`、`character_regenerate`、`character_description_update` 或 `character_image_to_description`。

正式出图必须用 `character_asset_sheet` 把已确认人物描述与项目画风编译为完整角色原画设定板：脸部特写、正/侧/背全身主视图以及有证据的服装、配饰、鞋履和表情辅助图。它不是普通三视图，因此不再路由独立三视图 Skill。

对所有无依赖形象全量并发调用 `generate_image`，不设本地并发上限；同一人物的派生造型只在基础形象选版后进入下一并发层。`prompt_document` 必须引用该人物所在的当前 `asset-plan`：`{kind:"asset-plan",episode_key,version_id,asset_key}`；实际 prompt 必须等于 `character_asset_sheet` 的已留痕输出。参考图仅传该人物已选主形象，避免串脸。提交前确认模型、数量、尺寸、参考路径和费用。检查脸型、发型、体型、服装版本、时代与标志物；每个候选都用 `asset-ledger.mjs fetch|decode` 保存到本地人物目录并写入相同制作文档引用，只有人工确认项可 `select`。

使用 StarRouter 时明确从以下枚举取值：`model=gpt-image-2`；`resolution ∈ {1K,2K,4K}`；`aspect_ratio ∈ {1:1,16:9,9:16,4:3,3:4}`；`quality ∈ {auto,low,medium,high}`；`background ∈ {auto,opaque,transparent}`；`moderation ∈ {auto,low}`；`output_format ∈ {png,jpeg,webp}`；`n=1..4`。人物资产默认 `background=opaque`；需要后期抠图时才确认 `transparent`。
