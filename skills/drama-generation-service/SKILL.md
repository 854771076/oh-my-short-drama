---
name: drama-generation-service
description: 统一路由短剧图片、视频和音频生成 Provider。用于让用户选择阿里云百炼、StarRouter、RunningHub、Comfly 或后续适配器，提交任务并把结果保存到本地；不负责文本创作判断。
---

# 短剧生成服务

标准流程中的剧本、导演本、资产描述、制作规划和视频提示词由 Codex 直接生成并落盘，不调用外部文本模型。图片、视频或音频生成前先调用 `list_generation_providers`，按用户明确选择的 Provider 和模态能力路由；未选择时停止，不自动使用默认供应商。

如果当前任务的 MCP 工具列表没有 `list_generation_providers`、`list_models`、`generate_image`、`submit_video`、`ensure_reference_urls`、`submit_episode_videos`、`await_episode_tasks`、`generate_audio`、`submit_media_operation`、`review_media_operation`、`design_voice`、`clone_voice`、`list_voices`、`delete_voice` 或需要配乐时没有 `generate_music`，必须停止对应媒体生产并提示用户使用 `⌘Q` 完全退出 Codex 后重新打开；仅新建任务不会刷新桌面进程的插件 MCP 快照。禁止用占位文件、虚构成功响应或纯文本替代媒体结果。

整集视频按批量流程执行：`ensure_reference_urls` 一次发布公开参考（一次四项确认）、`submit_episode_videos` 先 `confirmed:false` 出逐镜费用摘要，同一集同一选版和镜头范围只需一次费用确认后以 `confirmed:true` 并发提交整集，`await_episode_tasks` 服务端并发等待回写；不得逐镜循环确认或逐镜轮询。选版、模型、参数、镜头范围或费用范围变化时必须重新确认。

付费前必须核对并记录：Provider、模型或工作流 ID、提示词版本、prompt_profile、input_mode、数量、尺寸/分辨率、时长、参考素材版本及其用途与顺序、声音策略和费用影响。项目 `automation_mode=true` 时可自动完成这些常规核对，但真实付费授权仍必须由用户明确给出，不能由 agent 代替；未授权时停在提交前，不产生 Provider 请求。所有图片、视频、音频调用必须传项目绝对路径 `project_root`、目标资产 key `target` 和 `prompt_document`：视频为 `{episode_key,version_id,shot_number}`；人物/场景/道具图为 `{kind:"asset-plan",episode_key,version_id,asset_key}`；分镜图为 `{kind:"storyboard",episode_key,version_id,shot_number}`；语音为 `{kind:"audio-plan",episode_key,version_id,line_index}`；音乐为 `{kind:"audio-plan",episode_key,version_id,track_key}`。只有不属于正式制作资产的 `other-*` 辅助图可传 `null`。视频还必须传 `prompt_version` 和结构化 `reference_manifest`，确认后才传 `confirmed: true`。

批量生成按依赖关系分层：每一层所有门禁已通过、彼此无依赖的目标必须在同一批次全量提交，不得等待一个目标完成后再提交下一个。RunningHub 同一 API Key 的图片、视频和音频提交共享最多 2 路并发，其余请求由适配器排队；其他 Provider 仍由上游网关排队。只有派生场景、道具状态或其他明确依赖基础资产选版的目标进入下一层。每个目标仍保持独立请求、任务、失败状态和账本记录，单项失败不取消同批其他目标。

生成入口以 `project.json.providers` 为已确认路由，实际 Provider 与模型/工作流必须一致。视频只能使用当前 selected 且已批准、无未决项的 `video-prompts` 版本；目标 key 固定为 `shot-epNNN-NNN`，提示词正文、模型、profile、输入模式、时长以及参考素材的类型、顺序、资产版本和用途必须逐项等于该镜合同。图片必须引用当前 selected 的资产计划或分镜，并与所属图片 Skill 留下的提示词正文一致；`reference_manifest` 与 `reference_paths` 等长，逐项绑定 selected 本地图片版本、用途和顺序。语音必须逐字匹配当前 approved `audio-plan` 的行，并匹配说话人—Provider—模型—voice 绑定；音乐必须匹配 `audio-plan.music_tracks` 的提示词、标题、标签、歌词、纯音乐开关、Provider 与模型。任何不一致都在请求 Provider 前拒绝。

