---
name: design-drama-audio
description: 设计并在本地管理短剧声音资产。用于角色声音分析与推荐、音色设计、声音克隆、TTS、逐句语音、说话人绑定和口型同步。
---

# 制作短剧声音

只处理制作计划标记为 post-dub/independent 的镜头，或 Provider 明确不支持原生音频的模型。`audio_strategy.mode=native` 的 MiniMax H3 镜头由视频模型一次生成声音，本 Skill 不重复安排 TTS。

独立音频依次执行：由 Codex 使用 `assets/prompts/voice_analysis.{zh,en}.txt` 分离说话人和台词。Provider 返回受控标签时使用 `character_voice_recommend`；Provider 接受自然语言音色描述时使用 `character_voice_description`。设计或克隆得到真实音色 ID 后，把台词、来源版本、音色绑定、未决项和批准状态保存为 `episodes/<ep>/audio-plan/vNNN.json` 并显式选版，再按逐字文本生成语音。克隆前确认参考音频权利与具体文件，目标模型必须接受该音色 ID。逐条试听语言、说话者、文本、读音、语速、音高、时长、静音与破音，选版后才允许口型同步。

音频通过 `drama-generation-service` 交给用户确认的 Provider。逐句调用传 `{kind:"audio-plan",episode_key,version_id,line_index}`；入口会核对当前选版、批准状态、逐字台词以及角色—Provider—模型—voice 绑定。StarRouter 可使用 `speech-2.8-hd`、`speech-2.8-turbo`、Qwen3 TTS、PawSense 或 `tts-1` 同步生成，必须提供已确认的台词、模型对应 voice、语速和输出格式；RunningHub 可使用用户音频工作流。每条结果必须解码、复制或下载到本地 `assets/audio/` 后登记选版并保存同一行引用和输入指纹，失败只重做受影响语句。

OP、ED、BGM 或音乐短视频配乐写入可选 `music_tracks`，每项包含 `key`、`purpose`、`title`、`prompt`、`tags`、`lyrics`、`make_instrumental`、`provider`、`model`、`matched_shots`。StarRouter `suno_music` 调用 `generate_music` 并传 `{kind:"audio-plan",episode_key,version_id,track_key}`；结果仍保存为 `assets/audio/` 音频资产。

所有已批准且互不依赖的语音行与音乐轨必须全量并发调用 `generate_audio`、`generate_music`，不设本地并发上限，由上游网关排队；每项继续使用独立目标、请求快照和任务记录，单项失败不取消同批其他音频。

同一角色在当前时空、未来来电、录音回放等状态下必须绑定同一个基础 `voice_id` 或同一条已批准声纹；状态差异只通过后期电话窄带、压缩、轻微失真、空间混响和音量自动化表达，禁止为“未来版本”另随机一个音色。原生视频音频若无法锁定声纹，制作计划必须将关键对白改为 post-dub，或在逐镜验收中明确标记声纹不一致；不得把不同声纹仅靠字幕标注为同一人物。

## StarRouter MiniMax 参数枚举

- 模型：`speech-2.8-hd`、`speech-2.8-turbo`、`qwen3-tts-vc-realtime-2025-11-27`、`qwen3-tts-vc-realtime`、`pawsense-audio`、`tts-1`；`voice` 使用所选模型支持且经用户确认的声音 ID。
- 基础：`speed=0.5..2`；`response_format ∈ {mp3,pcm,flac}`；同步模式固定 `metadata.stream=false`；`metadata.output_format ∈ {hex,url}`。
- `metadata.voice_setting`：`speed=0.5..2`、`vol=(0,10]`、`pitch=-12..12`、`text_normalization ∈ {true,false}`、`latex_read ∈ {true,false}`。`emotion` 常用已验证值为 `happy,sad,angry,fearful,disgusted,surprised,calm,fluent,whisper`；适配器接受非空字符串，新增值以 StarRouter/MiniMax 当前文档为准。
- `metadata.audio_setting`：`sample_rate ∈ {8000,16000,22050,24000,32000,44100}`；`bitrate ∈ {32000,64000,128000,256000}`；`format ∈ {mp3,pcm,flac}`；`channel ∈ {1,2}`；`force_cbr ∈ {true,false}`。
- `metadata.voice_modify`：`pitch/intensity/timbre=-100..100`；`sound_effects` 使用 MiniMax 当前枚举，不猜测未在 StarRouter 文档中列出的值。
- `metadata.language_boost` 常用已验证值包括 `Chinese`、`Chinese,Yue`、`English`、`Japanese`、`Korean` 和 `auto`；适配器接受非空字符串，完整枚举及新增语言以 StarRouter/MiniMax 当前文档为准，不能把这组常用值当作封闭枚举。

`pronunciation_dict.tone` 是字符串数组，`timbre_weights` 是 `{voice_id,weight}` 数组；`subtitle_enable`、`aigc_watermark` 为布尔值。StarRouter 当前未声明 `subtitle_type` 转换，因此不提交该字段。
