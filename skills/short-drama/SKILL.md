---
name: short-drama
description: 短剧全流程唯一入口。用于创建、恢复、分析、编剧、导演、资产、分镜、打斗与 Blender 白模、图片/视频/声音生成、审核、剪辑、交付、市场研究和 Hypit 参考视频复刻；根据项目状态渐进读取 references 模块，不暴露或猜选子 Skill。
---

# 短剧制作主 Skill

本 Skill 是插件唯一入口。专业能力保存在 `references/` 模块中；不要凭模块名自行模仿，也不要一次性读取全部 reference。始终由项目状态和 `references/module-map.json` 决定当前需要加载的最小模块集合。

## 固定控制循环

对新建、恢复、继续、修改或复刻项目统一执行：

1. 确认项目目录。除非用户指定其他绝对路径，新项目位于 `~/darma_project/<project-key>`。
2. 新项目读取 [项目管理模块](references/operations/manage-drama-projects.md) 后初始化；已有项目先读取 `.short-drama/RESUME.md`、`.short-drama/project.json`、`.short-drama/state.json`、`.short-drama/module-runs.json`（若不存在则读取旧 `skill-runs.json` 供迁移）、`.short-drama/environment.json` 和 `source/manifest.json`。
3. 运行：

   ```bash
   node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/validate-project.mjs" <项目目录>
   node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/workflow.mjs" status <项目目录>
   node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/module-runs.mjs" required <项目目录> <当前阶段>
   ```

4. 对返回的每个 `module_id`，从 `references/module-map.json` 读取唯一 `path`，完整读取该 reference 后执行其输入、输出、失败关闭和验收合同。
5. 文本由 Codex 生成；只有图片、视频、声音和媒体变换调用 Provider。所有提示词使用 `assets/modules/<module_id>/prompts/` 中登记的模板并通过 `render-prompt.mjs` 留痕。
6. 每个模块完成后登记实际输入与证据：

   ```bash
   node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/module-runs.mjs" record <项目目录> <阶段> <module_id> <项目内证据...> --input <项目内输入...>
   ```

7. 运行 `workflow.mjs check`；只有当前及已完成阶段的文档、资产、审核和 module-run 全部有效时才 `advance`。修改上游事实时按状态机回退，不手改完成状态。

## 九阶段基础路由

基础顺序以 `module-map.json` 为唯一机器事实：

| 阶段 | 基础模块 |
|---|---|
| analysis | `manage-drama-projects` → `analyze-drama-source` → `define-drama-brief` → `design-drama-bible` → `outline-drama-series` |
| script | `short-drama` → `write-drama-episode` → `humanizer` → `review-drama-script` |
| director-book | `write-drama-director-book` |
| asset-analysis | `plan-drama-assets` → `generate-drama-art-style`，存在人物时增加 `generate-character-profiles` |
| asset-generation | `manage-drama-assets`，缺少可复用资产时按需增加人物、场景、道具生成与生成服务模块 |
| production-plan | 按条件加入 `design-fight-video`，再执行分镜、制作计划、连续性与视频提示词模块 |
| media-production | 生成服务、镜头审核、视频生成和任务监控；按逐镜策略增加图片分镜或 Blender 白模，按声音策略增加音频模块 |
| editing | `remotion-best-practices` → `edit-drama-timeline` |
| delivery | `edit-deliver-drama` |

不得把本表当作静态清单绕过 `requiredModules()`；动态模块只由结构化项目事实触发。

## 条件模块

### 打斗与动作设计

只有导演本或制作决策明确存在 `action_complexity=choreographed`、`fight_design` 或 `fight_design_ref` 时加载 [打斗设计](references/storyboard/design-fight-video.md)。它适用于跨镜动作连续性、接触与受力结果、兵器、追逐、擒抱、跌倒、多人攻防或能力战。普通争吵、静态对峙、走路、握手、推门和简单拿放道具不触发；扇耳光、推搡和短暂拉扯只有被导演本明确判为需专业编排时触发。

### 图片分镜与 Blender 白模

制作计划逐镜选择 `storyboard_strategy.mode=image|blender`：

