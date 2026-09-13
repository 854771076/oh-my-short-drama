---
name: generate-drama-art-style
description: 由 Codex 根据题材、时代、情绪和用户参考生成短剧画风配置与视觉圣经。用于资产生成前确定全项目统一画风；不调用外部文本模型。
---

# 生成短剧画风

读取 brief、bible、用户参考和项目当前 `creative.art_style`。未提出自定义画风时保留默认 `system-realistic`；提出明确画风时，由 Codex 使用 `assets/prompts/config_generation.{zh,en}.txt` 生成 prompt、description 和 visualBible，不调用文本 Provider。

画风必须统一人物、场景、道具、分镜与视频的媒介、色板、光线和运动语言，但不得写入具体人物身份、剧情动作或地点事实。需要预览时调用 `drama-generation-service`，确认图片 Provider、模型、尺寸、参考图和费用，并把预览保存到本地 `assets/other/`。

用户确认后，用 `project-store.mjs update-project` 将完整配置写入 `.short-drama/project.json` 的 `creative.art_style`。随后必须使用 `art_style_decision.{zh,en}.txt` 输出确认合同，并以 `project-store.mjs put-document <项目> art-style <JSON>` 保存为 `.short-drama/art-style.json`；其 style 必须与项目配置完全相同，才能登记本 Skill。

当用户确认的是自定义画风（而非系统画风）时，必须将完整 style 对象追加或更新到统一工作区根目录下的 `art-styles.custom.json`（或环境变量 `SHORT_DRAMA_CUSTOM_ART_STYLES_FILE` 指定的路径），确保下次可直接选择。只登记已确认且通过完整字段校验的画风；不得把草稿、未确认结果或系统画风复制进自定义库，也不得覆盖系统画风同 ID。修改已投入使用的画风必须标记受影响资产为 stale，不静默混用旧风格。
