# 源时间线驱动的情感配音与字幕设计

## 1. 背景与目标

当前声音流程已经具备原生音频优先、第三方 TTS、外部音频、旁白表演合同、口型同步和字幕来源绑定，但第三方配音仍存在三个结构性缺口：普通对白没有强制表演合同；TTS 生成前没有读取原视频中对应台词的真实时间线；字幕只绑定实际音轨，没有绑定具体配音行和最终词级时间戳。结果可能出现台词能听清但情绪平直、语音长度与画面不符、字幕和嘴部动作错位。

本期目标是把第三方配音从“按文本生成音频”升级为“按源时间线和源表演生成可验证的逐句候选”：

- 原视频、原配或已批准人工配音的实际时间线是首要时间证据；
- 所有可听台词都必须有可执行的情感与表演合同，不再只约束旁白；
- Provider 参数由统一合同编译，不能把某家模型参数直接写进业务文档；
- 配音生成后按实际波形和词级时间戳重新验收，不能以请求参数代替结果；
- 字幕只从最终 selected 音频的真实词级时间线派生；
- 配音版本变化会使字幕、口型和相关时间线自动失效。

非目标：本期不训练声音模型，不承诺自动识别所有细腻情绪，不允许模仿未授权真人，也不通过大幅变速或裁断语音来制造表面对齐。

## 2. 核心原则

1. **来源优先**：存在可用原声时，以 selected 视频及其音轨为时间和表演证据；不存在可用原声时，必须由导演本和镜头时间线提供人工计划区间，不按字数平均猜测。
2. **成品优先于参数**：请求中包含 `emotion` 或 `instruction` 不代表情感合格，最终音频必须实际复听和测量。
3. **自然表演优先**：先调整停连、语速和 Provider 表演指令；仍无法适配时允许等义精简，但必须保留剧情事实、称谓、态度和关键情绪转折。
4. **不可变证据**：时间线分析、配音合同、候选音频、对齐报告、审核和字幕都绑定资产版本与 SHA-256。
5. **失败关闭**：缺时间证据、低置信 ASR 未复核、表演合同缺项、时长误差超限或情感审核失败时不得选版。

## 3. 方案选择

采用“源音轨驱动的逐句配音合同”，辅以极小幅度的确定性节奏修正。

不采用只增加 `speed/emotion` 参数的做法，因为它无法证明最终结果对齐；不采用生成后统一拉伸音频的做法，因为大幅拉伸会破坏音色、情绪和自然度。确定性节奏修正仅用于最终残差，不得替代重新生成或文本适配。

## 4. 数据流

```text
selected 视频/原配音频
  → 提取音轨并校验 SHA-256
  → ASR + 词级强制对齐 + 人工复核
  → 源表演与停连分析
  → dubbing-contract/vNNN
  → Provider 参数编译与付费预检
  → TTS 候选
  → 实际音频探测 + 词级强制对齐
  → 时长适配 / 有限重试 / 等义精简
  → 八维情感配音审核并选版
  → 从 selected 配音生成字幕时间线
  → 可见对白按同一区间执行口型
  → 剪辑时间线
```

原生对白审核合格时不重复 TTS；其字幕仍从 selected 原生音轨的实际对齐结果派生。第三方配音只用于 `post_dub`、`external_audio` 或有受控失败证据的原生声区间。

## 5. 时间证据

### 5.1 `speech-timing` 文档

每个被分析的音轨生成版本化 `speech-timing` 文档：

```json
{
  "episode_key": "ep-001",
  "source_asset": { "asset_key": "shot-ep001-001", "version_id": "v002", "sha256": "..." },
  "method": "asr-forced-alignment",
  "reviewed": true,
  "language": "zh-CN",
  "lines": [
    {
      "line_index": 1,
      "speaker": "林晚",
      "text": "别回头",
      "start_ms": 1240,
      "end_ms": 2080,
      "words": [
        { "text": "别", "start_ms": 1240, "end_ms": 1460, "confidence": 0.98 },
        { "text": "回头", "start_ms": 1530, "end_ms": 2080, "confidence": 0.97 }
      ],
      "pauses": [{ "start_ms": 1460, "end_ms": 1530 }],
      "review_evidence": {
        "speaker_checked": true,
        "text_checked": true,
        "visible_mouth_checked": true,
        "notes": "逐帧核对说话人、逐字文本和可见嘴部"
      },
      "confidence": 0.97
    }
  ]
}
```

