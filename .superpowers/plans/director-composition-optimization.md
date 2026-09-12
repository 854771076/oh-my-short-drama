# 导演构图全链路优化计划

## Global Constraints
- 保持旧项目文档兼容；新增字段必须可选或由新输出版本自然携带。
- 不新增 UI、Provider、MCP、hooks 或依赖。
- 中英文模板同步更新。
- 构图模式必须服务叙事并具备证据；禁止无来源雨、雾、霓虹、镜面、烟尘等风格元素。
- 每镜一个 primary 构图，最多一个 secondary。
- 动作镜必须保留地理、方向、蓄力、接触点、结果和反应。
- 完成后运行 node scripts/audit-plugin.mjs 及相关现有测试。

## Tasks

### Task 1: 构图知识库与受控词表
建立构图参考文档与受控词表，并注入模板系统变量。

- 新增 `references/director-composition.md`，完整收录文章的 64 个导演构图模式，按 basic/film/action/character 四组组织。
- 每个模式至少包含：code、中文名、英文名、画面结构、叙事功能、适用场景、证据要求、可组合模式、禁忌/AI 风险、竖屏提示。
- 文档必须写明选择流程：先确定本镜唯一首要可读信息，再选 primary；最多一个 secondary；再翻译为主体位置、视线/留白、前中后景、光源、遮挡、动作方向和镜尾状态。
- 明确证据等级：composition-only、set_dressing、weather_atmosphere、action_blocking；无证据不得添加雨、雾、霓虹、镜子、烟尘、门窗/廊柱等不在原文或资产中的元素。
- 在 `references/controlled-vocabulary.json` 的 `cinematography` 下新增 `compositionPatterns`，覆盖 64 个 code，字段保持机器友好：`code/category/zh/en/evidence/risks`；risks 没有则为空数组。
- code 命名固定为 `composition.basic.*`、`composition.film.*`、`composition.action.*`、`composition.character.*`。
- 更新 `scripts/prompt-system-vars.mjs`，把构图枚举紧凑加入 `cinematography_vocabulary`，同时更新中英文输出；不得把完整长文档注入所有模板。
- 添加最小可运行检查：优先扩展现有 `scripts/studio.test.mjs` 或新增小型 node:test，验证 64 模式、code 唯一、四组各 16 个、变量注入包含构图名称且 JSON 可解析。

### Task 2: 导演与分镜合同
扩展导演本、分镜、摄影、表演、细化和专业故事板合同。

- 更新 `write-drama-director-book` 中英文模板：`camera_strategy` 内新增场级 `composition_motifs`（1–3 个受控 code）和每个 motif 的叙事变化/回收方式；导演本仍不得拆最终镜号。
- 更新 `agent_storyboard_plan` 中英文模板：扩展 `visual_plan` 为 `{emphasis,standout,technique,composition}`，其中 composition 为 `{primary,secondary,reason,evidence}`；primary 必填且只能取词表 code，secondary 可为 null 或一个 code；reason 必须绑定 narrative_purpose；evidence 必须引用 source_text、场景/道具资产或动作事实。
- 明确构图选择顺序：场级 motif → 本镜唯一首要可读信息 → primary/secondary → 可见几何；不得每镜机械轮换。
- 更新 `agent_cinematographer` 中英文模板：新增 `composition_contract` 输出字段，包含 primary、secondary、read_order、subject_placement、depth_layers、eyeline_room、light_and_color_geometry、action_vector、tail_state、evidence、ai_risks；必须把构图 code 翻译成可见摄影结果，不能只复读名称。
- 更新 `agent_acting_direction` 中英文模板：表演必须服从构图中的阅读顺序、视线留白、隔离/遮挡和动作向量，但不得新增视觉字段。
- 更新 `agent_storyboard_detail` 中英文模板：保留并落实构图契约，把它写入 description、imagePrompt、动作/运镜/镜尾状态；禁止无来源视觉元素。
- 更新 `professional_storyboard` 中英文模板：在非空 `photographyPlan` 内要求 composition 合同，并确保 imagePrompt 至少落实主体位置、视线/留白、前中后景、光源/遮挡和镜尾状态；不得改变既有顶层字段清单。
- 保持旧项目可读：新增嵌套契约对新生成内容必填，模板不得要求历史文档重写；不要改 Provider、账本或 UI。

