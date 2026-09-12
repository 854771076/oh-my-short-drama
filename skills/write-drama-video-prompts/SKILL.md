---
name: write-drama-video-prompts
description: 把通过验收的本地分镜按实际视频模型编译为可执行提示词。内置 Seedance 2.0、MiniMax H3 和通用路径；用于动作、运镜、引用、声音和转场规划，不提交视频任务。
---

# 编写视频提示词

先读取已批准制作计划和 Provider 实时能力，按“节点/镜头显式覆盖 → 制作计划 `prompt_profile` → 模型识别”确定唯一编译路径：

- Seedance 2.0/2.0 Fast 使用 `seedance2_video`。
- StarRouter `MiniMax-H3|MiniMax-H3-Max`、RunningHub `minimax-h3-reference-to-video` 或 Comfly `minimax-h3` 使用 `h3_video`；H3-Max 不得选择 Ref2VA。
- 其他已确认模型才按参考图类型使用 `panel_grid_video` 或 `panel_storyboard_video`；无法确认提示词协议时停止，不把通用模板冒充模型专属模板。

所有模板都填充 `base_prompt`、`storyboard_context_json`、`grid_layout`、`panel_grid_size`、`camera_move`、`shot_type`、`style`、`duration_constraints` 和 `reference_manifest_json`。引用清单只包含已选本地资产、版本、用途及提交顺序，不包含密钥或临时 URL。

按制作计划先把当前镜头的分镜板或故事版放入引用清单并占用一个图片槽位，默认使用 `shot-board`。若其他已选人物、场景、道具超过 Provider 剩余图片槽位且 `overflow_strategy=compose-assets`，调用 `node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/media-tools.mjs" compose-grid` 将这些图片按计划顺序拼成一张 `other-refpack-epNNN-NNN` 合板，登记为 `other` 资产并保留全部 `source_assets`，选版后仅把该合板作为一个图片引用。不得静默丢弃素材；策略为 `reject` 时停止并报告槽位不足。

每次模板编译统一输出严格 JSON `{prompt_profile,input_mode,prompt,duration,references,continuity,audio_policy,errors}`。Seedance 2.0 的 `prompt` 必须为中文自然语言，并让 `@图片N/@视频N/@音频N` 与引用清单及提交数组一一对应；总素材不超过 12 个，图片≤9、视频≤3且合计2–15秒、音频≤3且合计≤15秒，时长4–15秒，并禁止上传真实人物脸部参考。H3 使用 T2VA/I2VA/FL2VA/L2VA/Ref2VA 中与真实输入一致的模式；Ref2VA 的英文六段必须严格按 `subject_definitions → summary → retention_analysis → detailed_description → overall_soundscape → non_diegetic_music` 排列，仅对白、歌词和画内文字保留原语言。不得混用两套语法。

保存前把逐镜编译结果包装为顶层严格合同 `{episode_key,source_versions,shots,unresolved,approved}`；每个 `shots` 项在上述八个模板字段外，必须从已选制作计划原样补入 `shot_number`、`production_plan_version`、`storyboard_version`、`provider` 和 `model_or_workflow`。任一镜 `errors` 非空时同步写入 `unresolved` 且 `approved=false`，禁止省略 `errors`、伪造空数组或手写占位文档。

提示词必须覆盖完整时长、人物动作、相机曲线、逐字台词/旁白、声音策略和镜尾转场，并原样保留连续性与声音合同。每个引用必须定义用途；没有参考素材时不得伪造标签。声音时间表放不下台词时回到剧本/分镜调整，不加速硬塞。

分镜构图合同（`visual_plan.composition`、`composition_contract` 或 `photographyPlan.composition`）只作为编译输入：按 [导演构图模式参考](../../references/director-composition.md) 中该模式的画面结构与竖屏提示，把 primary/secondary code 翻译为主体位置、视线留白、前中后景、光源方向与剧内来源、遮挡比例、动作屏幕方向、镜尾状态等可见几何和逐时间点动作；仅在拿不准 code 含义、证据要求或 ai_risks 时按需查阅该参考。禁止把构图 code、模式名称或模式目录抄进任何模型提示词，也不得只复读名称而不给可见执行项。

