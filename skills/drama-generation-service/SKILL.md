---
name: drama-generation-service
description: 统一路由短剧图片、视频和音频生成 Provider。用于让用户选择 StarRouter、RunningHub、Comfly 或后续适配器，提交任务并把结果保存到本地；不负责文本创作判断。
---

# 短剧生成服务

标准流程中的剧本、导演本、资产描述、制作规划和视频提示词由 Codex 直接生成并落盘，不调用外部文本模型。图片、视频或音频生成前先调用 `list_generation_providers`，按用户明确选择的 Provider 和模态能力路由；未选择时停止，不自动使用默认供应商。

如果当前任务的 MCP 工具列表没有 `list_generation_providers`、`list_models`、`generate_image`、`submit_video` 或 `generate_audio`，必须停止媒体生产并提示用户使用 `⌘Q` 完全退出 Codex 后重新打开；仅新建任务不会刷新桌面进程的插件 MCP 快照。禁止用占位文件、虚构成功响应或纯文本替代媒体结果。

付费前必须展示并确认：Provider、模型或工作流 ID、提示词版本、prompt_profile、input_mode、数量、尺寸/分辨率、时长、参考素材版本及其用途与顺序、声音策略和费用影响。所有图片、视频、音频调用必须传项目绝对路径 `project_root`、目标资产 key `target` 和 `prompt_document`：视频为 `{episode_key,version_id,shot_number}`；人物/场景/道具图为 `{kind:"asset-plan",episode_key,version_id,asset_key}`；分镜图为 `{kind:"storyboard",episode_key,version_id,shot_number}`；音频为 `{kind:"audio-plan",episode_key,version_id,line_index}`。只有不属于正式制作资产的 `other-*` 辅助图可传 `null`。视频还必须传 `prompt_version` 和结构化 `reference_manifest`，确认后才传 `confirmed: true`。

生成入口以 `project.json.providers` 为已确认路由，实际 Provider 与模型/工作流必须一致。视频只能使用当前 selected 且已批准、无未决项的 `video-prompts` 版本；目标 key 固定为 `shot-epNNN-NNN`，提示词正文、模型、profile、输入模式、时长以及参考素材的类型、顺序、资产版本和用途必须逐项等于该镜合同。图片必须引用当前 selected 的资产计划或分镜，并与所属图片 Skill 留下的提示词正文一致；`reference_manifest` 与 `reference_paths` 等长，逐项绑定 selected 本地图片版本、用途和顺序。音频必须逐字匹配当前 approved `audio-plan` 的行，并匹配说话人—Provider—模型—voice 绑定。任何不一致都在请求 Provider 前拒绝。

- StarRouter：图片可直接生成或用本地 `reference_paths` 编辑；Seedance 和 MiniMax H3/H3-Max 视频提交后用 `get_generation_task` 查询；MiniMax 语音通过同步 `/v1/audio/speech` 生成，使用 `model/input/voice`，结果归一化为 base64 音频。
- RunningHub：通用图片/视频/音频使用工作流 ID 和 `node_info_list`；内置 `minimax-h3-reference-to-video` 不需要节点配置，直接上传本地 0–9 张图片、0–2 段视频和 0–2 段音频并注入 H3 专用 workflow。
- Comfly：当前只接入 `minimax-h3` 的 Ref2VA 视频；固定 `input_mode=Ref2VA`，支持 1–3 张公开 HTTPS 参考图片或 1 段公开视频，二者互斥，不支持参考音频。工作流按素材数与尺寸确定，不能让用户直接填写内部编号。
- 临时公开 URL：目标 Provider 不支持本地上传时路由 `publish-drama-references`。Litterbox 免费匿名但公开、短期且受使用条款约束，必须单独确认，不能自动上传或充当最终资产库。
- 音频：仅当 Provider 声明 audio 能力时调用。StarRouter 生成前必须确认模型、台词、音色 ID、语速、格式、MiniMax metadata 和费用；当前同步接口禁止 `stream=true`。RunningHub 继续承载用户自定义音频工作流。