### Task 3: 媒体提示词编译
更新图像与视频媒体模板，把构图模式编译成可见几何和时间结构。

- 更新 `single_panel_image`、`panel_grid_image`、`panel_storyboard_image` 中英文模板：消费摄影合同中的构图 code 时，必须转写为主主体位置、阅读顺序、视线/留白、前中后景、光源/明暗、遮挡/隔离物、动作线和镜尾静止点；禁止只把“电影感/压迫/孤独”等抽象词或构图名交给模型。
- 图像模板继续保持禁字、单图/宫格规则和全局画风一致性；不得把参考图标签、分镜线框或 UI 画入成片。
- 更新 `seedance2_video`、`h3_video`、`panel_grid_video`、`panel_storyboard_video` 中英文模板：把构图契约扩展到时间轴，写清首帧构图、运动中构图变化、动作向量/穿框/逼近/远离、蓄力—接触—结果—反应、镜尾短暂稳定状态和相邻镜方向承接。
- 对 weather_atmosphere、set_dressing、action_blocking 模式设置证据门禁：证据不足时输出 errors/unresolved 或退回分镜，不允许模型自行补雨、雾、霓虹、镜面、烟尘、门窗廊柱、武器或群体。
- 竖屏 9:16 规则：关系镜优先前后纵深/越肩/上下站位而非硬挤左右；关键脸、证据道具、接触点放在中上安全区；大群戏拆成群体建立、主角动作和反应/结果。
- 不改变 Provider 语法、槽位数量、素材枚举或提交流程。

### Task 4: 制作计划、修订与审片
更新制作计划、分镜修订与镜头审片规则，加入风险板型和构图验收。

- 更新 `plan-drama-production` SKILL 与中英文 production_plan 模板：根据构图/动作风险选择 board_type；静态单一情绪用 single，动作阶段/运镜变化用 storyboard，多人站位、对峙、关系三角、遮挡、武器/接触动作用 shot-board。
- review_checks 必须按构图风险具体化：镜面/水面、雨雾霓虹烟尘、群体人数、多手/武器接触、窄门缝/遮挡、高速拖影、前后夹击、竖屏字幕安全区等；不得复制一组空泛检查。
- 更新 `revise-drama-storyboards` 中英文模板：修复构图缺陷时一次只改变一个变量，优先调整主体位置/视线留白/层次/光源/动作拆分；无证据风格元素必须删除而不是“优化得更电影感”。
- 更新 `review-drama-shots` SKILL：保持既有八项 criteria 顺序不变，把“构图与镜头语言”细化为首要可读信息、合同实现、证据元素、相邻连续、竖屏安全区五个观察问题。
- 明确失败分级：构图导致剧情因果/人物关系/动作结果不可读为 P1；仅风格不够强但信息完整为 P2；无证据新增高风险元素至少 P1。

### Task 5: 文档同步与验证
更新 Skill 文档与索引，执行审计/测试并修复。

- 在 `build-drama-storyboard/SKILL.md`、`write-drama-video-prompts/SKILL.md`、`generate-storyboard-images/SKILL.md`、`plan-drama-production/SKILL.md`、`review-drama-shots/SKILL.md` 和必要索引中链接/说明 `references/director-composition.md`。
- 不新增模板文件，因此除非审计要求，不改 `skill-map.json` 或 prompt-skill-index 的模板归属。
- 运行 `node scripts/audit-plugin.mjs`、构图词表测试、studio 测试及受影响的现有测试；区分本分支改动问题与本地临时文件/其他会话改动。
- 检查所有新增模板字段在中英文版本中同步、无未替换占位符、无 Provider 枚举冲突。
