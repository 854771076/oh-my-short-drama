# 导演构图模式参考（64 模式）

本文件是分镜构图的受控知识库，机器枚举见 `references/controlled-vocabulary.json` 的 `cinematography.compositionPatterns`。构图模式只解决一个问题：**让本镜唯一首要的可读信息，在竖屏画面里第一时间被读到。** 模式不是风格贴纸，禁止只在提示词中复读构图名称而不翻译为可见几何。

- 每个模式字段固定：code、中文名、英文名、画面结构、叙事功能、适用场景、证据要求、可组合模式、禁忌/AI 风险、竖屏提示。
- code 固定为 `composition.basic.*`（基础构图 16）、`composition.film.*`（光影与氛围 16）、`composition.action.*`（动作构图 16）、`composition.character.*`（人物与叙事 16）。
- 风险使用统一风险码（见 0.4），与 JSON 中 `risks` 一一对应。

## 0. 使用规则

### 0.1 每镜选择流程

1. **定信息**：先确定本镜唯一首要可读信息——观众第一眼必须读到什么：谁的决定、什么威胁、什么关系变化、什么动作结果。一镜只允许一个首要信息。
2. **选 primary**：从 64 模式中选唯一一个最能承载首要信息的模式作为 primary 构图。
3. **选 secondary（可选）**：确有第二层信息需要表达时，最多再选一个 secondary；没有第二信息层就不用。禁止两个强风格模式并列。
4. **翻译成可见执行项**，全部写入分镜与媒体提示词：
   - 主体位置：水平（左/中/右）、纵深（前/中/后景）、高度（仰/平/俯）；
   - 视线与留白：视线方向、留白方向与占比；
   - 前中后景：每层放什么、虚实如何分配；
   - 光源：方向、色温、光源的剧内来源；
   - 遮挡：遮挡物、遮挡比例、何时让出主体；
   - 动作方向：屏幕方向、入画/出画、朝向，与相邻镜保持一致；
   - 镜尾状态：定格时人物位置、朝向、剩余张力（镜头停在哪里）。
5. **核证据**：按 0.2 的证据等级逐项核对原文与资产；缺证据则降级换模式，不得靠想象补元素。
6. **动作镜追加**：动作镜必须保留地理、方向、蓄力、接触点、结果和反应六项可读信息，构图不得遮蔽其中任何一项。

### 0.2 证据等级

| 等级 | 含义 | 可以做什么 |
|---|---|---|
| `composition-only` | 剧本已有信息（人物、台词、情绪、已建立场景）足以支持，只靠机位、景别、调度和曝光实现 | 不向画面添加任何原文/资产之外的物件与天气 |
| `set_dressing` | 需要特定陈设、建筑或道具在场（门、窗、镜、廊柱、长桌、霓虹招牌、武器等） | 元素必须能在剧本描写或场景/道具资产中找到依据，否则换模式 |
| `weather_atmosphere` | 需要天气、大气或特定光线氛围（雨、雪、雾、逆光光源、双色温光源、烟尘环境） | 天气/时段/光源必须在原文、场次设定或资产中有明确依据 |
| `action_blocking` | 需要动作编排依据（冲突、追逃、跳跃、包围、武器持有、群体走位等） | 动作的目标、方向、参与者、结果必须在剧本或导演调度中成立 |

**硬规则：无证据不得添加雨、雪、雾、霓虹、镜子、烟尘、门窗/廊柱、武器等不在原文或资产中的元素。** 一个模式的证据等级是使用它的最低门槛；当卡片另注"另需证据"时（如霓虹湿地反射另需雨证、实体隔断另需陈设证），按更严格的一项执行。证据等级随分镜记录，供制作计划与审片核对。

**复合证据：** JSON 的 `evidence` 字段为单串；当一个模式在任何情况下都必须同时满足两类证据时（如 `composition.action.rain_fight` 的 `weather_atmosphere+action_blocking`），用 `+` 连接为复合串，各组件都必须是上表四个等级之一，且缺一不可。仅在特定用法下才升级的条件证据（如武器需要道具资产、实体隔断需要陈设）保留在卡片文字中，不进入复合串。

### 0.3 组合与竖屏通用规则

- 每镜一个 primary，最多一个 secondary；secondary 只能服务第二信息层，不能与 primary 争夺注意。
- 相邻镜必须保持屏幕方向与轴线一致；组合 `reverse_pursuit` 等反向机位时靠纵深而非横切保持方向惯性。
- 竖屏（9:16）通用原则：
  - 纵深优先：横向并排的关系改为前/中/后景或上下分区；
  - 面部锚点：对话与情绪镜面部放上 1/3 三分线，双眼必须完整可读；
  - 留白沿竖向延伸：视线方向与留白在竖屏内上下展开，保持空区纯净，不允许模型自行填物填人；
  - 竖向结构撑画幅：大远景选择高楼、长街、窄巷、柱列等竖向元素；
  - 触点留余量：跳起、武器、冲出画等动势边缘至少留 10% 画面，避免贴边裁切；
  - 人物辨识：远景、剪影、背影、烟尘与雨幕中必须用服色、发型、轮廓或标志物锚定角色身份。

### 0.4 风险码表

| 风险码 | 含义 |
|---|---|
| `unsourced_weather` | 无原文/资产证据添加雨、雪、雾等天气 |
| `unsourced_atmosphere` | 无证据添加烟尘、逆光、彩光等大气或光源氛围 |
| `unsourced_set_element` | 无证据添加门窗、廊柱、镜子、霓虹、武器、长桌等陈设道具 |
| `primary_info_unreadable` | 首要可读信息被构图、遮挡或光效淹没 |
| `eyeline_or_axis_break` | 视线不接续或越轴 |
| `screen_direction_flip` | 相邻镜屏幕方向、进出画方向翻转 |
| `pattern_stacking` | 多模式强风格叠加，主次丢失 |
| `vertical_crop_loss` | 竖屏裁切丢失关键元素或关系 |
| `depth_flattening` | 纵深被压扁、前后景层次粘连 |
| `action_causality_loss` | 动作的地理、蓄力、接触或结果因果不可读 |
| `character_identity_drift` | 人物脸部、发型或服装一致性漂移 |
| `mirror_reflection_anomaly` | 镜像错位、反射穿帮、多指等 AI 畸变 |
| `extra_figures` | 模型生成多余路人、人影或打手 |
| `stiff_symmetry` | 对称过度导致画面呆板 |
| `dead_air` | 留白或长镜变成无事件的空洞画面 |
| `over_lighting` | 无来源光、光比失真或过度补光 |
| `lens_distortion` | 极端广角/长焦导致畸变或不可信的虚化 |
| `motion_blob` | 运动模糊过度，主体糊成不可辨 |
| `false_camera_motion` | 模型自行添加未要求的缓推、环绕或漂浮运镜 |

## 1. 基础构图 basic（16）

纯机位与画面组织，绝大多数只需 `composition-only` 证据；凡需要特定建筑/陈设才能成立的（如框景），按卡片要求的更高等级执行。

### 1.1 中轴平衡（composition.basic.symmetry）

