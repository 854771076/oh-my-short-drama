---
name: plan-drama-production
description: 汇总本地导演本、已选资产和结构化分镜形成短剧制作计划。用于确定逐镜生成方式、Provider、模型、参考素材、声音、依赖、预算和验收顺序；不提交生成任务。
---

# 规划短剧制作

读取本地已选导演本、人物/场景/道具、分镜和项目配置。由 Codex 使用 `assets/prompts/production_plan.{zh,en}.txt` 输出 `production-plan.json`，逐镜记录：输入版本、图片类型、视频方式、声音方式、Provider、模型或工作流、`prompt_profile`、`input_mode`、分辨率、画幅、时长、候选数、参考素材及其用途与顺序、依赖关系、预计付费次数、失败回退和验收项。

逐镜的 `image_strategy.board_type` 可选 `shot-board`（分镜板）或 `storyboard`（故事版），默认 `shot-board`。视频引用顺序中分镜板/故事版优先占用一个图片槽位；其余人物、场景、道具超过 Provider 剩余图片槽位时，默认 `overflow_strategy=compose-assets`，使用 `media-tools.mjs compose-grid` 确定性拼为一张参考合板，并在 `reference_assets` 中只登记合板及其来源用途。用户要求保持素材独立时改为 `reject` 并把槽位不足写入 `unresolved`。

文本策划全部由 Codex 完成，不调用外部文本模型。Provider、模型/工作流、尺寸、时长、候选数、参考文件、声音方式、预算上限和批量付费范围必须逐项展示；只有用户确认后才把 `approved: true` 写入计划。

MiniMax H3 仅在 Provider 能力明确声明原生音频且用户选择原生声音时，才使用 `audio_strategy.mode=native`，并锁定逐秒对白表、全片音乐锚点和相邻镜头成对声音转场；此时不安排独立 TTS。其他情况进入 `design-drama-audio`。

使用 `project-store.mjs put-episode-document <项目目录> production-plan <episode-key> <version> <文件>` 保存不可变版本，并选定后进入素材视频与配音生产。计划不得包含 API Key、Token 或远程业务对象 ID。
