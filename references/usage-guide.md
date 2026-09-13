# 本地标准短剧使用手册

原项目能力的保留、转换、排除和当前边界见 [能力审计](feature-completeness.md)。

## 制作顺序

1. **初始化项目**：`manage-drama-projects` 按项目规范 v1 创建固定配置、目录与状态，并归档 `src-xxx@v001` 原始资料。
2. **Codex 分析**：`analyze-drama-source` 直接分析已选本地小说与要求；再形成简报、故事圣经和分集目录，不调用文本模型。
3. **剧本落盘**：`short-drama` 提供开场、节奏、爽点、钩子和合规方法，`write-drama-episode` 由 Codex 写作或转换初稿，`humanizer` 产生自然化新版本，`review-drama-script` 对当前版本形成批准报告。
4. **导演本落盘**：`write-drama-director-book` 形成场次级导演执行意图。
5. **资产分析与画风**：`plan-drama-assets`、`generate-character-profiles` 确认资产范围，`generate-drama-art-style` 确认或生成项目统一画风。
6. **资产生成落盘**：人物完整原画设定板、场景多视角设定板、道具设定板通过 `drama-generation-service` 调用用户选择的 Provider；结果全部进入本地资产账本。
7. **制作规划**：构建/修订结构化分镜，`plan-drama-production` 逐镜判断单图/故事版/分镜板及实际格数，并锁定模型、`prompt_profile`、输入模式、参考顺序和预算；`write-drama-video-prompts` 再按 Seedance 2.0、MiniMax H3 或已确认的通用协议编译并保存提示词版本。
8. **分镜图与素材制作**：先生成、落盘并选定整集分镜图，再从空间、时间、物理、光线等八个维度逐镜审计；全部通过后才允许生成视频。音频按声音策略执行，任务和文件全部本地对账。
9. **剪辑**：`remotion-best-practices` 约束 Remotion 工程与帧确定实现，`edit-drama-timeline` 按本地剪辑方案完成粗剪、字幕、转场、声音和渲染。
10. **成片**：`edit-deliver-drama` 逐集完整审片并输出 `delivery/<episode-key>/`。

文本资产默认由 Codex 直接生成，不使用外部文本模型。图片、视频、音频才进入生成 Provider 路由。

付费确认只授权费用，不改变阶段。生成 MCP 会在请求落盘前检查当前阶段和全部上游门禁；直接编辑 `selected.json`、项目配置或占位文档不能使越级调用通过。

每一步不是只“参考”表中的 Skill：进入阶段后运行 `node scripts/skill-runs.mjs required <项目目录> <阶段>`，完整读取并执行返回的每个原子 Skill，再用 `record` 关联实际项目产物。`workflow.mjs advance` 会拒绝没有 Skill 执行凭证的剧本、导演本、资产、分镜、制作计划、媒体或剪辑结果。

## 原子 Skill