- 英文名：Symmetrical Balance
- 画面结构：主体居中，或中轴两侧元素等重；竖屏中轴对称沿竖直中线展开，地平线压低或居中。
- 叙事功能：传达秩序、仪式、对峙或宿命感，让权力空间正面压向观众。
- 适用场景：厅堂、仪式、正门对峙、权力空间首次亮相。
- 证据要求：composition-only；对称元素必须来自场景资产的实际布局。
- 可组合模式：composition.basic.single_point、composition.action.group_standoff、composition.film.dark_background、composition.character.final_solitude
- 禁忌/AI 风险：stiff_symmetry（无对手戏时呆板）；vertical_crop_loss（横排对称元素被裁切）；不得复制不存在的对称家具或人群。
- 竖屏提示：用纵深对称（门、走廊、柱列沿中线后退）代替横排对称；人物放中上交点，脚部不贴边。

### 1.2 三分落点（composition.basic.thirds）

- 英文名：Rule-of-Thirds Landing
- 画面结构：主体或面部落在竖屏三分线交点上，视线方向留出约 2/3 空白。
- 叙事功能：在自然平衡中突出决定、反应或发现，是对话与单人镜的默认落点。
- 适用场景：对话、倾听反应、单人行动、信息揭示。
- 证据要求：composition-only。
- 可组合模式：composition.basic.leading_lines、composition.film.shallow_dof、composition.character.averted_eyeline、composition.basic.breathing_room
- 禁忌/AI 风险：无特殊风险；仍需保证视线留白方向与对手戏轴线一致。
- 竖屏提示：面部放上 1/3 交点；手持物品落同侧下交点；留白沿视线方向展开。

### 1.3 引导线推进（composition.basic.leading_lines）

- 英文名：Leading-Line Push
- 画面结构：走廊、路沿、栏杆、光影边缘等线条汇聚于主体或消失点，线条从画底向深处延伸。
- 叙事功能：把注意力推向目标人物或出口，制造"正在走向／被引向"的宿命感。
- 适用场景：走廊、街道、楼梯、长桌、站台。
- 证据要求：composition-only；线条必须由场景资产中已存在的结构形成，不得虚构长廊、轨道。
- 可组合模式：composition.film.corridor_perspective、composition.basic.low_viewpoint、composition.action.chase_perspective、composition.character.lonely_back
- 禁忌/AI 风险：unsourced_set_element（虚构建筑线条）；depth_flattening（广角把汇聚线压平）。
- 竖屏提示：优先取从画面底部两角向中心汇聚的纵向线条；水平线条改为斜向入画。

### 1.4 对角线延展（composition.basic.diagonal）

- 英文名：Diagonal Extension
- 画面结构：主体、肢体或运动沿竖屏对角展开，倾斜元素分割画面。
- 叙事功能：注入动能、紧张或失衡，标示局势正在倾斜。
- 适用场景：争执升级、逼近、楼梯或斜坡等倾斜空间。
- 证据要求：composition-only。
- 可组合模式：composition.action.dutch_imbalance、composition.action.weapon_line、composition.action.speed_trail、composition.action.low_impact
- 禁忌/AI 风险：screen_direction_flip（相邻镜对角方向不一致）；eyeline_or_axis_break。
- 竖屏提示：利用竖屏长对角（下角到上角）安排站起、扑倒或指向；运动方向与前后镜一致。

### 1.5 框景聚焦（composition.basic.frame_within_frame）

- 英文名：Frame Within a Frame
- 画面结构：用门框、窗框、拱门、镜边等内框把主体套在画面中的画面里。
- 叙事功能：强调被困、被观察、社会距离或心理隔离。
- 适用场景：门外看人、隔窗相望、楼道拱门。
- 证据要求：set_dressing；内框结构必须在剧本场景或场景资产中存在。
- 可组合模式：composition.film.door_gap_pov、composition.character.spatial_barrier、composition.film.dark_background、composition.character.lonely_back
- 禁忌/AI 风险：unsourced_set_element；primary_info_unreadable（内框过小，主体不可读）。
- 竖屏提示：内框竖边与屏幕竖边平行，主体占内框宽度 1/3 以上；避免双层框把人物压成小点。

### 1.6 留白呼吸（composition.basic.breathing_room）

- 英文名：Breathing Negative Space
- 画面结构：主体压在画面一侧或一角，其余为简洁空区。
- 叙事功能：让沉默、迟疑与未说出口的信息占据空间。
- 适用场景：对话停顿、拒绝回答、情绪沉淀。
- 证据要求：composition-only。
- 可组合模式：composition.basic.thirds、composition.character.averted_eyeline、composition.character.emotional_closeup、composition.film.static_wait
- 禁忌/AI 风险：dead_air（留白变成发空画面、主体过小）。
- 竖屏提示：留白沿视线方向上下延伸；空区保持纯净，禁止模型在空区填家具或人影。

### 1.7 前景遮挡（composition.basic.foreground_occlusion）

- 英文名：Foreground Occlusion
- 画面结构：虚化或半切的前景物／人擦过镜头，主体在遮挡缝隙后可见。
- 叙事功能：制造旁观、窥视、空间拥挤与临场感。
- 适用场景：人群中观察、隔物对话、暗中窥视。
- 证据要求：composition-only；遮挡物必须取自场景资产或在场人物，新增陈设需 set_dressing 证据。
- 可组合模式：composition.film.shallow_dof、composition.film.door_gap_pov、composition.action.foreground_whip、composition.character.spatial_barrier
- 禁忌/AI 风险：unsourced_set_element；primary_info_unreadable（遮挡盖脸或盖关键动作）。
- 竖屏提示：遮挡占一侧不超过 1/3 屏宽或仅占顶部一条；人物双眼完整可见。

### 1.8 低位仰视（composition.basic.low_viewpoint）

- 英文名：Low-Angle Look-Up
- 画面结构：机位低于主体视平线向上拍摄，人物占据画面上部，天空或天花板为背景。
- 叙事功能：放大权威、压迫、英雄感或威胁逼近。
- 适用场景：强者登场、被围困者视角、建筑压迫。
- 证据要求：composition-only。
- 可组合模式：composition.action.low_impact、composition.basic.symmetry、composition.action.encirclement、composition.film.backlight_silhouette
- 禁忌/AI 风险：lens_distortion（广角仰拍肢体面部畸变）；character_identity_drift（下巴变形走样）。
- 竖屏提示：用中焦（约 35–50mm 等效）减轻畸变；人物头顶留白不超过画面 10%。

### 1.9 高位俯视（composition.basic.high_viewpoint）

- 英文名：High-Angle Overlook
- 画面结构：机位高于主体向下拍，人物被环境包围、显小。
- 叙事功能：表现脆弱、被支配、孤立，或交代局势全貌。
- 适用场景：倒地、被审视、空间关系交代。
- 证据要求：composition-only。
- 可组合模式：composition.basic.wide_closure、composition.action.encirclement、composition.basic.layered_zones、composition.action.pincer
- 禁忌/AI 风险：depth_flattening（顶光俯拍层次粘连）；primary_info_unreadable（人物过小）。
- 竖屏提示：用地面纹理或光影形成边界把人物圈出；避免正鸟瞰丢失面部。

### 1.10 S形动线（composition.basic.s_curve）

- 英文名：S-Curve Flow
- 画面结构：道路、河流、队列或肢体沿 S 形在竖屏中蜿蜒，主体落在曲线转折处或远端。
- 叙事功能：以曲折路径暗示迂回、寻找与节奏变化。
- 适用场景：街巷、山路、河流、长队、舞步。
- 证据要求：composition-only；曲线载体必须是场景已有的地形或动线。
- 可组合模式：composition.basic.leading_lines、composition.action.chase_perspective、composition.film.establishing_empty、composition.action.group_charge
- 禁忌/AI 风险：unsourced_set_element（虚构蜿蜒道路）；screen_direction_flip（曲线转向与运动方向矛盾）。
- 竖屏提示：竖屏天然适合竖向 S；两个转折点放在上下三分线上。