情感配音先用 `analyze_speech_timing` 保存显式 ASR/对齐证据，再用 `review_speech_timing` 人工复核；`analyze_speech_timing` 和 `compile_dubbing_request` 都是只读或本地操作，不得创建 Provider 任务或隐藏费用。`generate_audio` 与 `generate_audio_fallback` 只能使用当前 selected audio-plan、speech-timing、voice binding 编译出的请求快照；调用者不得手写覆盖授权上下文。每句付费生成最多三轮，每一轮都要明确策略和费用确认，第三轮失败后阻断，禁止自动追加第四次或静默切换 Provider。

生成 MCP 在上述文档校验前先检查本地状态机，并复查全部已完成上游阶段的产物、选版、Skill 凭证和哈希。`generate_image` 的人物/场景/道具目标仅允许 `asset-generation`，分镜图仅允许 `media-production`；`submit_video`、`generate_audio`、`generate_music` 仅允许 `media-production`。门禁失败时不得创建请求快照、任务记录或访问 Provider。视频提示词必须先通过与 `project-store.mjs` 相同的完整合同校验，不把缺字段暴露为运行时 TypeError。

- StarRouter：图片可直接生成或用本地 `reference_paths` 编辑；Seedance 和 MiniMax H3/H3-Max 视频提交后用 `get_generation_task` 查询；语音通过同步 `/v1/audio/speech` 生成；`transcribe_audio`/`translate_audio` 通过 multipart `/v1/audio/transcriptions`/`translations` 处理项目内音频；`suno_music` 异步生成 OP、ED、BGM 或音乐短视频配乐。
- RunningHub：通用图片/视频/音频使用工作流 ID 和 `node_info_list`；内置 `krea2-normal-v1` 图片与 `minimax-h3-reference-to-video` 视频不需要节点配置。
- Comfly：当前只接入 `minimax-h3` 的 Ref2VA 视频；固定 `input_mode=Ref2VA`，支持 1–3 张公开 HTTPS 参考图片或 1 段公开视频，二者互斥，不支持参考音频。工作流按素材数与尺寸确定，不能让用户直接填写内部编号。
- 临时公开 URL：目标 Provider 不支持本地上传时路由 `publish-drama-references`。Litterbox 免费匿名但公开、短期且受使用条款约束，必须单独确认，不能自动上传或充当最终资产库。
- 音频：仅当 Provider 声明 audio 能力时调用。StarRouter 生成前必须确认模型、台词、音色 ID、语速、格式、MiniMax metadata 和费用；当前同步接口禁止 `stream=true`。RunningHub 继续承载用户自定义音频工作流。
- MuseTalk：是可选本地媒体变换 Provider，只声明 `transform.lip-sync`。用户自行设置 `MUSETALK_ROOT`，可选 `MUSETALK_PYTHON` 与 `MUSETALK_ENTRYPOINT`；插件绝不自动安装代码、下载模型或修改外部目录。提交前仍走统一媒体操作门禁：只接收当前 audio-plan 已批准的可见独立对白、唯一可见人脸、同镜 selected 视频/音频和精确毫秒范围。同步输出按请求快照登记为未选中的 transformed 候选。

生成 MCP 会在调用 Provider 前自动把实际 MCP 入参保存为不可变 `.short-drama/requests/<request-id>.json`，并先在 `tasks.json` 原子登记 `submitting`，杜绝并发重复付费。快照包含完整提示词、Provider、模型/工作流、全部模型参数、引用 URL/路径与清单、提示词文档引用、目标资产和输入指纹；API Key、Token、Authorization、密码和内联媒体禁止写入。视频的每个实际本地路径必须等于清单资产版本；Litterbox URL 必须有提交时间点有效的同版本收据。Provider 调用成功或失败后任务再结算为远端 ID 或失败状态。完成查询统一返回 `outputs[]`；全部结果逐项用 `asset-ledger.mjs fetch|decode` 保存并校验哈希。provenance 必须关联 Provider、模型/工作流、任务 ID、提示词文档和上游资产版本。本地文件存在且账本登记成功前，不得把任务标记 completed。

Provider 错误不触发静默切换；更换 Provider、模型、工作流或重新付费必须再次确认。协议细节分别见 [StarRouter](../../references/starrouter-provider.md)、[RunningHub](../../references/runninghub-provider.md) 与 [Comfly](../../references/comfly-provider.md)。