| Skill | 用途与使用场景 | 上下游/顺序 | 必须由用户确认 |
|---|---|---|---|
| `manage-drama-projects` | 按规范 v1 初始化和校验本地项目、来源、分集、剧本、导演本、制作计划与分镜版本 | 全流程控制面；第一步 | 项目目录、名称、语言、画幅、集数；旧配置迁移、覆盖/重命名 |
| `analyze-drama-source` | Codex 全量分析小说、资料和制作要求 | 初始化后；先于简报/剧本 | 原文范围、改编边界、冲突要求 |
| `define-drama-brief` | 固化题材、受众、平台和交付边界 | source analysis 后 | 平台、语言、画幅、集数、目标时长、分级、禁区；目标时长默认允许约 ±15% 自然浮动 |
| `design-drama-bible` | 建立世界观、人物弧、冲突和结局 | brief 后 | 结局类型、人物关系、重大改编 |
| `outline-drama-series` | 拆分分集冲突、兑现和钩子 | bible 后 | 总集数、单集时长、分集结构 |
| `short-drama` | 用开场、节奏、爽点、钩子、反派、付费卡点和合规方法指导剧本 | script 阶段首个方法层 | 改编事实、集数、结局和付费策略变化 |
| `write-drama-episode` | Codex 编写或忠实转换单集剧本 | outline 后 | 原创/忠实转换、目标集、剧情改动、台词定稿 |
| `humanizer` | 减少模板腔、说明腔和角色同声，保持剧情事实与制作约束 | 剧本初稿后、复核前 | 用户语言样本；任何会改变台词含义或剧情事实的修改 |
| `review-drama-script` | 复核开场、节奏、兑现、对白、连续性、合规和可制作性 | 自然化后、导演本前 | 接受 P2；P0/P1 必须修改后重审 |
| `write-drama-director-book` | 生成场次级表演、调度、摄影、光线和声音导演本 | 已选剧本后 | 改变剧情含义、表演基调或声音策略的决定 |
| `plan-drama-assets` | 识别本集人物、场景、关键道具及叙事版本 | 导演本后 | 资产范围、合并/拆分、版本需求 |
| `generate-character-profiles` | 建立人物事实、别名、关系、长期表演与声音特征 | 资产分析阶段 | 人物身份、关系、是否出镜、持续造型 |
| `generate-drama-art-style` | Codex 生成项目画风、色板、光线和运动语言 | 资产生成前；默认真人风格可直接确认 | 画风名称/描述、参考图、预览模型和费用 |
| `manage-drama-art-styles` | 选择、绑定或变更已有画风并计算 stale 范围 | 画风生成后或变更时 | 入选画风和重新生成范围 |
| `generate-character-images` | 生成含脸部特写、正侧背全身和辅助设定的角色原画板 | 人物档案确认后 | Provider、模型/工作流、候选数、尺寸、参考图、费用、选版 |
| `generate-scene-assets` | 提取并生成无人场景候选 | 资产分析后 | 场景层级、锚点、Provider、候选数、尺寸、费用、选版 |
| `generate-prop-assets` | 提取并生成关键道具候选 | 资产分析后 | 是否值得独立资产、Provider、候选数、尺寸、费用、选版 |
| `manage-drama-assets` | 将文件、URL、base64 结果归档本地，登记哈希和选版 | 每次媒体生成后立即执行 | 导入目标、文件名、选版、回退或覆盖影响 |
| `build-drama-storyboard` | 将剧本、导演本和已选资产拆成结构化镜头 | 资产选版完成后 | 镜头数量/时长、剧情覆盖、台词和镜头策略 |
| `revise-drama-storyboards` | 插镜、变体、修改、重排并保留分镜版本 | 已有分镜后按需 | 修改镜头、剧情影响、批量范围、选定版本 |
| `write-drama-video-prompts` | Codex 把分镜编译成 Seedance 2.0、MiniMax H3 或通用逐镜提示词，并本地版本化 | 制作计划锁定模型与参考顺序后 | prompt_profile、input_mode、时长、参考用途/顺序、声音方式、台词、转场意图 |
| `plan-drama-production` | 汇总逐镜生成方式、Provider、参考素材、依赖与预算 | 媒体生成前最后门禁 | Provider、模型/工作流、尺寸、时长、候选数、参考文件、预算和批量付费范围 |
| `drama-generation-service` | 路由 StarRouter、RunningHub、Comfly 等图片/视频/音频 Provider | 所有付费媒体生成入口 | Provider、模型/工作流、参数、参考文件用途、费用；切换或重试 |
| `publish-drama-references` | 查询或用 Litterbox 临时托管把本地选版图转为公网 HTTPS URL | Comfly 等 Provider 不接受本地文件时 | 先查有效收据；素材权利、公开暴露、用途许可、逐项资产版本和 1h/12h/24h/72h 时效；强制重传需再次确认 |
| `configure-generation-providers` | 配置和探活 Provider，不生成 | 首次使用或凭据/目录变化时 | 各模态 Provider 选择；密钥由用户自行配置 |
| `generate-storyboard-images` | 按制作计划逐镜生成单图、故事版或分镜板 | 制作计划批准后、所有视频生成前；整集必做 | Provider、AI 已判断的类型/格数、尺寸、候选数、参考图、费用、选版 |
| `generate-drama-videos` | 生成并下载逐镜视频 | 分镜图与视频提示词确认后 | Provider、模型/工作流、时长、分辨率、参考素材、声音、费用、重试 |
| `design-drama-audio` | 为 post-dub/independent 镜头做声音分析、音色、TTS、配音和口型；H3 原生音频不重复调用 | 制作计划或逐镜视频阶段 | 音频 Provider、声音权利、MiniMax voice_id/工作流、文本、语速、格式、费用、选版 |
| `transform-drama-media` | 改图、二维转真人、宫格拆分、裁剪和抽帧 | 媒体生产中按需 | 生成式变换的 Provider/费用；裁剪和覆盖范围 |
| `monitor-drama-tasks` | 本地登记、去重、查询异步任务并校验完成文件 | 媒体生产贯穿执行 | 取消任务、扩大重试或重新付费 |
| `recover-drama-pipeline` | 恢复中断任务、缺失下载和 stale 下游 | 失败或续作时 | 重提、换 Provider/模型、重新付费、回退阶段 |
| `review-drama-shots` | 审计分镜图的空间、时间、物理、光线等八维逻辑，并验收视频的视觉/声音/转场/字幕 | 分镜图选版后、视频生成前必做；视频落盘后再次执行 | 接受 P2 缺陷、重生成或选用替代版本 |
| `remotion-best-practices` | 约束 Remotion 工程、React 时间线、字幕、音频、预览与渲染 | editing 阶段首个实现层 | 工程初始化、外部包安装和输出规格 |
| `edit-drama-timeline` | 用本地 Remotion 工程完成剪辑、字幕、转场、声音和渲染 | 全部选镜验收通过后 | 入选版本、剪辑结构、字幕样式、转场、声音目标、输出规格 |
| `edit-deliver-drama` | 完整审片、技术检查和本地交付打包 | 最后一步 | 批准版、文件名、交付目录和发布规格 |
| `orchestrate-short-drama` | 按状态机编排完整流程，不替代原子工作 | 新建、继续、查看项目时 | 阶段回退、批量范围和任何付费动作 |
| `short-drama-skill-index` | 按产物类型查找对应 Skill | 不确定该调用谁时 | 无；只路由 |
| `use-short-drama-studio` | 使用者入口，解释全流程、依赖、顺序和确认门禁 | 开始制作或询问怎么使用时 | 汇总当前缺失决策，不自行代选 |

## 通用门禁

项目配置 `automation_mode` 默认为 `true`。开启时由 agent 自主完成下表中的常规确认；关闭时才等待用户逐项确认。阶段门禁、权限/素材权利事实和安全校验始终有效。

- 覆盖、删除、重命名、阶段回退、批量生成、付费重试、切换 Provider/模型/工作流、上传参考素材和最终选版都必须产生确认记录。
- 多集项目仍按全局阶段推进；分集级 Skill 必须为每个已建 `ep-NNN` 同时登记独立产物，Codex 合同运行记录必须逐一绑定对应分集证据，不能用某一集替其他集背书。
- Provider 返回成功不等于完成；本地文件、哈希、provenance、账本和验收缺一不可。
- 用户未确认的参数保持未决，不用示例值或所谓“最佳实践”替用户决定。
