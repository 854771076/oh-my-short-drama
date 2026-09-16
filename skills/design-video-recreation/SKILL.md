---
name: design-video-recreation
description: 将已批准的参考视频分析编译为五层声明式复刻工作流，使用台词段和词语作为画面、字幕、声音与特效锚点；不以裸秒数写死作者层时间线，不绕过素材权利限制。
---

# 设计视频复刻工作流

仅用于 `workflow.type=viral-recreation`，且必须先完成 `analyze-reference-video`。读取当前 `.short-drama/reference-video-analysis.json`、项目配置和目标分集，由 Codex 使用 `assets/prompts/video_recreation_workflow.{zh,en}.txt` 的 `video_recreation_workflow` 合同生成：

```text
episodes/<episode>/recreation-workflow/vNNN.json
```

工作流必须同时描述 Script、Media、Caption、Speech、Film 五层，并把可替换内容声明为 `slots[]`。Media 触发器使用稳定 `segment_id` 和可选 `start_word/end_word`；不得只写“第几秒出现”。秒和帧属于后续编译结果，不是作者层唯一事实来源。

默认使用 `structure-only`：保留钩子、节拍、镜头功能、字幕和声音机制，但替换原人物、身份、原台词、商标、水印、音乐及禁止复制元素。只有分析文件的权利范围明确覆盖近似复刻时，才能使用 `authorized-close-recreation`，并填写 `rights_basis` 与 `rights_scope`。

先运行：

```bash
node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/recreation-workflow.mjs" validate-workflow <工作流文件> <ep-001>
```

再用 `project-store.mjs put-episode-document <项目> recreation-workflow <ep-001> <v001> <文件> --select` 保存并选版；选版会自动生成 `.short-drama/recreation-compiled/<episode>/<version>.json`，其中锁定工作流版本、工作流哈希和分析哈希。随后用 `render-prompt.mjs --codex-output` 保存合同运行记录。后续 brief、剧本、导演本、分镜、制作计划、视频提示词、音频与剪辑必须读取 selected 版本对应的编译约束包，不得只引用聊天内容或未选版本。