### 1.11 层次分区（composition.basic.layered_zones）

- 英文名：Layered Zones
- 画面结构：画面按明暗、冷暖或前后景分成 2–3 个信息带，每带承载一个叙事元素。
- 叙事功能：同一镜内并列"谁在说、谁在听、什么在逼近"。
- 适用场景：多人同场、内外空间同框、信息并置。
- 证据要求：composition-only；分区光色需要现场光源依据。
- 可组合模式：composition.basic.depth_stack、composition.film.color_block、composition.film.warm_cool_clash、composition.character.relational_triangle
- 禁忌/AI 风险：depth_flattening（信息带叠成一团）；vertical_crop_loss（侧向并列信息被裁）。
- 竖屏提示：横向分区改为上下或前后分层；远层人物保留可辨识轮廓或服色。

### 1.12 近中远叠景（composition.basic.depth_stack）

- 英文名：Near-Mid-Far Stack
- 画面结构：前景虚化物、中景主体、远景光源或人物三层沿纵深叠放。
- 叙事功能：建立空间厚度，让环境参与叙事（威胁在远处、秘密在近处）。
- 适用场景：街巷、房间内外、人群。
- 证据要求：composition-only；各层元素必须来自资产。
- 可组合模式：composition.film.shallow_dof、composition.basic.foreground_occlusion、composition.basic.layered_zones、composition.action.smoke_depth
- 禁忌/AI 风险：depth_flattening；extra_figures（远景生成多余路人）。
- 竖屏提示：三层沿竖直纵深排布——前景贴底边、主体居中、远景在头部后方形成光斑；控制每层元素数量。

### 1.13 负空间压缩（composition.basic.negative_compression）

- 英文名：Negative-Space Compression
- 画面结构：大面积实体结构（墙、柜门、阴影）从一侧挤入，把主体压到窄区。
- 叙事功能：视觉化窒息、逼迫与心理承压。
- 适用场景：被逼到墙角、审讯、内心压迫。
- 证据要求：composition-only；实体墙面或结构取自己有场景。
- 可组合模式：composition.character.spatial_barrier、composition.film.dark_background、composition.character.two_shot_standoff、composition.action.dutch_imbalance
- 禁忌/AI 风险：dead_air；primary_info_unreadable（压迫面吞掉主体）。
- 竖屏提示：压迫面从上方或一侧占 55%–70%，主体保留完整肩线和面部光。

### 1.14 重复秩序（composition.basic.repetition）

- 英文名：Repetitive Order
- 画面结构：柱列、窗格、座椅、人群等重复元素形成节奏，主体作为"破坏重复"的例外。
- 叙事功能：用秩序反衬异己者，或强化体制与集体压力。
- 适用场景：学校、医院、办公区、仪式队列。
- 证据要求：composition-only；重复物件必须在场景资产中存在。
- 可组合模式：composition.film.column_rhythm、composition.basic.single_point、composition.action.group_charge、composition.basic.symmetry
- 禁忌/AI 风险：unsourced_set_element；extra_figures（复制人群时脸和服装出错）。
- 竖屏提示：重复沿纵深后退而非横排；例外人物放中下交点，服色与重复元素拉开。

### 1.15 单点聚焦（composition.basic.single_point）

- 英文名：Single-Point Focus
- 画面结构：画面中唯一高对比或高饱和点（人、光、物）独占注意。
- 叙事功能：在混乱或极简环境中锁定关键决定与关键道具。
- 适用场景：黑暗中一人、关键证物、人群中的主角。
- 证据要求：composition-only。
- 可组合模式：composition.film.dark_background、composition.film.selective_highlight、composition.film.shallow_dof、composition.basic.repetition
- 禁忌/AI 风险：无特殊风险；仍需保证该单点确实承载本镜首要信息。
- 竖屏提示：单点放上 1/3 或正中；竖屏干扰少，不要再叠加第二个视觉重音。

### 1.16 远景收束（composition.basic.wide_closure）

- 英文名：Extreme-Wide Closure
- 画面结构：大远景或远景中人物很小、环境主导，镜尾静止或缓停在人物与空间的最终关系上。
- 叙事功能：段落收束，人物被更大的命运或环境容纳。
- 适用场景：段落结尾、出走之后、事件后的场地。
- 证据要求：composition-only。
- 可组合模式：composition.character.final_solitude、composition.film.establishing_empty、composition.basic.high_viewpoint、composition.character.lonely_back
- 禁忌/AI 风险：vertical_crop_loss（远景丢细节）；character_identity_drift（人物过小无法辨识）。
- 竖屏提示：用服色或光影给人物一个可读锚点；选竖向结构（高楼、长街、窄巷）撑满竖幅。

## 2. 光影与氛围 film（16）

涉及天气、光源或特定陈设的模式，证据门槛为 `weather_atmosphere` 或 `set_dressing`；纯曝光与镜头选择（压暗背景、局部高光、景深虚化、空镜、静止）仍为 `composition-only`。

### 2.1 逆光剪影（composition.film.backlight_silhouette）

- 英文名：Backlit Silhouette
- 画面结构：强光源在主体背后（夕阳、窗、灯），正面欠曝成轮廓。
- 叙事功能：隐藏表情、制造神秘或决绝，把人物交给命运时刻。
- 适用场景：日落告别、门口现身、匿名威胁。
- 证据要求：weather_atmosphere；逆光光源必须在场景时段或资产中成立（窗口朝向、日落、灯具）。
- 可组合模式：composition.basic.low_viewpoint、composition.basic.frame_within_frame、composition.character.lonely_back、composition.film.dark_background
- 禁忌/AI 风险：unsourced_atmosphere（无来源强逆光）；character_identity_drift（剪影丢失识别）；primary_info_unreadable（首要信息是表情时禁用）。
- 竖屏提示：保留轮廓边缘光与发型、头饰识别点；全身剪影用姿态和服装轮廓区分角色。

### 2.2 窗边侧光（composition.film.window_side_light）

- 英文名：Window Side Light
- 画面结构：主光来自画面单侧窗户，人物半脸受光、半脸入影。
- 叙事功能：表现内心两面、坦白与保留、时间流动。
- 适用场景：清晨对话、病榻、书房、等候。
- 证据要求：set_dressing；窗与时段光向必须在场景资产或剧本时段中成立。
- 可组合模式：composition.character.window_contemplation、composition.film.shallow_dof、composition.character.profile_gaze、composition.character.emotional_closeup
- 禁忌/AI 风险：unsourced_set_element（凭空加窗）；over_lighting（光比过大变黑脸，或被 AI 补成平光）。
- 竖屏提示：窗光从侧上约 45° 落下；暗侧保留微弱环境光保证眼部可读。

### 2.3 雨夜反光（composition.film.rain_reflections）

- 英文名：Rainy-Night Reflections
- 画面结构：湿地面反射招牌与车灯，人物在倒影与实体之间；高光细碎、整体压暗。
- 叙事功能：放大孤独、迷失与城市冷感，让行动像发生在镜像世界。
- 适用场景：街头等待、跟踪、分手。
- 证据要求：weather_atmosphere；雨与夜必须在原文或资产中明确。
- 可组合模式：composition.film.neon_reflection、composition.character.lonely_back、composition.action.chase_perspective、composition.film.color_block
- 禁忌/AI 风险：unsourced_weather（晴天硬加雨）；over_lighting（反射过曝）；雨丝方向必须一致。
- 竖屏提示：反光路面放画面下 1/3，倒影拉长但不超过人物高度；雨丝统一斜向。

