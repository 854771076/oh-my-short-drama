---
name: analyze-drama-source
description: 由 Codex 分析小说、故事材料和用户制作要求。用于项目初始化后提取剧情事实、改编约束、人物场景道具线索与待确认问题；不调用外部文本模型。
---

# 分析短剧原始材料

先读取 `source/manifest.json` 中已选的本地 `src-xxx@v001` 小说、梗概、参考资料和 `.short-drama/project.json`，由 Codex 使用 `assets/prompts/source_analysis.{zh,en}.txt` 直接生成 `source-analysis.json`，记录来源版本、剧情时间线、冲突与主题、出场人物、场景、关键道具、可视化难点、内容边界、用户要求、事实证据位置和未决问题。不得调用外部文本模型。

分析只提取和判断，不擅自改编。原文事实、用户明确要求和创作建议分栏保存；冲突时列出差异并请求确认。长篇小说按章节分块分析后再合并稳定身份与时间线，不能用抽样代替全量覆盖。

结果用 `node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/project-store.mjs" put-document <项目目录> source-analysis <文件>` 落盘。需要改变集数、结局、人物关系、时代、平台、画幅、语言或内容分级时必须先让用户确认，再进入简报和剧本。