发生提交超时、远端已收单但本地未拿到 task_id 时，禁止盲目重试：先按请求快照的创建时间、目标资产、Provider 返回和任务列表查找可关联的远端任务，写入恢复证据后再继续轮询。只有在确认远端未收单且用户再次确认时才能重提。适配器校验供应商协议角色时不得把项目用途文案误当固定角色；失败请求、超时请求和恢复关联都必须保留在请求/任务账本，不能删除以制造“干净历史”。

## StarRouter 参数枚举

- 图片：`model=gpt-image-2`；`resolution ∈ {1K,2K,4K}`；`aspect_ratio ∈ {1:1,16:9,9:16,4:3,3:4}`；`quality ∈ {auto,low,medium,high}`；`background ∈ {auto,opaque,transparent}`；`moderation ∈ {auto,low}`；`output_format ∈ {png,jpeg,webp}`；`n=1..4`。
- 视频：Seedance 模型枚举见 `configure-generation-providers`；`prompt_profile ∈ {seedance2,h3,generic}`。Seedance 2.0 使用 `input_mode ∈ {first-last-frame,full-reference}`、`duration=4..15`、`resolution ∈ {480p,720p,1080p}`、`ratio ∈ {16:9,9:16,1:1,4:3,3:4}`。MiniMax `model ∈ {MiniMax-H3,MiniMax-H3-Max}`、`input_mode ∈ {T2VA,I2VA,FL2VA,L2VA,Ref2VA}`、`size ∈ {480P,768P,2K}`、`ratio ∈ {21:9,16:9,4:3,1:1,3:4,9:16}`；H3 仅支持 `768P/2K` 和 4–15 秒，H3-Max 仅支持 `480P/768P` 和 5–15 秒且不支持 Ref2VA。首尾帧与参考素材不能混用。
- 语音：`model ∈ {speech-2.8-hd,speech-2.8-turbo,qwen3-tts-vc-realtime-2025-11-27,qwen3-tts-vc-realtime,pawsense-audio,tts-1}`；`speed=0.5..2`；`response_format ∈ {mp3,pcm,flac}`。MiniMax 模型继续校验其嵌套 metadata；通用 OpenAI 兼容模型透传 `instructions` 和 metadata。当前 MCP 只返回完整音频文件，不开放 `stream_format=sse`。
- 转写/翻译：StarRouter `model ∈ {qwen3-asr-flash,whisper-1}`，项目内音频通过 multipart 上传；`response_format ∈ {json,text,srt,verbose_json,vtt}`，可选 `language`、`prompt`、`temperature=0..1`。
- 音乐：`model=suno_music`；`purpose ∈ {op,ed,bgm,music-video}`；可传标题、风格标签和歌词，`make_instrumental=true` 时歌词必须为空。

枚举是适配器允许提交的边界；具体模型是否支持某个组合仍以 `list_models` 返回和实测为准。任何自定义模型必须先补能力合同与一次真实调用记录，不能仅加入环境变量列表。

## RunningHub 与 Comfly H3 枚举

- RunningHub：`model=minimax-h3-reference-to-video`；图片 `0..9`、视频 `0..2`、音频 `0..2`；`duration=1..15`（1–4 归一为 5）；`ratio ∈ {16:9,9:16}`；`resolution ∈ {480p,720p,1K,2K}`。
- RunningHub 图片：`model=krea2-normal-v1`；`resolution ∈ {1K,2K}`；`aspect_ratio ∈ {1:1,16:9,9:16,3:4,4:3,2:3,3:2}`；当前普通工作流不接收参考图。
- Comfly：`model=minimax-h3`；`input_mode=Ref2VA`；图片 `1..3` 或视频 `0..1`，两者互斥；音频固定 `0`；`duration=5..15` 的整数且不会静默取整；`ratio ∈ {16:9,9:16}`；`resolution ∈ {720p,1K,2K}`。

整集图片优先使用 `submit_episode_images`：先以 `confirmed=false` 做全量门禁和费用预检，同一集同一资产计划范围只需一次费用确认，再以 `confirmed=true` 并发提交；单项失败不会阻塞其他已提交项，但预检失败时整批不产生 Provider 请求。资产计划、模型、参数、范围或费用变化时重新确认。可在本地先运行 `node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/generation/preflight.mjs" images <项目目录> <图片批量 JSON>`。