`method` 只允许 `asr-forced-alignment` 或 `manual-direction`。所有时间为相对源资产起点的整数毫秒。每行严格包含 `speaker`、`text`、`start_ms/end_ms`、`words`、`pauses` 与 `review_evidence`；行区间不得重叠，词和停顿必须按序位于行区间内，非空词级文本必须与行文本一致。未复核候选的三项核对状态必须为 `false`；`reviewed:true` 前必须把说话人、逐字文本和可见嘴部三项都核对为 `true` 并填写说明。ASR 行置信度低于 `0.90`，或任一词置信度低于 `0.80` 时进入 `unresolved`，不能自动成为配音时间证据；人工校正文本、说话人和词级边界后可以通过 `review_speech_timing` 形成新的已复核版本，不能只翻转原候选的 `reviewed`。

没有原声时，`method=manual-direction`，来源改为已选导演本、制作计划和镜头版本。人工计划仍必须给出行区间、停顿位置和证据说明；`words` 在生成前可以为空，但不得伪造成 ASR 结果。

### 5.2 时间权威顺序

1. selected 视频中的已复核原声对齐；
2. selected 的已授权外部/人工配音对齐；
3. 已批准导演本与制作计划中的人工区间；
4. 没有以上证据时阻塞。

剧本文字和字数估算不能单独决定时间范围。

## 6. 逐句配音合同

`audio-plan.lines[]` 对所有可听文本新增 `dubbing_contract`，并以 `mode` 形成可判别联合：

- `native-preserve`：只用于保留已审核原声，必须包含 `mode`、`timing_source`、`target_range` 和 `performance_reference`，禁止包含 Provider、适配文本或生成策略；
- `generated`：用于 `post_dub`、需要适配的 `external_audio` 和原生声兜底，必须包含下列完整合同。合同中未声明的字段一律拒绝，避免不同执行器静默解释同一行。

```json
{
  "mode": "generated",
  "timing_source": {
    "episode_key": "ep-001",
    "version_id": "v001",
    "line_index": 1,
    "source_asset": { "asset_key": "shot-ep001-001", "version_id": "v002", "sha256": "..." }
  },
  "target_range": { "start_ms": 1240, "end_ms": 2080 },
  "target_speech_ms": 770,
  "original_text": "别回头",
  "adapted_text": "别回头",
  "adaptation": null,
  "performance": {
    "intent": "阻止对方看见身后的危险",
    "subtext": "她害怕，但不能让对方察觉",
    "emotion_arc": [
      { "at": 0, "emotion": "克制警觉", "intensity": 0.45 },
      { "at": 1, "emotion": "压低的急迫", "intensity": 0.72 }
    ],
    "pace": "短促但不抢字",
    "emphasis": ["别"],
    "pause_plan": [{ "after": "别", "duration_ms": 70 }],
    "breath": "起句前轻吸气，句尾不泄气",
    "distance_and_space": "近距离低声"
  },
  "fit_policy": {
    "max_paid_generations": 3,
    "provider_speed_min": 0.85,
    "provider_speed_max": 1.15,
    "max_post_tempo_percent": 3,
    "text_adaptation_allowed": true
  }
}
```

`native-preserve.performance_reference` 指向同一 `speech-timing` 版本对应的源表演分析，至少记录意图、潜台词、情绪弧、重音、停连和呼吸；它用于字幕、审核和后续重配参考，不触发声音生成。源表演是角色与导演意图的证据，不授权模仿真人声纹；生成合同必须使用项目已授权的 `voice_id`。

`emotion_arc.at` 使用 0–1 的归一化行内位置，强度为 0–1。普通对白和旁白共享上述基础表演字段；旁白继续要求既有 `tone_arc`、`emotion_beats`、`breath_and_pause` 等电影感合同，并编译为同一执行模型，不能降低原门禁。

等义修改时 `adapted_text` 与 `original_text` 不同，`adaptation` 必须包含 `reason`、`preserved_facts[]`、`preserved_attitude` 和 `approved_by:"codex"`。不得改人物关系、否定词、数字、专名、剧情因果和关键情绪转折。

## 7. Provider 参数编译

新增独立的 `dubbing-compiler`，输入统一配音合同和目标 Provider 能力，输出 Provider 请求参数及不可满足项：

- CosyVoice：编译 `speed`、`instruction`、`language_hints`，instruction 同时包含意图、情绪转折、重音和停连，仍受 100 个中文加权字符限制。
- MiniMax `speech-2.8-*`：底层适配器虽然支持 `voice_setting.speed/emotion`、`pronunciation_dict` 和 `voice_modify`，但当前已验证接口不能完整表达意图、潜台词、情绪强度、重音、停连、呼吸和空间关系。完整逐句表演合同必须返回明确能力缺口，不得把单一情绪枚举伪装成完整情绪弧支持。
- OpenAI 兼容 TTS：只有模型能力矩阵明确验证支持 `instructions` 时才编译 `instructions` 与 `speed`。当前登记的 `tts-1` 不支持 `instructions`，因此完整逐句表演合同必须以 `style-instruction` 能力缺口失败关闭。
- RunningHub 用户工作流：只注入用户映射中明确声明的字段，不猜节点。