### 2.4 冷暖对撞（composition.film.warm_cool_clash）

- 英文名：Warm-Cool Clash
- 画面结构：画面分属两种色温光源（室内暖黄、室外冷蓝等），人物站在交界。
- 叙事功能：两个世界、两种选择，或亲密与疏离的对立。
- 适用场景：门口内外、夜车窗外、厨房与走廊。
- 证据要求：weather_atmosphere；两个色温光源都必须有现场来源。
- 可组合模式：composition.basic.layered_zones、composition.character.spatial_barrier、composition.character.table_negotiation、composition.character.doorway_pause
- 禁忌/AI 风险：unsourced_atmosphere（无来源彩光）；over_lighting（饱和溢出）。
- 竖屏提示：冷暖交界放竖屏中线或沿门框纵向分割；人脸只受一种主色温。

### 2.5 雾气包裹（composition.film.fog_wrap）

- 英文名：Fog Embrace
- 画面结构：雾气、霾或蒸汽吞没远景，主体从雾中浮出，层次距离靠能见度区分。
- 叙事功能：以降低的清晰度带来未知、迷失与记忆感。
- 适用场景：清晨、山间、浴室、火场余烟。
- 证据要求：weather_atmosphere；雾或蒸汽来源必须在原文（天气或场景设施）。
- 可组合模式：composition.film.establishing_empty、composition.action.chase_perspective、composition.action.smoke_depth、composition.character.lonely_back
- 禁忌/AI 风险：unsourced_weather（室内凭空起雾）；depth_flattening（主体和背景糊成一片）。
- 竖屏提示：主体与雾背景保持一档以上明度差；雾层沿纵深分布，不全屏死白。

### 2.6 长廊透视（composition.film.corridor_perspective）

- 英文名：Corridor Perspective
- 画面结构：长走廊单点透视，线条与门、灯向远端汇聚，人物位于远端或中段。
- 叙事功能：表达漫长、被体制吞没，以及无法回避的相遇。
- 适用场景：医院、学校、酒店、公寓楼道。
- 证据要求：set_dressing；走廊必须是已建立场景。
- 可组合模式：composition.basic.leading_lines、composition.film.column_rhythm、composition.character.corridor_encounter、composition.character.lonely_back
- 禁忌/AI 风险：unsourced_set_element；depth_flattening（竖屏广角畸变）。
- 竖屏提示：走廊纵深正对竖屏中线；远端人物保留轮廓光，顶灯节奏引导视线。

### 2.7 门缝窥视（composition.film.door_gap_pov）

- 英文名：Door-Gap Peep
- 画面结构：镜头贴近门缝或钥匙孔，前景是门板暗区，主体被窄框切割。
- 叙事功能：建立偷窥者视角与秘密感——观众知道得不该这么多。
- 适用场景：童年窥视、跟踪、偷听。
- 证据要求：set_dressing；门与缝隙必须存在，视角人物需在剧情中在场。
- 可组合模式：composition.basic.foreground_occlusion、composition.basic.frame_within_frame、composition.character.averted_eyeline
- 禁忌/AI 风险：unsourced_set_element；primary_info_unreadable（缝隙过窄看不到信息）。
- 竖屏提示：门缝竖向贯穿画面，可见区域至少 1/3 屏宽；暗区占两侧但保留主体面部或关键动作。

### 2.8 镜面映像（composition.film.mirror_reflection）

- 英文名：Mirror Reflection
- 画面结构：通过镜面（或光滑柜面、车窗）观看主体，真人与映像可同框或只在镜中。
- 叙事功能：分裂身份、自我审视，或让第二者出现在同一空间（镜中闯入者）。
- 适用场景：化妆台、卫生间、电梯、车窗。
- 证据要求：set_dressing；镜面必须在场景资产中存在。
- 可组合模式：composition.character.mirror_self、composition.film.color_block、composition.character.profile_gaze、composition.character.spatial_barrier
- 禁忌/AI 风险：unsourced_set_element；mirror_reflection_anomaly（镜像错位、多指、反射中出现摄像机或多余人）。
- 竖屏提示：镜中只放一张脸避免识别混乱；镜框竖直，反射内容与现场陈设严格一致。

### 2.9 压暗背景（composition.film.dark_background）

- 英文名：Low-Key Background
- 画面结构：环境整体压暗，只保留主体所需光，背景细节沉入暗部。
- 叙事功能：剥离环境干扰，把心理重量压到人物身上；暗示未知包围。
- 适用场景：夜戏、独处、坦白、威胁。
- 证据要求：composition-only（曝光与布光选择）；场景时段必须支持低照度。
- 可组合模式：composition.basic.single_point、composition.film.selective_highlight、composition.film.backlight_silhouette、composition.basic.symmetry
- 禁忌/AI 风险：primary_info_unreadable（暗部吃掉表情）；over_lighting（反向补成亮室）。
- 竖屏提示：主体轮廓与暗背景分离（发丝光或肩线光）；暗部允许无细节但不允许噪彩。

### 2.10 局部高光（composition.film.selective_highlight）

- 英文名：Selective Highlight
- 画面结构：一束光只打亮局部——手、证物、眼睛、半张脸。
- 叙事功能：把叙事赌注压到单一物件或微反应上。
- 适用场景：证物揭示、签字、欲望物件、回忆闪现。
- 证据要求：composition-only；若光源是台灯、手电等灯具，另需 set_dressing 依据。
- 可组合模式：composition.basic.single_point、composition.character.emotional_closeup、composition.film.dark_background、composition.film.shallow_dof
- 禁忌/AI 风险：over_lighting（光斑假、无来源）；primary_info_unreadable（高亮处不是首要信息）。
- 竖屏提示：高亮区面积不超过 15%，位于上 1/3 或动作接触点；光边过渡自然。

### 2.11 色块分割（composition.film.color_block）

- 英文名：Color-Block Division
- 画面结构：墙面、帘布、光区形成 2–3 个大面积色块，人物嵌在色块交界。
- 叙事功能：用颜色把人物处境与情绪阵营化。
- 适用场景：彩色墙面空间、夜灯下路口、室内光区。
- 证据要求：set_dressing；大面积色块必须来自场景墙面、陈设或有来源的光。
- 可组合模式：composition.basic.layered_zones、composition.film.warm_cool_clash、composition.basic.repetition、composition.basic.single_point
- 禁忌/AI 风险：unsourced_set_element（凭空彩色墙）；over_lighting（高饱和脏色）。
- 竖屏提示：色块沿竖直方向分割，交界线穿过人物视线或心口；每镜主色不超过 3 种。

### 2.12 景深虚化（composition.film.shallow_dof）

- 英文名：Shallow Depth of Field
- 画面结构：浅景深让主体锐利、前后景化开成色块与光斑。
- 叙事功能：主观聚焦——世界退散，只剩此人或此物；也可由虚到实做焦点揭示。
- 适用场景：人群中独见一人、回忆、注意力集中。
- 证据要求：composition-only（镜头选择）。
- 可组合模式：composition.basic.foreground_occlusion、composition.basic.depth_stack、composition.basic.single_point、composition.character.profile_gaze
- 禁忌/AI 风险：lens_distortion（过度虚化导致场景不可信、交接戏失地理）；primary_info_unreadable。
- 竖屏提示：双人对话保留对手轻度可辨；光斑不压脸，焦点锁最近的眼睛。

