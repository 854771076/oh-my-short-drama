---
name: short-drama-skill-index
description: 本地标准短剧插件的总索引。用于查询画风、人物/场景/道具设定板、分镜、视频等能力，或根据本地项目当前产物选择下一步 Skill；不执行生成。
---

# 本地短剧 Skill 索引

首次使用、完整生产或询问流程时先路由 `use-short-drama-studio`。普通操作读取本地 `.short-drama/state.json`，再路由到最小可完成目标的 Skill；模板归属见 [提示词索引](../../references/prompt-skill-index.md)。

- 小说/要求分析、简报、故事圣经、分集、剧本、自然化与复核 → `analyze-drama-source`、`define-drama-brief`、`design-drama-bible`、`outline-drama-series`、`short-drama`、`write-drama-episode`、`humanizer`、`review-drama-script`
- 导演本 → `write-drama-director-book`
- 本地项目、剧集、剧本和分镜版本 → `manage-drama-projects`
- 资产清单和本地媒体版本 → `plan-drama-assets`、`manage-drama-assets`
- 人物档案、成年魅力/儿童保护、完整角色原画设定板与人物专项审核 → `generate-character-profiles`、`generate-character-images`、`review-drama-shots`
- 场景、道具 → `generate-scene-assets`、`generate-prop-assets`
- 首次拆镜、分镜修订 → `build-drama-storyboard`、`revise-drama-storyboards`
- 分镜媒介 → 图片分镜使用 `generate-storyboard-images` 与 `review-drama-shots` 八维审计；白模分镜使用 `direct-blender-previz`、`generate-blender-previz` 与导演评分；图片确定性变换使用 `transform-drama-media`
- 制作规划、跨镜连续性、尾帧首帧承接、Seedance 2.0/H3/通用视频提示词 → `plan-drama-production`、`plan-shot-continuity`、`write-drama-video-prompts`
- 视频镜头 → `generate-drama-videos`
- 原生音频复听、受控 TTS/外部音频兜底与口型 → `design-drama-audio`；授权配乐与许可证也由该 Skill 规划，媒体登记和变换走 `drama-generation-service`、`transform-drama-media`
- 镜头验收、时间线、交付 → `review-drama-shots`、`remotion-best-practices`、`edit-drama-timeline`、`edit-deliver-drama`
- 画风生成、选择与变更 → `generate-drama-art-style`、`manage-drama-art-styles`
- 阿里云百炼、StarRouter、RunningHub、Comfly 等 Provider 配置和媒体生成 → `configure-generation-providers`、`drama-generation-service`
- Provider 只接受公网 URL 时临时发布本地参考图 → `publish-drama-references`
- 本地任务监控和故障恢复 → `monitor-drama-tasks`、`recover-drama-pipeline`

媒体能力的唯一逻辑顺序是：`character-appeal → continuity-plan → previous-tail（符合条件才启用）→ native-audio → native-audio-review → audio-fallback（仅审核失败）→ lip-sync（仅可见独立对白）→ licensed-music → media-editing → video-upscale → delivery`。可选节点不满足前置条件时直接跳过，不得伪造执行记录。

所有生成结果必须先保存到本地项目再进入下一步；远程 URL、任务 ID 或聊天内容都不是资产。用 `node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/audit-plugin.mjs"` 检查插件自身完整性，不读取任何外部业务仓库。

完整制作不能把本索引当作阶段 Skill 的替代品。先运行 `node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/skill-runs.mjs" required <项目目录> <阶段>`，完整读取并执行列出的原子 Skill；完成后用 `record` 绑定项目内证据，阶段门禁会验证这些记录。