当前只有 CosyVoice 指令模型，以及显式映射 `text/speed/instruction` 且由用户验证能消费完整指令的 RunningHub 工作流，可以通过完整逐句表演合同预检。MiniMax 与 `tts-1` 仍可用于不走本期完整表演合同的既有普通语音能力，但不得由配音编译器降级调用。高情绪或多转折台词遇到不支持风格指令的 Provider 时，预检直接返回能力不匹配；不能依赖随机重试。请求快照保存合同版本、编译结果、不可满足项、目标时长和文本版本。

## 8. 时长适配状态机

每句最多三轮付费生成，且每轮都产生不可变候选：

1. **原文生成**：使用校准后的初始速度和完整表演指令。
2. **参数重生**：根据实际发声时长调整自然范围内的语速、停顿和指令；Provider 速度限制在合同的 `0.85–1.15`，不能使用接口允许的极端边界。
3. **等义适配重生**：前两轮仍无法适配时，生成等义精简文本并完整留痕。

生成后对实际音频重新执行词级强制对齐。`actual_start` 和 `actual_end` 指最终音频内词级对齐得到的实际发声边界；音频文件可以通过合同内静音补齐到完整 `target_range`，但不能用文件容器时长冒充发声对齐。最终处理只允许：

- 在合同声明的停顿区补静音；
- 对完整发声段做不超过 `±3%` 的保持音高 tempo 修正；
- 不裁断词首、词尾、呼吸和情绪收束；
- 不移动超出镜头或覆盖相邻对白。

可见对白的最终区间误差不得超过时间线的一帧：

```text
tolerance_ms = ceil(1000 / timeline_fps)
abs(actual_start - target_start) <= tolerance_ms
abs(actual_end - target_end) <= tolerance_ms
```

比较前必须先把音频内相对时间换算到剧集时间线；字幕阅读余量不参与上述发声边界误差计算。

画外音和旁白可以在无冲突且导演合同允许时扩展区间，但扩展必须形成新合同版本，不能静默修改。三轮仍失败则保留候选并阻塞，不自动追加第四次付费调用。

## 9. 情感配音审核

新增 `dubbing-performance` 专项审核，必须完整试听并逐项记录：

1. `semantic_integrity`：逐字或等义文本保留剧情事实；
2. `speaker_identity`：声纹、年龄感、性别和角色绑定正确；
3. `emotion_arc`：情绪起点、转折、峰值和收束实际可听；
4. `intensity_and_subtext`：强度、行动目的和潜台词成立；
5. `emphasis_pause_breath`：重音、停连和呼吸落在合同位置；
6. `timing_fit`：实际词级时间线满足目标窗口；
7. `picture_interaction`：与嘴部、动作、反应和对手接话同步；
8. `technical_audio`：无爆音、吞字、尾音截断、不自然变速和响度问题。

八项不可互相补偿。情绪平直、重音错误、机械加速、截断词尾、时间越界或声纹漂移均为 P1；存在 P0/P1 时不得 selected。声学指标和 ASR 只能辅助，不能替代人工复听。

## 10. 字幕绑定

最终 selected 配音完成所有重生、tempo、静音和混音后，重新生成 `speech-timing`。字幕由这一最终文档创建：

```json
{
  "text": "别回头",
  "startMs": 1210,
  "endMs": 2150,
  "timestampMs": 1240,
  "confidence": 0.98,
  "speaker": "林晚",
  "audio_binding": {
    "asset_key": "audio-ep001-line-001",
    "version_id": "v003",
    "sha256": "...",
    "line_index": 1,
    "speech_timing_version": "v002"
  }
}
```

字幕正文区间按最终真实发声位置向前后留 2–4 帧阅读余量，但不能越过台词合同窗口、相邻字幕或成片边界。连续对白按实际说话人切换；禁止按字数平均分段。`subtitle_source` 必须指向同一 selected 音频和最终 `speech-timing`，脚本、原视频旧音轨或另一版配音不能冒充。

## 11. 口型与剪辑

对口型请求必须同时绑定：

- 当前 selected 视频；
- 当前 selected 配音；
- 同一 audio-plan 行和 dubbing-contract 版本；
- 最终 speech-timing 版本；
- 与合同完全一致的目标区间。

口型完成后继续执行既有专项审核。时间线中的对白音轨、字幕和 `dialogue_sync=lip-synced` 必须指向同一音频版本；任何一项版本不一致都拒绝保存。

## 12. 失效传播

以下变化会使派生字幕、口型候选和引用该行的剪辑候选 stale：