### 2.13 廊柱节奏（composition.film.column_rhythm）

- 英文名：Colonnade Rhythm
- 画面结构：柱列或竖向构件形成等距节拍，人物在节拍间移动或被夹住。
- 叙事功能：体制节奏、宿命节拍、被秩序丈量。
- 适用场景：学校走廊、古典建筑、地下车库柱网。
- 证据要求：set_dressing；柱列必须存在于场景资产。
- 可组合模式：composition.film.corridor_perspective、composition.basic.repetition、composition.action.chase_perspective、composition.basic.symmetry
- 禁忌/AI 风险：unsourced_set_element；depth_flattening（竖排柱子把人物遮没）。
- 竖屏提示：柱列沿纵深排开，人物安排在两个柱间空档；运动时柱子有节奏掠过但不盖脸。

### 2.14 霓虹反射（composition.film.neon_reflection）

- 英文名：Neon Reflection
- 画面结构：霓虹或灯箱作为彩色光源并在湿面或亮面形成反射，人物被彩光切割。
- 叙事功能：都市欲望、诱惑、不安定的身份。
- 适用场景：夜晚街巷、招牌下、便利店外。
- 证据要求：set_dressing（霓虹招牌必须在场景资产）；湿地面反射另需 weather_atmosphere 雨证。
- 可组合模式：composition.film.rain_reflections、composition.film.color_block、composition.character.lonely_back、composition.film.warm_cool_clash
- 禁忌/AI 风险：unsourced_set_element（古代或乡村场景凭空加霓虹）；unsourced_weather（无雨硬做湿反射）。
- 竖屏提示：竖屏容纳竖向招牌；脸上彩光不超过两种颜色，标识文字不抢主体。

### 2.15 空镜铺陈（composition.film.establishing_empty）

- 英文名：Empty Establishing Shot
- 画面结构：人物缺席或极小的场景镜头，展示时间、地点、天气与氛围。
- 叙事功能：人物进入前为段落定调，或用"空"暗示失去。
- 适用场景：集首或场首建立、转折后空场地。
- 证据要求：composition-only；其中天气类元素仍按 weather_atmosphere 校验。
- 可组合模式：composition.film.static_wait、composition.film.fog_wrap、composition.basic.wide_closure、composition.basic.s_curve
- 禁忌/AI 风险：extra_figures（模型自动填路人）；vertical_crop_loss（场景特征被裁掉）。
- 竖屏提示：选竖向标志物（楼、塔、招牌、巷道）建立地点；留出人物将入场的干净区域。

### 2.16 静止等待（composition.film.static_wait）

- 英文名：Held Static Shot
- 画面结构：固定机位、无运镜，让人物在不动的画面里等待、沉默或做微小动作。
- 叙事功能：把时间交给角色，让观众承受悬置。
- 适用场景：等人、对峙静默、消息未至。
- 证据要求：composition-only。
- 可组合模式：composition.basic.breathing_room、composition.character.doorway_pause、composition.character.emotional_closeup、composition.film.establishing_empty
- 禁忌/AI 风险：dead_air（无事件长镜发闷）；false_camera_motion（模型自行缓推或漂浮）。
- 竖屏提示：构图一次到位，镜内变化（转身、灯亮、入画）是唯一事件；提示词显式写明 locked-off。

## 3. 动作构图 action（16）

动作模式统一需要 `action_blocking` 证据（雨战另需雨证）。任何动作构图都必须保住地理、方向、蓄力、接触点、结果、反应六项；看不清因果的"冲击力"是失败。

### 3.1 低机位冲击（composition.action.low_impact）

- 英文名：Ground-Level Impact
- 画面结构：机位贴近地面，冲刺者或坠落物从上方压向镜头，接触点在镜头附近爆发。
- 叙事功能：把冲击直接送到观众身体，放大力量与危险。
- 适用场景：冲锋、扑倒、车辆擦过、坠落。
- 证据要求：action_blocking；剧本需有冲向镜头方向的动作及明确目标与接触点。
- 可组合模式：composition.action.speed_trail、composition.action.group_charge、composition.action.foreground_whip、composition.action.dutch_imbalance
- 禁忌/AI 风险：action_causality_loss（只看到冲击，看不到蓄力与对象）；lens_distortion（超广角夸张到滑稽）。
- 竖屏提示：冲击沿竖屏纵轴（深处到镜头）而非横扫；接触点放下 1/3，保留施力者上半身。

### 3.2 斜构图失衡（composition.action.dutch_imbalance）

- 英文名：Dutch-Angle Instability
- 画面结构：水平线倾斜 10–25°，人物与重力对抗。
- 叙事功能：标示失控、疯狂、局势倾斜。
- 适用场景：搏斗失衡、精神崩溃、爆炸后眩晕。
- 证据要求：action_blocking；需有失衡或混乱事件作动机，平静对话禁用。
- 可组合模式：composition.basic.diagonal、composition.action.low_impact、composition.basic.negative_compression、composition.action.rain_fight
- 禁忌/AI 风险：pattern_stacking（与大量运镜叠加导致眩晕）；primary_info_unreadable（倾斜盖过信息）。
- 竖屏提示：竖屏倾斜取小值（10–15°）；地平线斜穿对角但面部保持可读。

### 3.3 追逐透视（composition.action.chase_perspective）

- 英文名：Chase Perspective
- 画面结构：追随或前置机位沿纵深拍奔跑，逃者与追者在同一透视线纵深排列。
- 叙事功能：明确谁追谁、距离如何变化。
- 适用场景：街巷追逐、走廊逃奔。
- 证据要求：action_blocking；需有追逃双方、方向与距离关系。
- 可组合模式：composition.basic.leading_lines、composition.basic.s_curve、composition.action.foreground_whip、composition.action.reverse_pursuit
- 禁忌/AI 风险：screen_direction_flip（追逃方向跨镜翻转）；action_causality_loss（地理不清）。
- 竖屏提示：纵深追逐天然适配竖屏；逃者放画面中部偏小，追者从底边或远端逼近。

### 3.4 前景掠过（composition.action.foreground_whip）

- 英文名：Foreground Fly-By
- 画面结构：运动中柱子、墙面、杂物或人群紧贴镜头高速掠过，形成遮挡节奏。
- 叙事功能：主观化速度，表现逃亡中的障碍感。
- 适用场景：追逐、穿行人群、仓库奔逃。
- 证据要求：action_blocking；掠过物取自己有场景，动作需有穿越路径。
- 可组合模式：composition.action.chase_perspective、composition.action.speed_trail、composition.basic.foreground_occlusion、composition.action.rain_fight
- 禁忌/AI 风险：primary_info_unreadable（遮挡频率过高看不见主体）；motion_blob（糊成一片）。
- 竖屏提示：掠过物只在两侧窄条出现，中央追踪带保持干净；每镜遮挡不超过 2 次。

### 3.5 跃起定格（composition.action.leap_freeze）

