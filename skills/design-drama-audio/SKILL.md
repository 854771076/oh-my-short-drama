---
name: design-drama-audio
description: 设计并在本地管理短剧声音资产。用于角色声音分析与推荐、音色设计、声音克隆、TTS、逐句语音、说话人绑定和口型同步。
---

# 制作短剧声音

`viral-recreation` 项目必须读取当前分集编译约束包，按 Speech、Caption 和参考限制设计配音、音乐与对齐策略，并在 `source_versions.recreation_workflow` 绑定当前 selected 版本；未获声音或音乐授权时不得复用原片身份特征或曲目。

新声音计划默认 `audio_strategy.mode=native-first`：先选择同时满足画面资产约束与原生音频能力的视频 Provider，一次生成对白、电影感旁白、环境声和动作声；背景音在这里仅指环境声与动作声，BGM 始终走独立配乐与许可证流程。只有 Provider 不支持原生音频，或原生结果出现受控失败证据时才安排局部兜底，本 Skill 不对合格原声重复执行 TTS。

每条声音把三类语义分开保存：`delivery_mode ∈ native|post_dub|external_audio` 表示来源，`presentation ∈ visible-dialogue|offscreen-dialogue|narration` 表示画面关系，`fallback_mode ∈ none|post-dub|cinematic-tts|sound-design` 表示失败预案。兜底 reason 只能是 `provider-no-native-audio`、`voice-identity-drift`、`speech-intelligibility-failed`、`narration-performance-failed`、`audio-sync-failed`、`native-ambience-failed`，并记录证据、精确替换区间与最终混音来源。旧 `narration/offscreen` 只迁移 presentation，来源进入 unresolved，不能冒充已经完成配音。

所有对白与旁白都必须先从当前 selected 原声资产建立不可变 `speech-timing`，ASR 行级置信度至少 `0.90`、词级至少 `0.80`，低于阈值必须留下人工校正证据；禁止根据文字或文件名补造词级时间。随后才写 `dubbing_contract`，普通对白同样必须明确意图、潜台词、情绪弧、强弱、重音、停连和呼吸，不能只给“紧张”“自然”等单标签。生成最多三轮：原文、参数重生、经批准的等义适配；每轮使用当前 timing 和合同编译，第四次付费动作必须阻断。最终只允许不超过 `±3%` 的确定性 tempo 修正和合同声明停顿，并用最终词级 alignment 重新验收。

候选生成后必须完整听看并做八维审核：语义完整、说话人身份、情绪弧、强度与潜台词、重音停连呼吸、时间拟合、画面互动、技术音频。任一维失败或出现 P0/P1 都不得选版。换选配音会使旧字幕、口型及其派生镜头失效，必须从新 selected 音频重新构建。

旁白不论原生还是兜底都必须有电影感表演合同：逐项写 `tone_arc`、`emotion_beats[]`、`pace`、`breath_and_pause`、`distance_and_space`。旁白兜底使用独立 narrator 音色；除非剧本明确角色兼任叙述者，不得复用角色 voice_id。

原生七维审核失败后先调用 `generate_audio_fallback` 且以 `confirmed=false` 预检，只允许审核报告实际失败的 reason 与毫秒区间。角色对白绑定 `voice_role:character`；旁白绑定 `voice_role:narrator`，其 `cinematic_profile` 必须逐字段等于 audio-plan 的表演合同。用户确认费用后才以 `confirmed=true` 生成；输出 provenance 必须保存 `native_audio_exception`、来源视频版本、`replaced_ranges` 和 `mix_sources`。只替换失败区间，合格的原生环境声和动作声继续保留，不得整轨覆盖。

