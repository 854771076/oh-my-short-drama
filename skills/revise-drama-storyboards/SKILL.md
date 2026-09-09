---
name: revise-drama-storyboards
description: 修订已经存在的结构化短剧分镜。用于插镜、重生成镜头文本、生成镜头变体、编辑提示词、增删重排和恢复历史版本；不负责首次拆镜。
---

# 修订短剧分镜

先读取目标镜头、前后镜、源剧本片段、资产引用、selected 历史和当前 Provider 的 `shot_duration_constraints`。插镜用 `agent_storyboard_insert`；变体先用 `agent_shot_variant_analysis`，确认方向后再用 `agent_shot_variant_generate`；定向文本修改用 `storyboard_edit` 或镜头不可变编辑。

不得改变 `shotKey`、来源身份或未获授权的剧情事实。修改后重新检查剧本覆盖、台词逐字一致、人物/场景/道具版本、轴线、视线、动作方向、时长和相邻转场，并只使受影响的图片、视频提示词和视频版本 stale。删除、调序或批量重生成前必须明确影响范围。
