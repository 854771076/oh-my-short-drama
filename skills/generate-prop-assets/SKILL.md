---
name: generate-prop-assets
description: 从剧本识别并生成需要长期保持一致的关键道具资产。用于道具筛选、视觉描述修订、图片候选与选版。
---

# 生成道具资产

用 `select_prop`，向 `input` 传目标文本、向 `props_lib_name` 传已有道具库。只保留可移动、不可替代且有跨场景或长期持有证据的实体；普通家具、餐具、服装、场景设施和一次性物件不建资产。无合格项时接受 `{"props": []}`。

`props[].description` 只写材质、颜色、形状、结构、数量与装饰。参考图或修改指令引起描述变化时，用 `prop_description_update`；出图时用 `prop_generate` 把已确认描述与艺术风格编译为主视图、正/侧/背视图和有证据的结构细节设定板，不在调用处另拼隐藏提示词。

同一道具存在多个状态版本时，先生成并选定基础状态；后续状态必须把该选版作为身份参考，只改变版本证据明确要求的开合、破损、内容物或使用痕迹，并保持尺寸等级、结构、材质、纹样和独特锚点。基础状态缺少可用选版时不生成派生状态；不得用人物或手部充当尺度参照。

对同一依赖层的全部道具全量并发调用 `generate_image`，不设本地并发上限；派生状态只在基础状态选版后进入下一并发层。生成白底居中、单道具资产图，传 `{kind:"asset-plan",episode_key,version_id,asset_key}`，实际 prompt 必须等于 `prop_generate` 的已留痕输出；提交前确认模型、数量、尺寸、参考路径和费用。检查结构、数量、纹样和损伤状态后，用 `asset-ledger.mjs fetch|decode` 保存候选、写入相同制作文档引用并选版。

StarRouter 图片枚举：`model=gpt-image-2`；`resolution ∈ {1K,2K,4K}`；`aspect_ratio ∈ {1:1,16:9,9:16,4:3,3:4}`；`quality ∈ {auto,low,medium,high}`；`background ∈ {auto,opaque,transparent}`；`moderation ∈ {auto,low}`；`output_format ∈ {png,jpeg,webp}`；`n=1..4`。