每个原生声视频必须先由 ASR 辅助、再由人工完整观看和复听，逐项填写七维报告：`speech_intelligibility`（台词可懂度）、`speaker_identity`（声纹身份）、`narration_performance`（旁白电影感表演）、`ambience_action_sync`（环境/动作同步）、`lip_sync`（可见对白口型）、`technical_audio`（底噪、爆音、声道与响度）和 `undeclared_music`（未声明或重复音乐）。七项全部通过才能保留原声；文件存在、波形正常或 ASR 文本大致正确都不能替代其余人工维度。

用户提供录音时调用 `import_external_audio`，要求 `rights_confirmed:true`、明确 `usage_scope` 和真实可解码音频流；常见非账本格式先确定性规范化为 WAV。导入只建立不可变候选，不自动 selected，试听、台词一致性、响度和权利记录都通过后再选版。不得抓取普通视频网站音轨或把扩展名伪装成音频。

独立音频依次执行：由 Codex 使用 `assets/prompts/voice_analysis.{zh,en}.txt` 分离说话人和台词。Provider 返回受控标签时使用 `character_voice_recommend`；Provider 接受自然语言音色描述时使用 `character_voice_description`。自然语言声音描述必须先通过 `validateVoiceDescription`：不超过 50 个中文加权字符，明确性别和年龄段，只含 2–4 个有人物档案证据的长期声音特征；禁止人物名、地名、剧情、台词、真人模仿与“声音描述：”前缀，禁止补造地域、阶层和受保护身份刻板印象。配音默认推荐阿里云百炼：先调用 `design_voice`（声音描述）或 `clone_voice`（已授权参考音频；必须传 usage_scope 与三项权利确认）取得真实音色 ID，本地登记可通过 `list_voices` 跨集查看、`delete_voice` 收敛；设计或克隆得到真实音色 ID 后，把台词、来源版本、音色绑定、未决项和批准状态保存为 `episodes/<ep>/audio-plan/vNNN.json` 并显式选版，再按逐字文本生成语音。克隆前确认参考音频权利与具体文件，目标模型必须接受该音色 ID。逐条试听语言、说话者、文本、读音、语速、音高、时长、静音与破音，选版后才允许口型同步。

音频通过 `drama-generation-service` 交给用户确认的 Provider。百炼路径使用 `generate_audio`（provider=bailian，model 与 audio-plan 绑定一致），推荐 `cosyvoice-v3.5-plus`；voice 必须传 `design_voice`/`clone_voice` 返回的自定义音色 ID，v3.5-plus/flash 拒绝预置音色；instruction 仅 v3.5-plus/flash 与 v3-flash 接受（加权长度 ≤100），语言 hint 必须在目标模型矩阵内；长文本自动按标点分段并合并为 wav（选 mp3/pcm/opus 时按帧流拼接），逐句结果仍登记到 `assets/audio/`。逐句调用传 `{kind:"audio-plan",episode_key,version_id,line_index}`；入口会核对当前选版、批准状态、逐字台词以及角色—Provider—模型—voice 绑定。StarRouter 的 `speech-2.8-*`、Qwen3 TTS、PawSense 与 `tts-1` 仍可承担既有普通语音，但当前已验证能力不能满足本期完整逐句表演合同：MiniMax 不能用单一情绪枚举替代完整导演指令，`tts-1` 不支持 `instructions`，二者必须在配音编译预检失败关闭。完整合同当前只走支持指令的 CosyVoice，或明确映射并验证 `text/speed/instruction` 的 RunningHub 用户工作流。每条结果必须解码、复制或下载到本地 `assets/audio/` 后登记选版并保存同一行引用和输入指纹，失败只重做受影响语句。

OP、ED、BGM 或音乐短视频配乐写入可选 `music_tracks`。生成配乐设 `source_mode=generated`，保留 `prompt`、`tags`、`lyrics`、`make_instrumental`、`provider`、`model` 与 `matched_shots`；StarRouter `suno_music` 走 `music.generate` 能力并调用 `generate_music`。曲库配乐设 `source_mode=catalog`，只保存 `source_asset`、`license_receipt`、`intended_use` 和 `matched_shots`，不得再调用生成接口。按剧情功能、节奏、对白密度和时长调用 `search_music_catalog`，用户在官方页面试听、下载并核对当次许可证后，才用 `register_licensed_music` 登记真实音频与不可变收据。详细站点边界见 [授权音乐目录](../../references/music-catalog-providers.md)。