- 源视频或源音轨 selected 版本变化；
- speech-timing 内容、复核状态或来源 SHA 变化；
- dubbing-contract 版本变化；
- original/adapted text、Provider、voice_id 或表演合同变化；
- 配音重新生成、tempo 修正或重新选版。

失效传播沿资产 provenance 和文档绑定执行，不通过文件名猜测。恢复旧版本时必须重新验证所有哈希和精确合同版本。

## 13. 旧项目迁移

- 旧 audio-plan 继续可读，不覆盖原文件。
- `native` 且保留原声的行在生成字幕前必须补建实际 speech-timing。
- `post_dub` 或 `external_audio` 缺少 dubbing-contract 时进入 `unresolved`；补齐前禁止新 TTS、口型和正式字幕。
- 旧旁白 performance 可迁移到新合同，但仍需补时间证据、意图、潜台词、重音与最终对齐。
- 不从剧本文字、旧字幕或文件时长反推伪造词级时间戳。

## 14. 接口边界

新增或扩展的原子接口：

- `analyze_speech_timing`：从 selected 视频/音频生成未复核的 speech-timing 候选；
- `review_speech_timing`：人工复核并选择 timing 版本；
- `compile_dubbing_request`：只读预检统一合同到 Provider 参数；
- `generate_audio` / `generate_audio_fallback`：强制绑定合同和 timing；
- `review_dubbing_performance`：保存八维审核并原子选择音频候选；
- `build_subtitles_from_audio`：从 selected 音频和最终 timing 生成字幕候选。

分析工具不得产生付费任务；付费生成继续遵守确认和自动化模式。所有工具都只能读取项目内 selected、未失效的资产版本。

## 15. 错误处理

- ASR 失败或置信度低：保存候选和未决项，等待人工转写，不生成配音。
- 说话人不唯一：阻塞该行，不根据脸的位置猜测。
- Provider 不支持表演合同：预检失败，建议具备相应能力的 Provider。
- 时长不符：按三轮状态机处理，禁止无限重试。
- 等义精简无法保留事实：失败，不修改原文。
- 最终对齐失败：候选不 selected，字幕和口型不执行。
- 情感审核失败：保留候选和问题，回到合同或 Provider 选择阶段。
- 下游已有成片：上游变化只标记 stale，不覆盖或删除既有文件。

## 16. 验收与测试

### 16.1 合同测试

- 有原声的 post-dub 行缺 timing_source、target_range 或完整 performance 时拒绝；
- 普通对白情感合同缺意图、潜台词、情绪弧、重音、停顿或呼吸时拒绝；
- 原始和适配文本不同但缺 adaptation 留痕时拒绝；
- 低置信且未复核的 speech-timing 不能批准。

### 16.2 Provider 编译测试

- CosyVoice 与完整 RunningHub 映射准确承载合同支持的字段；MiniMax 和当前 `tts-1` 对完整表演合同明确失败关闭；
- 不支持的情绪弧产生明确能力缺口；
- Provider 极端速度即使接口允许也被业务合同拒绝；
- 请求快照保存合同版本、目标时长和适配文本。

### 16.3 时长与情感测试

- 三轮状态机按原文、参数重生、等义适配顺序推进；
- 第三轮后停止，不静默付费重提；
- tempo 修正超过 3%、裁断词尾或跨越相邻对白时拒绝；
- 可见对白超过一帧误差时拒绝；
- 八维任一失败或存在 P0/P1 时不得 selected。

### 16.4 字幕与失效测试

- 字幕时间来自最终 selected 配音的词级时间线；
- 字幕绑定的音频 SHA、line_index 和 timing 版本必须一致；
- 配音重生或重新选版使字幕、口型和剪辑候选 stale；
- 原生对白字幕绑定实际原声音轨，不绑定剧本文档。

### 16.5 端到端验收

临时项目串联：原视频音轨 → speech-timing → 配音合同 → Provider 编译 → 模拟 TTS 候选 → 实际词级对齐 → 八维审核 → 字幕 → 口型门禁 → 失效传播。另用一个真实镜头完成三方配音 A/B：与原声逐句比较情绪、时长、字幕和口型，完整复听通过后才能宣布能力完成。

## 17. 完成标准

以下条件全部成立才算完成：

1. 普通对白和旁白都由有来源的时间与表演合同驱动；
2. 三方 TTS 请求可追溯到原视频、具体台词行和合同版本；
3. 最终配音在一帧容差内对齐，且通过八维人工复听；
4. 字幕绑定最终 selected 音频的实际词级时间线；
5. 配音变化可正确使字幕、口型和剪辑候选失效；
6. 旧项目不会被静默伪造时间或表演证据；
7. 单元、集成、插件审计和真实镜头 A/B 全部通过。
