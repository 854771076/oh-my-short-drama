# StarRouter Provider 合同

插件通过独立适配器直接访问 StarRouter，不导入任何业务应用代码：

- 图片：`/v1/images/generations`；有本地参考图时使用 multipart `/v1/images/edits`。支持 `1K/2K/4K + aspect_ratio` 尺寸推导和常用输出参数。
- 视频：Seedance 使用 `/volcengine/doubao/contents/generations/tasks`；MiniMax H3/H3-Max 使用 OpenAI 兼容 `/v1/videos`，并通过 `/v1/videos/{task_id}` 查询。适配器按模型选择协议。
- 语音：同步 `POST /v1/audio/speech`，支持 `speech-2.8-hd`、`speech-2.8-turbo`、Qwen3 TTS、PawSense 与 `tts-1`；通用模型的 `instructions` 和 `metadata` 原样转发，当前 MCP 不缓冲 SSE 流式结果。
- 语音识别：同步 multipart `POST /v1/audio/transcriptions` 或 `/v1/audio/translations`；默认模型为 `qwen3-asr-flash`、`whisper-1`。词级或分段时间戳必须使用 `response_format=verbose_json`，`timestamp_granularities` 只接受 `word|segment` 并按 multipart 同名重复字段发送；未知粒度和其他响应格式在请求前拒绝。
- 音乐：`POST /suno/submit/MUSIC` 提交 `suno_music`，`GET /suno/fetch/{task_id}` 轮询；生成结果作为 audio 资产保存。
- 认证：仅从环境变量 `STARROUTER_API_KEY` 读取 Bearer Token。
- 保底目录：图片 `gpt-image-2`，视频为适配器登记的 Seedance 系列及 `MiniMax-H3`、`MiniMax-H3-Max`，语音和 ASR 为上述模型，音乐为 `suno_music`。可分别用 `STARROUTER_IMAGE_MODELS`、`STARROUTER_VIDEO_MODELS`、`STARROUTER_AUDIO_MODELS`、`STARROUTER_ASR_MODELS`、`STARROUTER_MUSIC_MODELS` 和 `STARROUTER_MULTIMODAL_VIDEO_MODELS` 提供逗号分隔目录；自定义模型仍需补能力合同。

## Suno 音乐合同

`generate_music` 使用项目路由模型 `suno_music` 和非空 `prompt`，可选 `title`、`tags`、`lyrics` 与 `make_instrumental`。StarRouter 当前不读取请求体的 `model`，由 `/MUSIC` 路径映射计费模型；有自定义歌词时把歌词作为上游 `prompt`，音乐方向保存在本地合同且以 `tags` 传给上游。纯音乐不能同时提供歌词。远端 task id 在本地加 `music:` 路由前缀，查询时移除前缀；只提取音乐响应中的音频 URL，避免把封面或 MV 视频误登记为音频。

## MiniMax H3/H3-Max 视频合同

两者固定使用 `prompt_profile=h3`，输入模式枚举为 `T2VA`、`I2VA`、`FL2VA`、`L2VA`、`Ref2VA`，画幅为 `21:9`、`16:9`、`4:3`、`1:1`、`3:4`、`9:16`。`MiniMax-H3` 支持 `768P/2K`、4–15 秒及参考图/视频/音频；`MiniMax-H3-Max` 支持 `480P/768P`、5–15 秒，不接受参考素材或 Ref2VA。

`images` 最多两张，依次是 `first_frame`、`last_frame`；`input_reference` 仅在 `images` 为空时作为首帧。参考内容使用 `metadata.content`，元素类型只能是 `text`、`image_url`、`video_url`、`audio_url`，素材角色只能是 `first_frame`、`last_frame`、`reference_image`、`reference_video`、`reference_audio`。每个请求至少含一个非空 text；首尾帧和参考素材模式不能混用。

`metadata` 仅接受 `model`、`content`、`resolution`、`duration`、`ratio`、`callback_url`；适配器要求 `metadata.model` 与顶层模型一致，回调地址和所有素材必须是公网 HTTPS。公开任务状态 `queued/in_progress/completed/failed` 被统一归一化为 pending/completed/failed，完成地址从响应（包括 `metadata.url`）提取。