- `image` 加载图片分镜生成与八维审核，不加载白模生成。
- `blender` 加载 [白模编导](references/storyboard/direct-blender-previz.md)、[白模生成](references/storyboard/generate-blender-previz.md) 和七项导演验收，不制造占位分镜图。
- 打斗、多人调度、空间/轴线风险和连续运镜优先建议白模；静态特写、细腻表演、妆造与画风确认优先图片。
- UE Mannequin 是默认人物模型；镜头时长、导演合同、媒体实际时长和制作计划必须一致。生成成功不等于通过，必须完整观看并完成多维审计。

### 参考视频复刻

`workflow.type=viral-recreation` 时，analysis 改为：Dashboard → Provider 配置 → 参考视频导入 → Hypit → 正式参考分析 → 复刻设计。完整读取 [Hypit 模块](references/recreation/use-hypit-video.md) 和对应复刻 references。

- 下载统一先用 `yt-dlp`；遇到明确 403 或登录挑战，先让用户在其已有浏览器中登录并重试；仍失败才读取用户已登录的 Chrome 会话提取媒体流。禁止打开临时浏览器代替用户登录。
- 除媒体生成调用外，参考导入、拆解、剪辑和复刻事实优先由 Hypit 产出；Dashboard 仍负责当前项目、Provider、阶段状态和生成入口。
- 正式分析和下游文档必须绑定当前 selected 参考视频、Hypit handoff、分析与复刻工作流哈希。

### 声音

视频原生声音优先。原生对白、旁白、环境声和动作声先完整复听；只有声明的失败区间才加载第三方配音兜底。配音必须绑定原声时间线、说话人、语义、情绪弧、重音/停顿/呼吸和最终 selected 音频；字幕从实际最终音轨生成并复核。旁白要求电影感且富含情感。BGM 始终走独立授权或生成流程，未声明音乐不得交付。

### 市场与支持操作

市场模块只在用户明确要求或项目已绑定市场输入时加载。Dashboard、Provider 配置、资产管理、任务监控、媒体变换和故障恢复都是按需 reference，不是独立 Skill；MCP、CLI 与 Dashboard 工具入口保持可用。

## 全局硬门禁

- 不伪造原文、用户确认、权利、资产、Provider 调用、任务状态、媒体观看或审核结果。
- 付费生成前展示 Provider、模型、参数、候选数和预计次数；没有授权不得提交。
- 所有剧情事实、人物关系、结局、逐字对白与旁白变更先获得用户确认。
- 成年人物突出帅气、漂亮、飒、性张力、独立妆造和记忆点；儿童突出可爱并禁止成人化或性化。
- 任何人物、场景、道具、分镜、视频、音频和剪辑产物都必须登记真实本地路径、版本、来源和 SHA-256；不得用占位文件通过门禁。
- 图片分镜、白模、视频、原生声音、兜底配音和成片必须执行各自 reference 的完整多维审核。未观看/未听完不得批准。
- 复刻必须遵守权利范围；结构迁移不等于获得原人物、声音、音乐、字幕、品牌或镜头素材的使用权。
- Provider 失败不得静默切换、重复付费或隐式降低质量。用户允许兜底时也必须记录原因、范围和新确认。
- `automation_mode` 只减少常规确认，不得绕过阶段、权利、付费、安全、选版或质量门禁。

## 凭证与恢复

`module-runs.json` 的每条记录绑定 module ID、reference 路径与哈希、输入与哈希、输出证据与哈希、prompt-run 及完成时间。reference、输入、选版或证据变化后记录自动失效。旧 `skill-runs.json` 永不原地修改；`module-runs.mjs migrate` 只迁移来源快照和证据均可验证的记录，其余模块重新执行。

遇到失败先读取 [恢复模块](references/operations/recover-drama-pipeline.md)，保持失败关闭。需要更新分镜时生成新不可变版本，不覆盖旧版本；需要重新生成媒体时先检查已有请求、任务和收据，避免重复提交。

## 完成标准

只有 delivery 阶段的 module-run、时间线审片、技术 QC、字幕、声音、权利和交付清单全部有效，才可运行 `workflow.mjs complete` 并向用户报告完成。报告必须区分已完成、已审核、待确认、失败和允许兜底的部分。