- 英文名：Mid-Leap Freeze
- 画面结构：主体腾空至顶点的瞬间短暂定格或减速，肢体完全展开。
- 叙事功能：把勇气或攻击的决定性瞬间仪式化。
- 适用场景：起跳跨障、飞踢、扑跃。
- 证据要求：action_blocking；需有明确跃起动作与落点。
- 可组合模式：composition.action.low_impact、composition.action.speed_trail、composition.action.tail_settle、composition.action.group_charge
- 禁忌/AI 风险：motion_blob（肢体畸形）；character_identity_drift（腾空时脸部走样）。
- 竖屏提示：竖向跃起适配竖屏，顶点处头顶留 10%；四肢不触碰屏幕边缘。

### 3.6 多人对峙（composition.action.group_standoff）

- 英文名：Multi-Person Standoff
- 画面结构：3 人以上形成可读几何（扇形、对峙两排、包围弧），每人有明确朝向与手部/武器状态。
- 叙事功能：同时呈现多方张力与力量关系。
- 适用场景：围堵、谈判破裂前、帮派会面。
- 证据要求：action_blocking；每个在场人物须在剧本或资产中。
- 可组合模式：composition.character.relational_triangle、composition.basic.symmetry、composition.action.encirclement、composition.action.weapon_line
- 禁忌/AI 风险：eyeline_or_axis_break（视线网混乱）；extra_figures（增加无关打手）。
- 竖屏提示：避免横排多人；改用前后景分层或半弧形朝向镜头，每人露脸或露标志物。

### 3.7 武器延伸线（composition.action.weapon_line）

- 英文名：Weapon Extension Line
- 画面结构：刀、棍、枪等沿主体手臂延伸形成指向线，指向对手或镜头。
- 叙事功能：把威胁几何化，明确力量指向与杀伤距离。
- 适用场景：持刀对峙、开枪前、递刃。
- 证据要求：action_blocking（持刀/开枪等动作与持有关系成立）；武器作为道具还必须有道具资产依据，无资产时按 `unsourced_set_element` 风险处理——这是通用道具规则，不构成复合 evidence。
- 可组合模式：composition.basic.diagonal、composition.character.two_shot_standoff、composition.action.low_impact、composition.basic.single_point
- 禁忌/AI 风险：unsourced_set_element（凭空生成武器或形制错误）；primary_info_unreadable（武器抢脸）。
- 竖屏提示：武器沿竖屏对角或直指镜头纵深；形制与资产一致，避免横向出画被裁。

### 3.8 烟尘纵深（composition.action.smoke_depth）

- 英文名：Smoke-and-Dust Depth
- 画面结构：动作扬起的烟尘在中远景形成半透明层，人物在烟层前后穿插。
- 叙事功能：用可见的空气厚度标记冲击规模与视线受限。
- 适用场景：撞击、坍塌、马蹄、枪战硝烟。
- 证据要求：action_blocking；烟尘必须有剧内来源（碰撞、扬尘物、烟雾道具），按 unsourced_atmosphere 风险核对。
- 可组合模式：composition.basic.depth_stack、composition.action.group_charge、composition.action.encirclement、composition.film.fog_wrap
- 禁忌/AI 风险：unsourced_atmosphere（干净室内无故冒烟）；action_causality_loss（烟遮挡关键接触）。
- 竖屏提示：烟层放中远景，主体前方保留可读空隙；烟色与地面材质一致。

### 3.9 反打压追（composition.action.reverse_pursuit）

- 英文名：Reverse-Angle Pursuit
- 画面结构：追逐或压制中切反向机位——被追者迎面跑来，或追者越过镜头后看到其背后的目标。
- 叙事功能：转换攻守信息，展示追兵规模或角色孤注一掷。
- 适用场景：追逐、逃跑回头、被反扑。
- 证据要求：action_blocking；需有明确双方与前后关系。
- 可组合模式：composition.action.chase_perspective、composition.action.foreground_whip、composition.action.pincer、composition.action.tail_settle
- 禁忌/AI 风险：screen_direction_flip（反打后方向颠倒）；eyeline_or_axis_break（越轴）。
- 竖屏提示：反向机位仍保持屏幕运动惯性（如同侧出画）；用纵深而非横向表达。

### 3.10 环绕包围（composition.action.encirclement）

- 英文名：Encircling Orbit
- 画面结构：包围者沿弧或圆分布，或镜头弧形运动展示合围。
- 叙事功能：可视化无路可退与来自四周的压力。
- 适用场景：被围、包围圈收紧、多人审讯。
- 证据要求：action_blocking；包围人数与身份须有据。
- 可组合模式：composition.action.group_standoff、composition.basic.high_viewpoint、composition.basic.low_viewpoint、composition.character.spatial_barrier
- 禁忌/AI 风险：eyeline_or_axis_break；extra_figures；action_causality_loss（环绕后地理翻转）。
- 竖屏提示：优先用前后景分层表现包围（前影加后影），环绕机位限定不超过 90°。

### 3.11 速度拖影（composition.action.speed_trail）

- 英文名：Speed Trail
- 画面结构：沿运动方向的动态模糊或残影，主体面部与关键接触点保持清晰。
- 叙事功能：强调速度与冲击方向。
- 适用场景：冲刺、挥拳、急转。
- 证据要求：action_blocking。
- 可组合模式：composition.action.low_impact、composition.action.foreground_whip、composition.action.chase_perspective、composition.action.leap_freeze
- 禁忌/AI 风险：motion_blob（全身糊不可辨）；screen_direction_flip（拖影方向矛盾）。
- 竖屏提示：拖影只发生在肢体与背景，眼部和接触点清晰；沿纵深方向拖影。

### 3.12 爆点留白（composition.action.blast_negative_space）

- 英文名：Blast-Point Void
- 画面结构：爆炸或撞击点周围刻意留空，或人物被气浪推向边缘，爆点成为画面视觉中心空位。
- 叙事功能：以"空"表现冲击量级与瞬间失聪感。
- 适用场景：爆炸、重击落地、破门。
- 证据要求：action_blocking；爆炸或破坏事件必须在剧本中，火光碎屑不得无据添加。
- 可组合模式：composition.basic.single_point、composition.action.low_impact、composition.action.tail_settle、composition.basic.wide_closure
- 禁忌/AI 风险：unsourced_atmosphere（无事件加火光浓烟）；primary_info_unreadable（爆点遮没人物反应）。
- 竖屏提示：爆点放上 1/3 或纵深处，人物压底边被照亮；碎屑方向与冲击波一致。

### 3.13 前后夹击（composition.action.pincer）

- 英文名：Front-and-Back Pincer
- 画面结构：威胁同时出现在主体的前景与远景（纵深两端），主体夹在中间。
- 叙事功能：走投无路的空间化表达。
- 适用场景：巷道两头堵截、走廊被截。
- 证据要求：action_blocking；两方威胁均须在剧本中。
- 可组合模式：composition.basic.depth_stack、composition.character.spatial_barrier、composition.action.chase_perspective、composition.action.encirclement
- 禁忌/AI 风险：screen_direction_flip；action_causality_loss（两方身份混淆）。
- 竖屏提示：竖屏纵深天然表达夹击——一端虚焦人影、一端清晰逼近，主体居中偏小。

### 3.14 雨战压缩（composition.action.rain_fight）

