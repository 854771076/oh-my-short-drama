---
name: analyze-reference-video
description: 导入或读取项目内已选择的本地参考短视频，拆解为带时间码、关键帧、转写依据、权利边界和置信度的参考视频分析；不直接生成复刻成片。
---

# 分析参考短视频

仅用于 `.short-drama/project.json` 的 `workflow.type=viral-recreation`。用户提供平台链接时必须先检查元数据并取得下载/参考分析权利确认；不得把 `automation_mode` 当作确认。抖音/TikTok 优先使用配置好的本机 DTK v5，其他平台使用 yt-dlp：

```bash
node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/reference-video-import.mjs" inspect '<链接或分享文本>'
node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/reference-video-import.mjs" import <项目目录> '<链接或分享文本>' <source-key> <version> --rights-basis owned|licensed|authorized-reference
```

`DTK_API_KEY`、Cookie 等凭据只能从本机环境或下载器自身配置读取，不得写入项目、命令参数、日志或提示词。链接导入完成后确认 `source/manifest.json` 中存在已选择的 `reference-video` 来源，再运行：

```bash
node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/reference-video.mjs" prepare <项目目录> <source-key> <version>
```

完整观看或逐镜查看准备清单列出的关键帧；存在音轨时使用已配置 ASR 或用户提供的字幕核对台词。自动 scene score 只提供候选切点，不得把它叙述为已经人工确认的叙事边界。只能通过受控导入命令下载，不得自行请求媒体 CDN 或把参考原片登记进正式视频资产账本。

必须取得用户对 `rights.status`、`allowed_uses` 和限制的明确说明。`allowed_uses` 与 `restrictions` 只能使用 `analysis`、`authorized-close-recreation`、`identity`、`voice`、`music`、`trademark`、`dialogue`、`visual-style` 这些受控能力值，禁止填写自由文本以绕过交集校验。未知权利只能记录为 `reference-only`，且后续仅允许结构迁移。`automation_mode` 不能代替权利确认。

读取 `assets/prompts/reference_video_analysis.{zh,en}.txt` 的 `reference_video_analysis` Codex 合同，用 prepared 清单、项目配置、关键帧观察和转写生成 `.short-drama/reference-video-analysis.json`。每项结构判断必须回链 `evidence[].id`；原片事实、机制推断和创作建议分开，不能把标题、画面猜测或不完整 ASR 写成确定事实。

先运行：

```bash
node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/recreation-workflow.mjs" validate-analysis <分析文件>
```

再用 `project-store.mjs put-document <项目> reference-video-analysis <分析文件>` 落盘，并用 `render-prompt.mjs --codex-output` 保存合同运行记录。准备清单、分析文件和合同记录缺一不可。