生成 MCP 会在调用 Provider 前自动把实际 MCP 入参保存为不可变 `.short-drama/requests/<request-id>.json`，并先在 `tasks.json` 原子登记 `submitting`，杜绝并发重复付费。快照包含完整提示词、Provider、模型/工作流、全部模型参数、引用 URL/路径与清单、提示词文档引用、目标资产和输入指纹；API Key、Token、Authorization、密码和内联媒体禁止写入。视频的每个实际本地路径必须等于清单资产版本；Litterbox URL 必须有提交时间点有效的同版本收据。Provider 调用成功或失败后任务再结算为远端 ID 或失败状态。完成查询统一返回 `outputs[]`；全部结果逐项用 `asset-ledger.mjs fetch|decode` 保存并校验哈希。provenance 必须关联 Provider、模型/工作流、任务 ID、提示词文档和上游资产版本。本地文件存在且账本登记成功前，不得把任务标记 completed。

Provider 错误不触发静默切换；更换 Provider、模型、工作流或重新付费必须再次确认。协议细节分别见 [StarRouter](../../references/starrouter-provider.md)、[RunningHub](../../references/runninghub-provider.md) 与 [Comfly](../../references/comfly-provider.md)。

发生提交超时、远端已收单但本地未拿到 task_id 时，禁止盲目重试：先按请求快照的创建时间、目标资产、Provider 返回和任务列表查找可关联的远端任务，写入恢复证据后再继续轮询。只有在确认远端未收单且用户再次确认时才能重提。适配器校验供应商协议角色时不得把项目用途文案误当固定角色；失败请求、超时请求和恢复关联都必须保留在请求/任务账本，不能删除以制造“干净历史”。

## StarRouter 参数枚举

- 图片：`model=gpt-image-2`；`resolution ∈ {1K,2K,4K}`；`aspect_ratio ∈ {1:1,16:9,9:16,4:3,3:4}`；`quality ∈ {auto,low,medium,high}`；`background ∈ {auto,opaque,transparent}`；`moderation ∈ {auto,low}`；`output_format ∈ {png,jpeg,webp}`；`n=1..4`。
- 视频：Seedance 模型枚举见 `configure-generation-providers`；`prompt_profile ∈ {seedance2,h3,generic}`。Seedance 2.0 使用 `input_mode ∈ {first-last-frame,full-reference}`、`duration=4..15`、`resolution ∈ {480p,720p,1080p}`、`ratio ∈ {16:9,9:16,1:1,4:3,3:4}`。MiniMax `model ∈ {MiniMax-H3,MiniMax-H3-Max}`、`input_mode ∈ {T2VA,I2VA,FL2VA,L2VA,Ref2VA}`、`size ∈ {480P,768P,2K}`、`ratio ∈ {21:9,16:9,4:3,1:1,3:4,9:16}`；H3 仅支持 `768P/2K` 和 4–15 秒，H3-Max 仅支持 `480P/768P` 和 5–15 秒且不支持 Ref2VA。首尾帧与参考素材不能混用。
- 语音：`model ∈ {speech-2.8-hd,speech-2.8-turbo}`；`speed=0.5..2`；`response_format ∈ {mp3,pcm,flac}`；`metadata.output_format ∈ {hex,url}`；当前 `metadata.stream=false`。完整嵌套枚举见 `design-drama-audio`。

枚举是适配器允许提交的边界；具体模型是否支持某个组合仍以 `list_models` 返回和实测为准。任何自定义模型必须先补能力合同与一次真实调用记录，不能仅加入环境变量列表。

## RunningHub 与 Comfly H3 枚举

- RunningHub：`model=minimax-h3-reference-to-video`；图片 `0..9`、视频 `0..2`、音频 `0..2`；`duration=1..15`（1–4 归一为 5）；`ratio ∈ {16:9,9:16}`；`resolution ∈ {480p,720p,1K,2K}`。
- Comfly：`model=minimax-h3`；`input_mode=Ref2VA`；图片 `1..3` 或视频 `0..1`，两者互斥；音频固定 `0`；`duration=5..15` 的整数且不会静默取整；`ratio ∈ {16:9,9:16}`；`resolution ∈ {720p,1K,2K}`。
