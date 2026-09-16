---
name: orchestrate-short-drama
description: 编排从创意到成片的短剧生产流程。用于新建、继续或查看短剧项目进度；不代替各阶段的创作和验收 Skill。
---

# 短剧流程编排

首次使用先读取 `use-short-drama-studio`。恢复项目先读取 `.short-drama/RESUME.md`，再运行 `node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/validate-project.mjs" <项目目录>` 和 `workflow.mjs status <项目目录>`；状态不存在时，经用户确认目录后调用 `manage-drama-projects` 初始化。进入媒体或剪辑阶段前分别运行 `node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/preflight.mjs" <media|editing> <项目目录>`。推进前运行 `workflow.mjs check`；`advance` 也会强制检查当前阶段的 selected 文档、未决项、资产、任务、逐镜验收或审片记录。按 [本地状态机](../../references/pipeline.md) 依次执行分析、剧本、导演本、资产分析、资产生成、制作规划、素材视频与配音、剪辑和交付。

当 `project.json.workflow.type=viral-recreation` 时不增加新的全局阶段：在 analysis 内先准备当前 selected 参考视频，执行 `analyze-reference-video` 与 `design-video-recreation`，并核对 prepared、分析、selected 复刻工作流和来源 SHA-256 的完整证据链。工作流使用台词段和词语作为媒体触发锚点，后续仍编译到现有 brief、剧本、导演本、分镜、制作计划和 Remotion 时间线。

读取 `project.json` 的 `automation_mode`：为 `true`（默认）时由 agent 自行决定常规确认项并继续流程；异步媒体任务单次等待超时或状态无变化时，必须继续调用对应批量等待工具直到终态，不得把工具超时当作任务结束或再次询问用户。为 `false` 时逐项等待用户确认。无论模式如何，阶段门禁、权限/素材权利事实和安全校验都不可绕过。

每个阶段开始前，先运行 `node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/skill-runs.mjs" required <项目目录> <阶段>`，逐个完整读取返回 Skill 的 `SKILL.md` 并按其合同产出；不能只参考总入口或自行模仿产物。每个 Skill 完成后运行 `node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/skill-runs.mjs" record <项目目录> <阶段> <skill> <项目内证据路径...>`；同一阶段已有各 Skill 证据、只是配置或提示词变更导致凭证失效时，可运行 `skill-runs.mjs record-stage <项目目录> <阶段>` 一次重算证据哈希和提示词绑定。`workflow.mjs <check|advance>` 会同时检查产物和 Skill 执行凭证；缺少任一项都不得推进。

禁止直接创建 `selected.json` 或手工拼装分镜、制作计划、视频提示词来绕过 `project-store.mjs`。生成 MCP 也会校验当前阶段及全部上游门禁：人物/场景/道具图只允许在 `asset-generation`，分镜、视频、语音和音乐只允许在 `media-production`。制作计划逐镜选择图片或白模分镜；图片镜头须完成选版与八维审计，白模镜头须完成导演合同、选版和 85 分验收，才允许提交正式视频。因此“用户已确认付费”不等于允许越级生成。

每阶段必须在本地留下可回读产物和验收结论，再执行 `advance`，且只能进入紧邻下一阶段。资产分析阶段先确认画风；资产 Skill 按已选计划动态要求，有人物、场景或道具才加载对应完整设定板 Skill。上游修改导致返工时使用 `rewind`。模型任务提交后写入本地任务账本；图片、音频和视频必须下载或复制到本地资产库后才能完成。付费范围、素材含义或交付目标不明确时只做只读检查。

媒体阶段内部按唯一顺序编排：`character-appeal → continuity-plan → previous-tail → native-audio → native-audio-review → audio-fallback → lip-sync → licensed-music → media-editing → video-upscale → delivery`。其中 previous-tail 只用于同场景同机位且状态连续的相邻镜；audio-fallback 只能来自未通过的原生音频维度与精确区间；lip-sync 只用于可见且绑定 selected 独立音频的对白；video-upscale 只处理已选视频候选，输出仍须完整复看和专项审核。缺少前置证据时跳过可选能力或回退其所属原子 Skill，不得靠总体评分补偿硬失败。

媒体阶段开始前必须确认当前任务确实暴露 `drama-generation` MCP 工具；缺失时流程阻断，并要求使用 `⌘Q` 完全退出 Codex 后重新打开。不能创建 placeholder 媒体文件，也不能把 Codex 文本输出当作图片、视频或音频生成结果。

剪辑阶段不得把旧的“候选通过”记录当作正式审片；上游镜头、提示词或选版变化会使下游时间线和审片失效，必须回退到对应阶段重新执行并记录 Skill 凭证。最终候选需同时保留原始成片、修复版、时间线、逐镜观察、全片六维审片和 manifest，明确标记尚未通过的限制，不以视觉包装掩盖叙事缺口。
