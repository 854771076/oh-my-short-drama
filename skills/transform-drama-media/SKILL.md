---
name: transform-drama-media
description: 对短剧媒体执行编辑与确定性变换。用于图片改图、二维转真人、宫格合成或拆分、裁剪、高清化和视频首尾帧提取；不承担新的剧情创作。
---

# 转换短剧媒体

先区分语义生成与确定性变换。图片改图先由 Codex 使用 `image_prompt_modify` 输出严格 JSON，再把其中 `image_prompt` 原样作为媒体模型 prompt；生成入口会核对这份 Codex 合同留痕。二维角色转真人直接使用 Provider 提示词 `2d_to_live_action`。两者都引用目标资产所在的当前 `asset-plan` 或 `storyboard` 文档，需确认参考图、模型和费用；必须保持身份、构图和未授权区域不变。

宫格合成、宫格拆分、普通裁剪和视频帧提取属于确定性操作，使用 `node scripts/media-tools.mjs compose-grid|split-grid|crop|extract-frame`，不调用生成模型；`probe` 用于回读技术参数。视频引用槽位不足时的资产合板固定使用 `other-refpack-epNNN-NNN`，按制作计划中的引用顺序合成，并把所有源资产版本写入 `provenance.source_assets`。脚本要求显式输出路径且不接受原地覆盖意图。记录源文件哈希、参数和输出路径；格数、阅读顺序、裁剪区域或首尾帧位置不明确时先停止。生成式宫格高清化交给 `generate-storyboard-images`，不得把保真修复当重绘。
