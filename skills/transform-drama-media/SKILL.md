---
name: transform-drama-media
description: 对短剧媒体执行可追溯变换与专项审核。用于图片改图、宫格处理、视频裁剪、换声、稳定、降噪、调色、局部修复、补帧、对口型、高清化和首尾帧提取；不承担新的剧情创作。
---

# 转换短剧媒体

先区分语义生成与确定性变换。图片改图先由 Codex 使用 `image_prompt_modify` 输出严格 JSON，再把其中 `image_prompt` 原样作为媒体模型 prompt；生成入口会核对这份 Codex 合同留痕。二维角色转真人直接使用 Provider 提示词 `2d_to_live_action`。两者都引用目标资产所在的当前 `asset-plan` 或 `storyboard` 文档，需确认参考图、模型和费用；必须保持身份、构图和未授权区域不变。

宫格合成、宫格拆分、普通裁剪和视频帧提取属于确定性操作，使用 `node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/media-tools.mjs" <compose-grid|split-grid|crop|extract-frame>`，不调用生成模型；`probe` 用于回读技术参数。视频引用槽位不足时的资产合板固定使用 `other-refpack-epNNN-NNN`，按制作计划中的引用顺序合成，并把所有源资产版本写入 `provenance.source_assets`。脚本要求显式输出路径且不接受原地覆盖意图。记录源文件哈希、参数和输出路径；格数、阅读顺序、裁剪区域或首尾帧位置不明确时先停止。生成式宫格高清化交给 `generate-storyboard-images`，不得把保真修复当重绘。

视频修复统一调用 MCP `submit_media_operation`：`confirmed=false` 先核对来源、范围、遮罩、Provider 能力与上传摘要，用户已确认费用后才以 `confirmed=true` 提交。确定性操作使用 `provider:local`；对口型、视频局部重绘和超分必须使用声明了对应细粒度能力的 Provider。输入只能是当前 selected 且未失效的本地版本，输出永远登记为新的未选候选，禁止覆盖来源文件。异步任务用 `get_media_operation` 查询；只有 Provider 已完成但未自动下载时才用 `register_media_operation_output`，不得凭空伪造任务结果。

RunningHub 高清化默认使用命名模型 `seedvr2.5-video-upscale`。它固定绑定工作流 `2099866760106491906` 和内置官方映射 `25.video`，不得传手写 `node_info_list`、不得替换工作流、不得用别的 SeedVR 工作流冒充。先以 `confirmed:false` 取得包含 selected 资产版本、SHA-256、唯一上传、工作流和节点覆盖的摘要；针对该摘要取得动作时确认后才提交。任务完成只轮询原任务 ID，不因等待或失败自动重提。

SeedVR 输出回写会保留 Provider 原始文件证据，并拒绝工作流未声明的时长或帧率漂移。若来源有声音而输出无音轨，系统用源音轨生成独立最终候选，provenance 必须同时绑定原始输出和音轨来源；任何一步都不自动替换 selected。若自动门禁失败，保留证据并停止，不得用人工观察覆盖技术漂移。

候选生成后先运行 `media-tools.mjs qc <候选视频>`，再完整观看和听完，最后调用 MCP `review_media_operation`。审核观察项固定如下：裁剪为 `inside_range,outside_range,duration,audio_preservation`；替换音轨为 `inside_range,outside_range,audio_sync,voice_identity,duration`；稳定、降噪、调色、遮罩模糊、补帧和局部重绘为 `inside_range,outside_range,identity,temporal_consistency`；对口型为 `sync_timing,identity,mouth_artifacts,non_target_faces,duration`；超分为 `resolution,duration_fps,audio_preservation,faces_hands_text,motion_artifacts,color_crop`。视频超分 QC 还必须写入实际输出帧率。只有 QC 绑定候选 SHA-256 且通过、`watched_full:true`、无 P0/P1 并覆盖该类型全部观察项时才允许选中；失败候选保留为可追溯记录，不得进入时间线。
