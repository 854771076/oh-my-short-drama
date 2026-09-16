---
name: build-drama-storyboard
description: 把单集剧本和确认资产拆成连续、可拍摄的结构化镜头。用于生成镜号、时长、构图、表演、摄影和转场合同。
---

# 构建分镜

先核对源剧本语言、交付语言、人物说话语言和字幕语言，并从已选 Provider/制作计划取得 `shot_duration_constraints`。由 Codex 使用本 Skill 的 `assets/prompts/agent_storyboard_plan.{zh,en}.txt` 生成严格 JSON；需要整集合同输出时，向 `professional_storyboard` 显式传入 screenplay_contract、asset_whitelist、cinema_knowledge、production_constraints、correction 和 target_language。再按需使用 `agent_cinematographer`、`agent_acting_direction` 与 `agent_storyboard_detail` 细化。

每镜必须可追溯到本地已选剧本和导演本，资产名必须来自 selected 清单。`viral-recreation` 项目还要读取当前分集编译约束包，把其中 Media 语义触发器和 Film 布局转译为逐镜设计，并在 `source_versions.recreation_workflow` 写入当前 selected 版本。逐镜检查剧情覆盖、重复、身份/版本、道具、场景、轴线、视线、运动方向和相邻转场合同。保存时将模板返回数组包装为 `{episode_key, source_versions, panels}`，P0/P1 清零后用 `project-store.mjs put-episode-document ... storyboard ...` 校验连续 panel_number 并保存不可变版本，再用 `select-episode-document` 选定。

分镜选定且制作计划完成后，必须交给 `plan-shot-continuity` 建立独立的 `camera_setup_id`、`start_state`、`end_state` 和 `transition_link` 合同，再进入视频提示词编译。分镜只描述本镜事实，不得提前伪造上一镜尾帧资产或用模糊的“保持连续”代替状态字段。

分镜必须是可拍摄的原子单元：一镜只允许一个时间地点、一个连续摄影机动作和一条主要因果动作链；不得把蒙太奇、平行剪辑、多个地点或互不依赖的动作塞进同一 panel。若剧作需要多个动作，拆成连续 panel，并为每个 panel 写清入点、动作完成点、出点、轴线、视线、道具接触和下一镜承接证据。生成前后都要检查人物数量、关键道具状态和屏幕/文字禁绘约束，不能用后期字幕替代缺失的画面因果。

每镜必须产出构图合同：瘦合同 `visual_plan.composition`（摄影细化为 `composition_contract`，专业故事板为 `photographyPlan.composition`）含 primary/secondary、reason、evidence，`composition_contract` 与 `photographyPlan.composition` 另含 ai_risks 与 11 个可见几何字段（不含 reason）。写摄影与分镜提示词前先读取 [导演构图模式参考](../../references/director-composition.md)：它是 64 个构图模式、证据等级与风险码的权威目录（机器枚举是受控词表 `cinematography.compositionPatterns`，紧凑名经变量注入，不得自造 code 或名称）。按“场级母题→唯一首要可读信息→primary（最多一个 secondary）→可见几何→核证据”选码，把主体位置、视线留白、前中后景、光源、遮挡、动作方向、镜尾状态写进画面描述；禁止只复读构图名称、逐镜机械轮换，或在证据不足时添加原文/资产之外的天气、陈设、武器与多余人物。

三名以上具名人物同框时先设计可读覆盖：锁定人数、左右顺序、朝向、前后层次和每人的说话/倾听任务；同一时刻只让能清楚归属的角色承担主要说话或道具交互，其余角色用有任务的关系反应维持在场。若一个镜头同时要求群体全貌、两人表演、手部细节和复杂交互，按叙事重心拆为关系镜、动作/插入镜与反应镜，不把所有信息塞进一次生成。