- 英文名：Rain-Fight Compression
- 画面结构：雨幕中中近景贴身搏斗，雨丝统一方向，湿衣与地面反光压缩空间。
- 叙事功能：用天气把搏斗双方"焊"在一起，放大狼狈与韧性。
- 适用场景：雨中决斗、泥地混战。
- 证据要求：`weather_atmosphere+action_blocking`（复合证据，以 `+` 连接，两项必须同时满足）：雨必须在原文或资产中（weather_atmosphere），贴身格斗动作由剧本或导演调度支持（action_blocking）。JSON 词表的 `evidence` 字段使用同一复合串。
- 可组合模式：composition.film.rain_reflections、composition.action.low_impact、composition.action.dutch_imbalance、composition.action.foreground_whip
- 禁忌/AI 风险：unsourced_weather；action_causality_loss（雨丝水花遮挡接触点）。
- 竖屏提示：中近景压缩双方距离，雨丝统一 15–30° 斜向；水花只在接触点出现。

### 3.15 群体冲锋（composition.action.group_charge）

- 英文名：Group Charge
- 画面结构：成群人物沿同一方向冲向镜头或目标，前排大、后排叠，纵深层次明确。
- 叙事功能：规模压迫与集体意志。
- 适用场景：群斗冲锋、军队或人群涌来。
- 证据要求：action_blocking；群体规模与身份须有据。
- 可组合模式：composition.action.low_impact、composition.basic.repetition、composition.action.smoke_depth、composition.basic.s_curve
- 禁忌/AI 风险：extra_figures（复制脸、服装重复错误）；screen_direction_flip；action_causality_loss。
- 竖屏提示：冲锋沿竖屏纵深而来；前排 1–2 人清晰、后排剪影化，服装统一以辨识阵营。

### 3.16 尾势收镜（composition.action.tail_settle）

- 英文名：Tail-Momentum Settle
- 画面结构：动作完成后镜不切，跟随余势落到终结姿态——喘息、倒地、收手，画面静止。
- 叙事功能：让动作后果被看见，给观众落点。
- 适用场景：搏斗结束、冲刺后停下、击中后的停顿。
- 证据要求：action_blocking。
- 可组合模式：composition.action.leap_freeze、composition.action.low_impact、composition.basic.wide_closure、composition.film.static_wait
- 禁忌/AI 风险：false_camera_motion（自行漂移或多余环绕）；motion_blob（余势糊掉）。
- 竖屏提示：运镜随人物停稳而 locked-off；终结姿态放三分交点，镜尾保持 0.5–1 秒可读。

## 4. 人物与叙事 character（16）

以人物关系与心理外化为核心。需要窗、门、镜、桌、走廊等特定空间构件的模式为 `set_dressing`；其余依靠演员调度即可成立，为 `composition-only`。

### 4.1 背影独处（composition.character.lonely_back）

- 英文名：Solitary Back View
- 画面结构：人物背对镜头，处于画面中上部或偏小，环境空旷或纵深悠长。
- 叙事功能：拒绝被看见内心、孤独、走向未知。
- 适用场景：独自离开、驻足窗前、人群中疏离。
- 证据要求：composition-only。
- 可组合模式：composition.basic.wide_closure、composition.film.corridor_perspective、composition.basic.breathing_room、composition.film.backlight_silhouette
- 禁忌/AI 风险：dead_air；character_identity_drift（背影无法识别——用服装、发型、标志物保证）。
- 竖屏提示：背影占画面 1/3–1/2 高度，头顶留空；用服装轮廓与发色锚定身份。

### 4.2 窗前沉思（composition.character.window_contemplation）

- 英文名：Window Contemplation
- 画面结构：人物侧对或面对窗，窗光落在脸或手上，视线穿过窗外或垂下。
- 叙事功能：把内心活动外化为与光、与外界的关系。
- 适用场景：清晨独坐、等待消息、做出决定前。
- 证据要求：set_dressing（窗与窗外景观须为场景资产）；窗外天气按 weather_atmosphere 校验。
- 可组合模式：composition.film.window_side_light、composition.character.profile_gaze、composition.character.borrowed_scenery、composition.film.static_wait
- 禁忌/AI 风险：unsourced_set_element；dead_air（无内心事件时长镜空洞）。
- 竖屏提示：窗框竖向分割画面，人物放中下交点；窗外景观虚实服务于视线。

### 4.3 双人对峙（composition.character.two_shot_standoff）

- 英文名：Two-Person Confrontation
- 画面结构：两人同框，正面相对或侧向镜头，间距、视线与高度差标明权力关系。
- 叙事功能：一镜内承载意志对撞，距离变化即关系变化。
- 适用场景：摊牌、逼问、分手。
- 证据要求：composition-only；冲突与双方在场由剧本支持。
- 可组合模式：composition.action.weapon_line、composition.basic.negative_compression、composition.film.warm_cool_clash、composition.character.proxemic_distance
- 禁忌/AI 风险：eyeline_or_axis_break（视线不交或高度跳变）。
- 竖屏提示：竖屏双人用前后纵深（一前一后或越肩）或同侧并排，避免横排裁切；逼近的距离变化在镜内完成。

### 4.4 桌边谈判（composition.character.table_negotiation）

- 英文名：Table Negotiation
- 画面结构：长桌或小桌形成水平／纵深分界，对坐双方隔桌相望，手与桌上物件成为信息点。
- 叙事功能：谈判即战场，桌面宽度即心理距离。
- 适用场景：商务谈判、审问桌、家庭饭桌。
- 证据要求：set_dressing；桌、椅与桌上道具须在资产中。
- 可组合模式：composition.character.two_shot_standoff、composition.basic.layered_zones、composition.film.selective_highlight、composition.film.color_block
- 禁忌/AI 风险：unsourced_set_element（凭空出现文件、茶具等道具）；depth_flattening。
- 竖屏提示：优先沿桌子纵深拍摄（近端肩膀加远端人脸）；关键手部动作放上 1/3。

### 4.5 走廊相遇（composition.character.corridor_encounter）

- 英文名：Corridor Encounter
- 画面结构：两人在长廊纵深中相向而行或错身，走廊线条把相遇点钉在远端或中段。
- 叙事功能：无法回避的正面接触，以及错身后的关系变化。
- 适用场景：医院、学校、办公楼走廊。
- 证据要求：set_dressing；走廊为已建立场景。
- 可组合模式：composition.film.corridor_perspective、composition.basic.leading_lines、composition.character.two_shot_standoff、composition.character.doorway_pause
- 禁忌/AI 风险：unsourced_set_element；eyeline_or_axis_break（错身方向矛盾）。
- 竖屏提示：相遇点放纵深远端三分线；错身时用前景一人掠过、另一人居中。

### 4.6 门口停顿（composition.character.doorway_pause）

- 英文名：Doorway Pause
- 画面结构：人物停在门槛，身体被门框切割（一半在内一半在外），面向门外或回望室内。
- 叙事功能：决定前后的悬置——留下还是离开、进入还是退出。
- 适用场景：出门前、进入陌生房间、告别。
- 证据要求：set_dressing；门须存在且开向与场景一致。
- 可组合模式：composition.basic.frame_within_frame、composition.film.warm_cool_clash、composition.film.static_wait、composition.character.back_exit
- 禁忌/AI 风险：unsourced_set_element；screen_direction_flip（门的开向前后镜不一致）。
- 竖屏提示：门框竖边切分人物 1/3 处，门内门外光比区分两个世界；门槛横在画面下 1/3。

### 4.7 侧脸凝视（composition.character.profile_gaze）

