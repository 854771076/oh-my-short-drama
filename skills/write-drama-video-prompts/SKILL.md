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

按制作计划先把当前镜头的分镜板或故事版放入引用清单并占用一个图片槽位，默认使用 `shot-board`。若其他已选人物、场景、道具超过 Provider 剩余图片槽位且 `overflow_strategy=compose-assets`，调用 `node scripts/media-tools.mjs compose-grid` 将这些图片按计划顺序拼成一张 `other-refpack-epNNN-NNN` 合板，登记为 `other` 资产并保留全部 `source_assets`，选版后仅把该合板作为一个图片引用。不得静默丢弃素材；策略为 `reject` 时停止并报告槽位不足。

输出统一为严格 JSON `{prompt_profile,input_mode,prompt,duration,references,continuity,audio_policy}`。Seedance 2.0 的 `prompt` 必须为中文自然语言，并让 `@图片N/@视频N/@音频N` 与引用清单及提交数组一一对应；总素材不超过 12 个，图片≤9、视频≤3且合计2–15秒、音频≤3且合计≤15秒，时长4–15秒，并禁止上传真实人物脸部参考。H3 使用 T2VA/I2VA/FL2VA/L2VA/Ref2VA 中与真实输入一致的模式；Ref2VA 的英文六段必须严格按 `subject_definitions → summary → retention_analysis → detailed_description → overall_soundscape → non_diegetic_music` 排列，仅对白、歌词和画内文字保留原语言。不得混用两套语法。

提示词必须覆盖完整时长、人物动作、相机曲线、逐字台词/旁白、声音策略和镜尾转场，并原样保留连续性与声音合同。每个引用必须定义用途；没有参考素材时不得伪造标签。声音时间表放不下台词时回到剧本/分镜调整，不加速硬塞。

提示词编译不能修饰一个不合格分镜；若一个 panel 仍含多个独立动作，先退回 `build-drama-storyboard` 拆镜。H3 Ref2VA 的参考清单中 `role` 是供应商协议角色，素材的中文用途另存为 `purpose`（或保留在同一用途字段的审计文本），两者不能混淆；提交数组顺序、清单顺序和正文 `<Picture N>` 必须完全一致。所有动作必须用可观察的时间点和完成状态描述，禁止只写“镜头表现/随后发生”这类不可验收句。

同一角色跨当前/未来时空的对白必须共享音色身份合同。若视频模型不能保证跨镜声纹一致，提示词仍保留说话人身份，但制作计划必须标记 `post-dub` 或可审计的后期电话处理，不能让每镜原生音频各自随机生成后再假定为同一角色。

不得把故事板纸张、分格、箭头、编号、水印或 UI 生成进成片。用 `project-store.mjs put-episode-document <项目目录> video-prompts <episode-key> <version> <JSON>` 保存不可变版本，再显式选定；每镜记录制作计划版本、分镜版本、模型、提示词协议、引用资产版本和最终 prompt。修改任一上游版本必须生成新版本，不覆盖旧提示词。
