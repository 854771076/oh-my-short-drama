---
name: orchestrate-short-drama
description: 编排从创意到成片的短剧生产流程。用于新建、继续或查看短剧项目进度；不代替各阶段的创作和验收 Skill。
---

# 短剧流程编排

首次使用先读取 `use-short-drama-studio`。恢复项目先读取 `.short-drama/RESUME.md`，再运行 `node scripts/validate-project.mjs <项目目录>` 和 `workflow.mjs status <项目目录>`；状态不存在时，经用户确认目录后调用 `manage-drama-projects` 初始化。进入媒体或剪辑阶段前分别运行 `node scripts/preflight.mjs media|editing <项目目录>`。推进前运行 `workflow.mjs check`；`advance` 也会强制检查当前阶段的 selected 文档、未决项、资产、任务、逐镜验收或审片记录。按 [本地状态机](../../references/pipeline.md) 依次执行分析、剧本、导演本、资产分析、资产生成、制作规划、素材视频与配音、剪辑和交付。

每个阶段开始前，先运行 `node scripts/skill-runs.mjs required <项目目录> <阶段>`，逐个完整读取返回 Skill 的 `SKILL.md` 并按其合同产出；不能只参考总入口或自行模仿产物。每个 Skill 完成后运行 `node scripts/skill-runs.mjs record <项目目录> <阶段> <skill> <项目内证据路径...>`。`workflow.mjs check|advance` 会同时检查产物和 Skill 执行凭证；缺少任一项都不得推进。

禁止直接创建 `selected.json` 或手工拼装分镜、制作计划、视频提示词来绕过 `project-store.mjs`。生成 MCP 也会校验当前阶段及全部上游门禁：人物/场景/道具图只允许在 `asset-generation`，分镜图、视频、语音和音乐只允许在 `media-production`；进入媒体阶段后必须先完成整集分镜图生成、落盘和选版，再由 `review-drama-shots` 完成空间、时间、物理、光线等八维审计，MCP 才允许提交第一条视频。因此“用户已确认付费”不等于允许越级生成。

每阶段必须在本地留下可回读产物和验收结论，再执行 `advance`，且只能进入紧邻下一阶段。资产分析阶段先确认画风；资产 Skill 按已选计划动态要求，有人物、场景或道具才加载对应完整设定板 Skill。上游修改导致返工时使用 `rewind`。模型任务提交后写入本地任务账本；图片、音频和视频必须下载或复制到本地资产库后才能完成。付费范围、素材含义或交付目标不明确时只做只读检查。

媒体阶段开始前必须确认当前任务确实暴露 `drama-generation` MCP 工具；缺失时流程阻断，并要求使用 `⌘Q` 完全退出 Codex 后重新打开。不能创建 placeholder 媒体文件，也不能把 Codex 文本输出当作图片、视频或音频生成结果。

剪辑阶段不得把旧的“候选通过”记录当作正式审片；上游镜头、提示词或选版变化会使下游时间线和审片失效，必须回退到对应阶段重新执行并记录 Skill 凭证。最终候选需同时保留原始成片、修复版、时间线、逐镜观察、全片六维审片和 manifest，明确标记尚未通过的限制，不以视觉包装掩盖叙事缺口。