- 英文名：Profile Gaze
- 画面结构：纯侧面面部朝向画框一侧，视线望向画外或远方，留白在视线方向。
- 叙事功能：凝视本身即内容——欲望、警觉、出神。
- 适用场景：看向来人、望向远方、倾听。
- 证据要求：composition-only。
- 可组合模式：composition.film.window_side_light、composition.film.shallow_dof、composition.basic.breathing_room、composition.film.mirror_reflection
- 禁忌/AI 风险：无特殊风险；视线对象应在下一镜或画外音中有交代。
- 竖屏提示：侧脸放上 1/3，鼻尖到画边保留至少 15% 画面；侧光勾出轮廓。

### 4.8 远近关系（composition.character.proxemic_distance）

- 英文名：Proxemic Distance
- 画面结构：用两人的画面距离与景深距离编码亲密度——同近景亲密，一近一远疏离。
- 叙事功能：不写台词地交代关系温度变化。
- 适用场景：和好、冷战、试探、主仆。
- 证据要求：composition-only。
- 可组合模式：composition.character.two_shot_standoff、composition.basic.depth_stack、composition.character.spatial_barrier、composition.film.shallow_dof
- 禁忌/AI 风险：depth_flattening（竖屏把远处人贴到近处人身上）。
- 竖屏提示：竖屏用上下或虚实分配两人距离；远者保留服色识别点。

### 4.9 镜中自照（composition.character.mirror_self）

- 英文名：Mirror Self-Regard
- 画面结构：人物直视镜中自己，真实人物以侧脸或背影入画，与镜中正面并列。
- 叙事功能：自我对话、身份确认，或崩塌前的平静。
- 适用场景：梳妆、更衣、卸妆、说谎前。
- 证据要求：set_dressing；镜子存在于场景资产。
- 可组合模式：composition.film.mirror_reflection、composition.character.emotional_closeup、composition.film.selective_highlight、composition.character.averted_eyeline
- 禁忌/AI 风险：unsourced_set_element；mirror_reflection_anomaly（表情口型不同步、反射穿帮）。
- 竖屏提示：镜中脸为唯一清晰面部，真实身体侧或背入镜；镜缘竖直且不切脸。

### 4.10 借景抒情（composition.character.borrowed_scenery）

- 英文名：Borrowed-Scenery Lyricism
- 画面结构：人物小而环境景观大（月、江、雪、城市灯火），景即是情的外化。
- 叙事功能：把不可直说的情绪交给环境。
- 适用场景：抒情段落、决心时刻、失恋远景。
- 证据要求：composition-only；景观与天气必须是场景真实可见内容，不得新增雪、月、灯火等。
- 可组合模式：composition.basic.wide_closure、composition.film.establishing_empty、composition.character.lonely_back、composition.film.fog_wrap
- 禁忌/AI 风险：unsourced_weather（为抒情硬加雨雪月）；pattern_stacking（景观压过人物信息）。
- 竖屏提示：人物放下 1/3 交点、景观占上方 2/3；选择竖向自然景观（高楼、江面、坡道）。

### 4.11 关系三角（composition.character.relational_triangle）

- 英文名：Relational Triangle
- 画面结构：三人各占三角形顶点，视线沿边流动，焦点人物在关系变化时被两人注视。
- 叙事功能：一镜呈现三角关系（爱、猜忌、上下级）。
- 适用场景：三人对话、揭穿、争风。
- 证据要求：composition-only；三人在场由剧本支持。
- 可组合模式：composition.action.group_standoff、composition.basic.layered_zones、composition.character.proxemic_distance、composition.character.two_shot_standoff
- 禁忌/AI 风险：eyeline_or_axis_break；primary_info_unreadable（不知该看谁）。
- 竖屏提示：竖屏三角变纵深三角（近端一人、远端两人或反之）；用焦点转移切换被注视者。

### 4.12 视线回避（composition.character.averted_eyeline）

- 英文名：Averted Eyeline
- 画面结构：对话中一人视线错开对手（下垂、侧向、看手），留白在回避方向。
- 叙事功能：谎言、羞愧、抗拒连接。
- 适用场景：被质问、道别、隐瞒。
- 证据要求：composition-only。
- 可组合模式：composition.basic.breathing_room、composition.character.emotional_closeup、composition.character.profile_gaze、composition.basic.thirds
- 禁忌/AI 风险：primary_info_unreadable（回避过度变成没在演戏）。
- 竖屏提示：视线下垂的落点放画面下 1/3 的具体物（手、杯子），避免空瞟。

### 4.13 空间隔阂（composition.character.spatial_barrier）

- 英文名：Spatial Barrier
- 画面结构：门框、玻璃、家具或一段空距把两人分到两个空间区域。
- 叙事功能：看得见但无法靠近——关系的物化。
- 适用场景：隔门对话、车窗内外、病房。
- 证据要求：composition-only（用距离或画框分割）；实体隔断（玻璃、门）需 set_dressing 证据。
- 可组合模式：composition.basic.frame_within_frame、composition.basic.negative_compression、composition.character.proxemic_distance、composition.film.warm_cool_clash
- 禁忌/AI 风险：unsourced_set_element（凭空加玻璃栏杆）；primary_info_unreadable（隔断反光盖脸）。
- 竖屏提示：隔断沿竖直方向分割，两侧各保留一人完整头部；反光不遮眼。

### 4.14 情绪特写（composition.character.emotional_closeup）

- 英文名：Emotional Close-Up
- 画面结构：近景或特写锁定面部（眼、嘴、喉结），背景简化或化开。
- 叙事功能：把情绪的物理证据交给观众判断，而非台词宣告。
- 适用场景：听到真相、强忍、决定瞬间。
- 证据要求：composition-only。
- 可组合模式：composition.film.shallow_dof、composition.film.selective_highlight、composition.character.averted_eyeline、composition.basic.breathing_room
- 禁忌/AI 风险：lens_distortion（特写畸变）；character_identity_drift（脸部走样）；禁止无依据的极端特写连打。
- 竖屏提示：眼睛放上 1/3 交点；保留肩线支撑，避免脸贴满屏。

### 4.15 背向离场（composition.character.back_exit）

- 英文名：Back-Turned Exit
- 画面结构：人物转身背对镜头走向纵深远端或出画，镜头固定，门、走廊或路收住画面。
- 叙事功能：关系结束、退出舞台，把余味留给空空间。
- 适用场景：分手离场、走出门、结束对话。
- 证据要求：composition-only。
- 可组合模式：composition.character.doorway_pause、composition.character.lonely_back、composition.basic.wide_closure、composition.action.tail_settle
- 禁忌/AI 风险：screen_direction_flip（离场方向与来向矛盾）；dead_air（走得太慢发闷）。
- 竖屏提示：走向竖屏纵深远端；出画后保留约 0.5 秒空镜，或在门前停半步。

### 4.16 结尾孤景（composition.character.final_solitude）

- 英文名：Final Solitary Frame
- 画面结构：段落或集尾，人物独自留在画面一角或深处，空间占绝对主导，镜尾静止。
- 叙事功能：以孤独定格收束主题，留下钩子或余韵。
- 适用场景：集尾、事件后独处、回头一望之后。
- 证据要求：composition-only。
- 可组合模式：composition.basic.wide_closure、composition.character.lonely_back、composition.film.static_wait、composition.basic.symmetry
- 禁忌/AI 风险：dead_air；vertical_crop_loss（人物在竖屏远景中消失）。
- 竖屏提示：人物必须有可读视觉锚点（服色、光、轮廓边缘）；竖向环境线条指向人物。