所有已批准且互不依赖的语音行与音乐轨必须全量提交 `generate_audio`、`generate_music`；RunningHub 同一 API Key 最多 2 路并发，其余请求由适配器排队，其他 Provider 由上游网关排队；每项继续使用独立目标、请求快照和任务记录，单项失败不取消同批其他音频。

同一角色在当前时空、未来来电、录音回放等状态下必须绑定同一个基础 `voice_id` 或同一条已批准声纹；状态差异只通过后期电话窄带、压缩、轻微失真、空间混响和音量自动化表达，禁止为“未来版本”另随机一个音色。原生视频音频若无法锁定声纹，制作计划必须将关键对白改为 post-dub，或在逐镜验收中明确标记声纹不一致；不得把不同声纹仅靠字幕标注为同一人物。

对口型不是每条独立配音的默认步骤。仅 `presentation=visible-dialogue` 且 `delivery_mode=post_dub|external_audio` 的精确台词区间可调用 `submit_media_operation(operation="lip-sync")`；参数必须绑定当前 selected audio-plan 行、同一镜头的 selected 视频、该行 selected 音频和 `face_selector.mode=single-visible-face`。旁白、画外音、审核合格的原生对白和多人脸归属不唯一的镜头禁止执行。可选本地 MuseTalk 通过 `MUSETALK_ROOT` 配置，能力名为 `transform.lip-sync`；插件不安装依赖、不下载权重。输出只是未选候选，完成口型专项审核后才能 selected 和进入时间线。

## StarRouter MiniMax 参数枚举

- 模型：`speech-2.8-hd`、`speech-2.8-turbo`、`qwen3-tts-vc-realtime-2025-11-27`、`qwen3-tts-vc-realtime`、`pawsense-audio`、`tts-1`；`voice` 使用所选模型支持且经用户确认的声音 ID。
- 基础：`speed=0.5..2`；`response_format ∈ {mp3,pcm,flac}`；同步模式固定 `metadata.stream=false`；`metadata.output_format ∈ {hex,url}`。
- `metadata.voice_setting`：`speed=0.5..2`、`vol=(0,10]`、`pitch=-12..12`、`text_normalization ∈ {true,false}`、`latex_read ∈ {true,false}`。`emotion` 常用已验证值为 `happy,sad,angry,fearful,disgusted,surprised,calm,fluent,whisper`；适配器接受非空字符串，新增值以 StarRouter/MiniMax 当前文档为准。
- `metadata.audio_setting`：`sample_rate ∈ {8000,16000,22050,24000,32000,44100}`；`bitrate ∈ {32000,64000,128000,256000}`；`format ∈ {mp3,pcm,flac}`；`channel ∈ {1,2}`；`force_cbr ∈ {true,false}`。
- `metadata.voice_modify`：`pitch/intensity/timbre=-100..100`；`sound_effects` 使用 MiniMax 当前枚举，不猜测未在 StarRouter 文档中列出的值。
- `metadata.language_boost` 常用已验证值包括 `Chinese`、`Chinese,Yue`、`English`、`Japanese`、`Korean` 和 `auto`；适配器接受非空字符串，完整枚举及新增语言以 StarRouter/MiniMax 当前文档为准，不能把这组常用值当作封闭枚举。

`pronunciation_dict.tone` 是字符串数组，`timbre_weights` 是 `{voice_id,weight}` 数组；`subtitle_enable`、`aigc_watermark` 为布尔值。StarRouter 当前未声明 `subtitle_type` 转换，因此不提交该字段。
