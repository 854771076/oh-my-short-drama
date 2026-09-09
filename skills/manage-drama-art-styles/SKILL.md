---
name: manage-drama-art-styles
description: 管理、选择和变更已有短剧画风配置。用于绑定项目画风、比较预览和计算风格变更影响；不负责从描述生成新画风。
---

# 管理短剧艺术风格

读取项目当前画风和已有候选；创建新画风时路由到 `generate-drama-art-style`。选择画风时检查 prompt、visualBible、预览图和适用题材，风格不得包含具体人物身份、剧情事件或与场景冲突的地点事实。

生成预览前确认模型、尺寸和费用；使用同一中性测试内容比较候选。预览图下载到本地资产库并记录 provenance，选定的结构化风格配置写入 `.short-drama/project.json` 的 `creative.art_style`。`update-project` 会把既有人物、场景、道具、故事板和视频版本标记为 stale 并取消选版；重新生成使用新版本，不得清除旧版失效记录。
