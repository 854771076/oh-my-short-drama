---
name: edit-deliver-drama
description: 验收并打包已经完成时间线渲染的短剧成片。用于最终技术检查、文件命名、版本清单、SRT/ASS/manifest 汇总与交付；不再编辑时间线。
---

# 验收与交付

只接收 `edit-drama-timeline` 按 [本地 Remotion 剪辑方案](../../references/editing-workflow.md) 完成并通过审片的渲染版本。用 `media-tools.mjs qc` 核对分辨率、画幅、帧率、实际时长、编码、采样率、声道、响度和黑帧/冻结/静音事件；目标时长不要求逐秒命中，默认约 ±15% 的自然偏差不作为失败，超出时核对叙事理由和用户确认。从头到尾观看并听完，复核叙事、画面、声音、全部切点、字幕和片尾。交付前必须特别确认字幕不是默认黑底贴纸、说话人层级清楚、文字处于安全区；逐切点检查动作方向、视线、环境声和空间轴是否连续，并抽检淡化精确起始帧，避免仅靠长黑帧检测漏掉单帧黑闪。任何关键动作仅靠生成模型“应该会发生”而未在画面中实际成立，均不得标记为通过。

批准版视频、UTF-8 SRT 和 ASS 放入 `delivery/<episode-key>/` 后，运行 `node scripts/editing-store.mjs manifest <项目> <episode-key> <成片> <SRT> <ASS>`；脚本会重新校验该集时间线与完整审片记录，计算文件哈希，并以独占方式建立 `delivery/<episode-key>/manifest.json`。所有选中剧集均登记本 Skill 的 manifest 证据并通过 delivery 门禁后，执行 `node scripts/workflow.mjs complete <项目>` 固化项目终态。交付不得夹带临时缓存、未批准候选或覆盖既有 manifest。
