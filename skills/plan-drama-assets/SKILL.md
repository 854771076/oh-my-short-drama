---
name: plan-drama-assets
description: 从目标集剧本提取人物、场景和关键道具资产。用于建立资产清单、视觉设定和选版门禁。
---

# 规划短剧资产

读取已选剧本、导演本、来源分析、简报和 `assets.json`，用本 Skill 的 `assets/prompts/asset_analysis.{zh,en}.txt` 生成 `asset-plan.json`。只提取目标集实际出现的资产，区分年龄、服装、真假、损坏前后等连续性版本；人物别名归一，场景按 macro/micro 空间拆分，道具仅保留可移动、不可替代、跨镜持续或承担剧情功能的实体。

将所有 `unresolved` 一次汇总给用户确认。未决项清零后，用 `node scripts/project-store.mjs put-episode-document <项目> asset-plan <分集 key> <版本> <asset-plan.json>` 校验并保存不可变版本，再用 `select-episode-document` 选定。该写入会校验顶层合同、资产类型、稳定 key、证据、版本、状态和分集一致性。

本 Skill 只建立统一清单，不重复承担下游细化：人物事实交给 `generate-character-profiles`，人物视觉交给 `generate-character-images`，场景描述交给 `generate-scene-assets`，道具描述交给 `generate-prop-assets`。缺失、歧义、错版或未选版未清零时禁止拆镜。