## 同步语音合同

`generate_audio` 对 StarRouter 使用 `model`、`input`、`voice`，可选 `instructions`、`speed`、`response_format` 和 `metadata`。`voice` 必须是用户已确认且有权使用的模型声音 ID；`speed` 为 0.5–2；格式支持 `mp3`、`pcm`、`flac`。

`speech-2.8-*` 继续严格校验 MiniMax 的 `voice_setting`、`audio_setting`、`pronunciation_dict`、`timbre_weights`、`language_boost`、`voice_modify`、`subtitle_enable`、`aigc_watermark`、`output_format`、`stream`、`stream_options`。其余 OpenAI 兼容模型原样转发 `instructions` 与 metadata。当前 MCP 返回完整文件，明确拒绝 `stream_format`，避免把 SSE 事件流误登记成音频。

上述字段透传能力不等于完整情感配音合同能力。当前已验证的 MiniMax `speech-2.8-*` 只能表达单一情绪枚举和部分声学参数，不能可靠承载意图、潜台词、情绪强度、重音、停连、呼吸及空间关系；`tts-1` 不支持 `instructions`。因此二者在 `compile_dubbing_request` 中都对完整逐句表演合同失败关闭，不会静默降级。当前可通过该合同的路径仅为支持指令的 CosyVoice，或明确映射并验证 `text/speed/instruction` 的 RunningHub 用户工作流。

`emotion` 与 `language_boost` 按非空字符串透传：Skill 只列已验证常用值，不把上游可能扩展的值固化为封闭枚举；范围错误由 StarRouter/MiniMax 返回。

StarRouter 返回的二进制音频会统一转为 `outputs[0].b64_json` 数据 URI，并保留 `media_type=audio`、Content-Type 和格式。立即用 `asset-ledger.mjs decode` 保存到 `assets/audio/<asset-key>/v001.<ext>`；项目账本只保存生成来源和参数，不保存 Key。

附件同时描述了异步 `/v1/t2a_async_v2`，但其最终产物是 TAR 而非可直接剪辑的音频文件。本插件当前不把 TAR 暴露为音频资产；需要长文本异步合成时，应先增加安全解包、逐文件校验和音频版本登记，再开放该模式。

## 本地资产约束

所有生成工具要求 `confirmed: true`。本地参考文件必须已落入当前项目 `assets/`，插件会在请求前通过真实路径校验，拒绝项目外文件和符号链接逃逸。视频公网参考只接受已授权的 HTTPS 地址；仅当用户另外调用 `publish-drama-references` 并确认第三方公开上传时，插件才会把本地选版图片临时发布到 Litterbox，生成调用本身不会隐式发布。

Seedance 2.0 视频必须同时提交 `prompt_profile=seedance2`、`input_mode`、本地 `prompt_version` 和 `reference_manifest`。清单按图片、视频、音频各自从 1 连续编号，并与 URL 数组及提示词中的 `@图片N/@视频N/@音频N` 同序；适配器在付费请求前校验 4–15 秒目标时长、图片最多 9 个、视频最多 3 个、音频最多 3 个、总参考最多 12 个、音视频参考总时长、用途和真实人物脸部禁用声明。

图片、视频或语音结果统一返回 `outputs[]`；每项包含 `media_type` 以及 `url` 或 `b64_json`。立即用 `asset-ledger.mjs fetch|decode` 下载并登记哈希；远程结果不视为资产，落盘前任务保持未完成。文本资产由 Codex 直接创作，不经过本适配器。

图片生成始终提交 `reference_manifest`；无参考图时为 `[]`，有参考图时必须与 `reference_paths` 等长，并按顺序记录 `type=image`、资产 key、selected 版本和用途。该清单只进入本地请求快照和 provenance，不发送给 StarRouter。

## 扩展规则

`scripts/generation/providers.mjs` 的 `adapters` 是生成 Provider 的唯一注册点。新增 Provider 只实现需要的同名动作并注册，不让短剧阶段 Skill 感知供应商协议。