人物离画后，把离画边、最后姿态、运动方向和持物状态作为画外连续性继续传递，直到其重新入画或场景明确重置。重新入画不得仅凭当前画面任意选边，必须与该记录、当前轴线和空间入口相容。

编译前逐项对照起始参考帧与本镜所需人物、道具和空间结构。关键元素若应从首帧就在场却缺失，必须退回分镜图补齐或改用能绑定该资产的参考模式；只有剧本明确要求从画外进入时，才可写明首帧缺席、进入方向和出现路径。除有意空镜或 hold 外，首帧应已有可读主体或动作起势，不消耗成片时长等待主体到场。多人镜锁定准确人数、画面左右顺序、朝向和每只参与动作的手部归属；复杂交互无法清楚归属时拆镜。

画内手机、电视、电脑或招牌的内容必须来自 source_text 或已批准图形合同；没有内容证据时让屏幕关闭、空白或不可辨读，不允许模型自行填充随机文字和 UI。剧情依赖的精确消息、倒计时、地点或界面交给 Remotion 图形层实现，视频素材只保留可跟踪的屏幕平面、遮挡和光照。

提示词编译不能修饰一个不合格分镜；若一个 panel 仍含多个独立动作，先退回 `build-drama-storyboard` 拆镜。H3 Ref2VA 的参考清单中 `role` 是供应商协议角色，素材的中文用途另存为 `purpose`（或保留在同一用途字段的审计文本），两者不能混淆；提交数组顺序、清单顺序和正文 `<Picture N>` 必须完全一致。所有动作必须用可观察的时间点和完成状态描述，禁止只写“镜头表现/随后发生”这类不可验收句。

动作结果必须在镜尾前成为清晰可见且短暂稳定的状态；若剪辑必须提前切走，下一镜从该结果已经成立的状态开始。步行镜仅在剧情需要时细化落脚、重心转移和地面接触；同行者还要锁定并排/前后关系与共同速度。跨镜动作或打斗优先让前镜尾帧成为后镜首帧，并在运动中切接，避免每段回到静止预备姿势。

复杂打斗先核对所选 Provider 与运动/视频参考是否支持精确招式。缺少可验证支持时，不用招式名称代替编排；拆成地理建立、蓄力、双方身体位置、接触点、受力结果和反应镜头。只有参考素材能约束运动轨迹时才保留精确招式，并继续核对轴线、肢体归属和结果连续性。

同一角色跨当前/未来时空的对白必须共享音色身份合同。若视频模型不能保证跨镜声纹一致，提示词仍保留说话人身份，但制作计划必须标记 `post-dub` 或可审计的后期电话处理，不能让每镜原生音频各自随机生成后再假定为同一角色。

不得把故事板的铅笔、炭笔、单色、纸张质感、分格、箭头、编号、水印或 UI 生成进成片；故事板只传递构图、轴线和动作顺序，提示词必须重申项目成片媒介。每个无错镜头的 `prompt` 必须原样包含模板规定的固定反宫格声明（中文模板用中文句、H3 用英文句，按模板要求放在首句/末句或视觉描述段首尾）；`project-store.mjs` 会逐镜校验，缺失即校验失败，不得改写或用近义句替代。多格分镜板（`panel_grid_size > 1`）整张作为语义参考引用时，prompt 还必须原样包含模板中的分镜板时间顺序条款（画格只表示动作时间顺序，禁止画格边框/分割线/编号/多格并排），MCP 提交前逐镜校验；多格板只能配 `full-reference`/`Ref2VA`/`reference_image`，禁止配首帧/尾帧像素模式。用 `project-store.mjs put-episode-document <项目目录> video-prompts <episode-key> <version> <JSON>` 保存不可变版本，再显式选定；每镜记录制作计划版本、分镜版本、模型、提示词协议、引用资产版本和最终 prompt。修改任一上游版本必须生成新版本，不覆盖旧提示词。
