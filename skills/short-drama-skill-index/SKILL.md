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
- 人物档案与完整角色原画设定板 → `generate-character-profiles`、`generate-character-images`
- 场景、道具 → `generate-scene-assets`、`generate-prop-assets`
- 首次拆镜、分镜修订 → `build-drama-storyboard`、`revise-drama-storyboards`
- 分镜图、图片确定性变换 → `generate-storyboard-images`、`transform-drama-media`；制作计划后先完成整集分镜图及 `review-drama-shots` 八维审计，才能进入视频
- 制作规划、Seedance 2.0/H3/通用视频提示词 → `plan-drama-production`、`write-drama-video-prompts`
- 视频镜头 → `generate-drama-videos`
- 配音、TTS、口型 → `design-drama-audio`
- 镜头验收、时间线、交付 → `review-drama-shots`、`remotion-best-practices`、`edit-drama-timeline`、`edit-deliver-drama`
- 画风生成、选择与变更 → `generate-drama-art-style`、`manage-drama-art-styles`
- 阿里云百炼、StarRouter、RunningHub、Comfly 等 Provider 配置和媒体生成 → `configure-generation-providers`、`drama-generation-service`
- Provider 只接受公网 URL 时临时发布本地参考图 → `publish-drama-references`
- 本地任务监控和故障恢复 → `monitor-drama-tasks`、`recover-drama-pipeline`

所有生成结果必须先保存到本地项目再进入下一步；远程 URL、任务 ID 或聊天内容都不是资产。用 `node scripts/audit-plugin.mjs` 检查插件自身完整性，不读取任何外部业务仓库。

完整制作不能把本索引当作阶段 Skill 的替代品。先运行 `node scripts/skill-runs.mjs required <项目目录> <阶段>`，完整读取并执行列出的原子 Skill；完成后用 `record` 绑定项目内证据，阶段门禁会验证这些记录。
