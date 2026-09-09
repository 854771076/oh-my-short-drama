---
name: generate-drama-videos
description: 通过用户选择的生成 Provider 提交并查询短剧视频镜头。用于 StarRouter、RunningHub 等视频生成、并发控制和单镜恢复。
---

# 生成短剧视频

每镜提交前确认 Provider、模型或工作流 ID、已选 `video-prompts` 版本、prompt_profile、input_mode、本地参考素材版本与提交顺序、提示词、时长、分辨率、画幅、声音策略和费用。Seedance 2.0 的 `@图片N/@视频N/@音频N` 必须与提交数组同序；H3 输入模式和六段合同必须与工作流一致。调用 `submit_video` 时传 `project_root`、目标视频资产 key 和 `{episode_key,version_id,shot_number}` 提示词文档引用；MCP 会在提交前保存完整请求快照并自动绑定 `task_id`。同一目标与输入指纹存在在途任务时禁止重复提交。

H3 `audio_policy.mode=native` 时，声音随视频一次生成，不再提交外部 TTS；必须核对逐秒对白、音乐锚点和相邻镜声音转场。只有制作计划明确为 post-dub/independent 时才调用独立音频 Skill。

用 `get_generation_task` 携带 `media_type: video` 滚动查询，默认同类并发 4、总并发 16。对统一返回的每个 `outputs[]` 结果立即用 `asset-ledger.mjs fetch|decode` 下载到 `assets/videos/`，同时写入 Provider、模型、任务、`video-prompts@v001`、镜号、参考资产和参数 provenance，登记哈希并选版，再交给 `review-drama-shots`。单镜失败不阻塞无依赖镜头；权限、余额、审核、schema 或模型能力错误不自动重试、换模型或换 Provider。

RunningHub 内置 `minimax-h3-reference-to-video` 接受本地图片 0–9、视频 0–2、音频 0–2，适配器自动上传并注入专用 workflow；无需 `node_info_list`。Comfly `minimax-h3` 固定使用 Ref2VA，接受 1–3 张公开 HTTPS 参考图片或 1 段公开视频，二者互斥且不支持参考音频。两者都必须使用 H3 提示词合同。

## StarRouter 模型与枚举

- 2.0：`dreamina-seedance-2-0-fast-260128`、`dreamina-seedance-2-0-260128`、`doubao-seedance-2-0-260128`、`doubao-seedance-2-0-fast-260128`。
- 1.x：`doubao-seedance-1-5-pro-251215`、`doubao-seedance-1-0-pro-250528`、`doubao-seedance-1-0-pro-fast-251015`。
- MiniMax：`MiniMax-H3`、`MiniMax-H3-Max`。
- 2.0 固定参数：`prompt_profile=seedance2`；`input_mode ∈ {first-last-frame,full-reference}`；`duration ∈ {4,5,6,7,8,9,10,11,12,13,14,15}`；`resolution ∈ {480p,720p,1080p}`；`ratio ∈ {16:9,9:16,1:1,4:3,3:4}`；`fps=24`；`generate_audio ∈ {true,false}`；`watermark ∈ {true,false}`。
- 多模态全参考只允许适配器登记的 Dreamina 2.0 模型：图片最多 9、视频最多 3、音频最多 3、总数最多 12。1.x 使用 `prompt_profile=generic`，禁止视频/音频多模态引用；其时长、分辨率和画幅组合必须先以远端模型目录或真实探测确认，不从 2.0 推断。
- MiniMax 固定 `prompt_profile=h3`，`input_mode ∈ {T2VA,I2VA,FL2VA,L2VA,Ref2VA}`，`ratio ∈ {21:9,16:9,4:3,1:1,3:4,9:16}`。`MiniMax-H3` 支持 `size ∈ {768P,2K}`、4–15 秒和参考图/视频/音频；`MiniMax-H3-Max` 支持 `size ∈ {480P,768P}`、5–15 秒，但不支持参考素材与 Ref2VA。首尾帧使用 `first_frame/last_frame`，参考素材使用 `reference_image/reference_video/reference_audio`，两类模式互斥。
