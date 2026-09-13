# 百炼（阿里云 DashScope）声音设计/克隆接入设计

日期：2026-09-12
状态：待评审
来源：waoowaoo 产品仓库（`src/lib/providers/bailian/`，Next.js 服务端实现）移植到 oh-my-short-drama 插件的 MCP/Node 脚本体系。

## 1. 目标与范围

把阿里百炼作为**默认、推荐的配音 Provider** 接入插件，提供：

1. 语音合成（TTS）：CosyVoice 全系列 5 个模型 + qwen3-tts-vd，共 6 个音频模型，走现有 `generate_audio` 工具。
2. 声音设计（文本描述生成自定义音色）、声音克隆（参考音频复刻）、音色列表、音色删除四个新 MCP 工具。
3. 项目级本地音色登记，跨集复用。
4. 克隆参考音频由服务端内部自动发布为公网临时 URL（复用 litterbox 托管与收据体系）。
5. 文档把百炼列为配音默认推荐；provider 注册顺序中百炼排第一。

**推荐模型**：`cosyvoice-v3.5-plus`（效果最好，但必须先设计或克隆得到自定义音色 ID；`cosyvoice-v2` 支持预置音色，可零门槛起步）。

### 明确不做（YAGNI）

- 不接百炼 ASR/翻译（StarRouter 已覆盖）。
- 不接音色推荐 LLM 接口（声音描述由 Codex 按 skill 指引直接写）。
- 不做 worker 式异步任务封装：设计/克隆/合成均为同步 HTTP 调用（与现有 StarRouter TTS 一致）。
- 不做删除项目时的云端音色 GC：插件无项目删除链路，提供 `delete_voice` 由用户显式管理。
- 不新增 `publish_reference_audio` MCP 工具：音频发布内嵌在 `clone_voice` 流程中（用户决策）。
- 不静默修改用户 project.json 已确认的 provider；"默认推荐"只通过注册顺序和文档体现。

## 2. 现有架构约束（移植必须遵守）

- Provider adapter 形状见 `scripts/generation/starrouter.mjs`：`{ label, credentialEnv, catalog, capabilities, models(), testConnection(), image/audio/music/transcribe/translate/submitVideo/task }`，在 `scripts/generation/providers.mjs` 的 `adapters` 注册；`providerSetupCatalog()` 自动从 adapter 派生配置目录，`scripts/project-store.mjs` 据此校验 project.json 的 provider/模型/参数——**注册即自动生效，无需改 project-store**。
- MCP 工具在 `scripts/generation/mcp.mjs` 的 `tools` 数组声明 JSON Schema，`call()` 分发。生成类工具（image/audio/music/video）统一过：阶段门禁 `enforceGenerationStage` → project.json 一致性校验 `validateProjectInputs` → 请求快照 `createRequestSnapshot` → 任务账本 `reserveTask/settleReservedTask` → 结果回写 `syncTaskResult`。
- 音频文档绑定校验在 `scripts/document-reference.mjs:64`：audio-plan 的 `voice_bindings` 条目为 `{speaker, provider, model, voice_id}`，`generate_audio` 的 provider/model 必须与绑定一致，传了 `voice` 时还必须等于 `voice_id`，`input` 必须与台词逐字一致。
- 凭证：`scripts/generation/credentials.mjs`，env 优先，其次 `~/.config/oh-my-short-drama/credentials.json`。
- 临时托管：`scripts/media-hosting/`，目前仅 litterbox，capabilities 仅 `image`；收据写 `.short-drama/uploads/upload-<uuid>.json`，带 sha256 去重。
- 插件脚本不引入任何 npm 依赖（Node 内置 `fetch`/`FormData`/`Blob` 已满足）。
- 每个模块带导出的纯函数 `selfCheck()`，在 mcp 启动时调用；`scripts/integration-self-check.mjs` 跑端到端校验。

## 3. DashScope API 合同（移植依据）

Base：`https://dashscope.aliyuncs.com`，鉴权 `Authorization: Bearer ${BAILIAN_API_KEY}`。

| 用途 | 端点 | model / action |
|---|---|---|
| qwen TTS | `POST /api/v1/services/aigc/multimodal-generation/generation` | body `{model, input:{text, voice, language_type}}` |
| CosyVoice TTS | `POST /api/v1/services/audio/tts/SpeechSynthesizer` | body `{model, input:{text, voice, format, sample_rate, volume, rate, pitch, language_hints?, instruction?}}` |
| CosyVoice 设计/克隆/列表/删除 | `POST /api/v1/services/audio/tts/customization` | model `voice-enrollment`，action `create_voice` / `list_voice` / `delete_voice` |
| qwen 设计/列表/删除 | 同上 | model `qwen-voice-design`，action `create` / `list` / `delete` |

- TTS 成功响应：`output.audio.data`（base64）或 `output.audio.url`（需下载），`usage.characters`，`request_id`；失败为非 2xx + `{code, message}`。
- 设计成功响应：`output.voice` 或 `output.voice_id`、`output.target_model`、`output.status`（`DEPLOYING`/`OK`/`UNDEPLOYED`）、`output.preview_audio.{data,sample_rate,response_format}`；克隆可能只返回 voiceId 无预览音频。
- CosyVoice 设计 body：`input:{action:'create_voice', target_model, voice_prompt, preview_text, prefix, language_hints?:[单值]}`，`parameters:{sample_rate:24000, response_format:'wav'}`。
- 克隆 body：`input:{action:'create_voice', target_model, url, prefix, language_hints?:[单值], max_prompt_audio_length?:3-30, enable_preprocess?:true}`。
- 列表：`input:{action, page_size:100}`，取 `output.voices`（兼容 `output.voice_list`）。
- 删除 flavor 判定：voiceId 以 `cosyvoice-v` 开头走 voice-enrollment/delete_voice/`voice_id`，否则走 qwen-voice-design/delete/`voice`。
- CosyVoice 模型矩阵（来自 `catalog.ts`）：
  - 语言 hints：默认 11 种 `zh,en,fr,de,ja,ko,ru,pt,th,id,vi`；`cosyvoice-v3-plus` 仅 7 种（去 pt/th/id/vi）；`cosyvoice-v2` 仅 `zh,en`。
  - instruction 仅 `cosyvoice-v3.5-plus`、`cosyvoice-v3.5-flash`、`cosyvoice-v3-flash` 支持；长度按汉字计 2、其余计 1，上限 100。
  - `cosyvoice-v3.5-plus`/`v3.5-flash` 只接受自定义音色：voiceId 必须能前缀推断出该模型（`inferBailianCosyVoiceModelIdFromVoiceId`：voiceId 等于模型 ID 或以 `<modelId>-` 开头），否则返回 `COSYVOICE_TTS_CUSTOM_VOICE_REQUIRED:<model>`。
- 长文本：CosyVoice 单段 ≤280 字、qwen ≤600 字，按标点（`。！？；，、.!?;:,：\n`）回退切分；wav 分段做 RIFF 解码→PCM 拼接→重建 wav，非 wav（mp3/pcm/opus）直接字节序拼接，时长仅 wav 可计算。
- qwen 设计固定目标模型 `qwen3-tts-vd-2026-01-26`，`preferred_name` 默认 `custom_voice`，language `zh|en`。

## 4. 新文件与改动清单

### 4.1 新增 `scripts/generation/bailian.mjs`

纯 HTTP/算法 adapter，不做任何项目文件操作。

导出 `bailian` 对象：

```js
{
  label: '阿里云百炼',
  credentialEnv: 'BAILIAN_API_KEY',
  catalog: {
    image: [], video: [], music: [], asr: [],
    audio: ['cosyvoice-v3.5-plus', 'cosyvoice-v3.5-flash', 'cosyvoice-v3-plus',
            'cosyvoice-v3-flash', 'cosyvoice-v2', 'qwen3-tts-vd-2026-01-26'],
  },
  capabilities: { text: false, image: false, video: false, audio: true, music: false,
                  transcription: false, translation: false, voice_design: true },
  models(),              // { catalog }（静态目录，不做远程列表调用）
  testConnection(),      // POST customization action=list_voice，仅验证 2xx/鉴权
  audio(input),          // 合成，返回与 starrouter.audio 同构结果
  createVoiceDesign(input),   // 纯云端：设计（含 qwen flavor）
  createVoiceClone(input),    // 纯云端：克隆（input.url 必填，公网 URL 由调用方解决）
  listCloudVoices(),          // 合并两个云端列表
  deleteCloudVoice(voiceId),  // 前缀自动分流
}
```

内部从 waoowaoo 移植并去重（两份 tts 文件里的 WAV/分段逻辑合并成一份模块内共享函数）：

- `decodeWavBuffer/buildWavBuffer/mergeWavBuffers/getWavDurationMs/isWavFormatEqual`
- `splitTextByLimit(text, maxChars)`
- 模型矩阵常函数：`COSYVOICE_LANGUAGE_HINTS(modelId)`、`supportsInstruction(modelId)`、`inferModelFromVoiceId(voiceId)`
- `audio(input)` 行为：
  - `confirm(input)`：`confirmed === true`，与其它付费工具一致。
  - 按模型 ID 分流：CosyVoice → SpeechSynthesizer；`qwen3-tts-vd-2026-01-26` → multimodal-generation。
  - 入参：`input`（文本，与现有 generate_audio 约定一致，兼容 `prompt` 兜底）、`voice`、`speed`（CosyVoice 映射为 `rate`，区间 0.5–2）、`response_format`（CosyVoice `wav|mp3|pcm|opus`，默认 `wav`；qwen 固定 wav）、`sample_rate`（默认 24000，枚举 8000/16000/22050/24000/44100/48000）、`volume`（0–100，默认 50）、`pitch`（0.5–2，默认 1）、`language_hints`（单值，必须在模型矩阵内）、`instruction`（≤100 加权字符，仅支持模型）、`language_type`（仅 qwen，`Chinese|English`，默认 `Chinese`）。
  - 分段串行合成后合并；输出归一化为
    `{ provider:'bailian', task_id:`bailian-sync-<uuid>`, status:'completed', outputs:[{ b64_json:`data:<mime>;base64,...`, media_type:'audio', content_type: mime, format }] }`，
    mime 映射 wav→`audio/wav`、mp3→`audio/mpeg`、opus→`audio/opus`、pcm→`audio/L16`。
  - HTTP 错误归一化：`BAILIAN_REQUEST_FAILED(<status>): <code 或 message>`，与 `STARROUTER_REQUEST_FAILED` 同风格；网络/JSON 错误给稳定 code（`BAILIAN_RESPONSE_INVALID_JSON` 等）。
  - 超时 300s（复用 AbortSignal.timeout）。
- `createVoiceDesign(input)`：
  - 入参 `flavor: 'cosyvoice-design'|'qwen'`（默认 cosyvoice-design）、`voice_prompt`（1–500 字符）、`preview_text`（5–200 字符）、`prefix`（`^[A-Za-z0-9]{1,10}$`，cosy 默认 `cv`）、`target_model`（5 个 CosyVoice 之一，默认 v3.5-plus）、`language_hints`（可选单值）、qwen 时 `preferred_name`、`language`。
  - 返回 `{ success, voice_id, target_model, status, preview?: { data_base64, sample_rate, format }, request_id, error?, error_code? }`。
  - 导出纯校验函数 `validateVoicePrompt/validatePreviewText/validateVoicePrefix` 供 MCP 层和 selfCheck 复用。
- `createVoiceClone(input)`：入参 `url`（必须 https 公网，复用 starrouter 的 assertHttps 同款校验，拒绝 localhost/私网）、`prefix`（默认 `clone`）、`target_model`、`language_hints`、`max_prompt_audio_length`（整数 3–30，默认 10）、`enable_preprocess`（布尔）；返回同设计（preview 可缺）。
- `listCloudVoices()`：两个端点并发，单端点失败返回空数组不阻塞另一路（移植现有行为）；条目 `{voice_id, prefix?, target_model?, status?, create_time?, update_time?, source:'cosyvoice'|'qwen'}`。
- `deleteCloudVoice(voiceId)`：按前缀分流，非 2xx 抛 `BAILIAN_VOICE_DELETE_FAILED(status): code/message`，成功返回 `{request_id?, flavor}`。
- `selfCheck()`：请求体构造（cosy/qwen/clone 三种）、WAV 合并往返（构造两个合法 wav 片段合并后 PCM 长度=两段之和、时长正确；格式不匹配必须抛错）、分段函数（超长文本切分后每段 ≤ 上限且拼接还原）、前缀推断与 flavor 判定、语言/instruction 矩阵拒绝非法值、错误响应归一化。

### 4.2 改 `scripts/generation/providers.mjs`

- `import { bailian } from './bailian.mjs'`，`adapters = { bailian, starrouter, runninghub, comfly }`（百炼第一）。
- `parameterCatalog` 增加 `bailian` 段（key 必须与 adapter 读取的入参名一致）：
  - `cosyvoice-v3.5-plus`、`cosyvoice-v3.5-flash`：`speed`(number 0.5–2 step .1 默认 1)、`response_format`(select wav/mp3/pcm/opus 默认 wav)、`sample_rate`(select 8000/16000/22050/24000/44100/48000 默认 24000)、`volume`(number 0–100 默认 50)、`pitch`(number 0.5–2 step .1 默认 1)、`language_hints`(select 11 语言默认 zh)、`instruction`(string，maxLength 100，默认 '')。
  - `cosyvoice-v3-flash`：同上但 language_hints 11 种、保留 instruction（该模型支持）。
  - `cosyvoice-v3-plus`：同上但 language_hints 7 种、无 instruction。
  - `cosyvoice-v2`：speed/response_format（wav/mp3/pcm）/sample_rate/volume/pitch + language_hints select zh/en，无 instruction。
  - `qwen3-tts-vd-2026-01-26`：`language_type`(select Chinese/English 默认 Chinese)。
- `normalizeModelParameters` 增加 `string` 类型：非字符串抛错；`maxLength` 存在时按"汉字计 2、其余计 1"加权长度校验（与百炼 instruction 口径一致）；空字符串视为未提供→取 default。
- `selfCheck()` 增补 bailian 用例：默认参数归一化、instruction 超长拒绝、v2 传 11 语言外的值被拒、项目锁定参数覆盖语义。

### 4.3 改 `scripts/generation/mcp.mjs`

- 启动自检加 `checkBailian()`。
- `generate_audio` schema 扩展（共享 schema，starrouter 会自行拒绝它不支持的值）：
  - `response_format` enum 追加 `wav`、`opus`；
  - 新增可选 `language_hints`(string)、`sample_rate`(integer)、`volume`(number 0–100)、`pitch`(number 0.5–2)、`instruction`(string)。
  - `speed` 已存在；adapter 内映射为 CosyVoice 的 rate。
- 新增四个工具（命名风格与现有蛇形工具一致）：

| 工具 | required | 说明 |
|---|---|---|
| `design_voice` | `provider, project_root, flavor, voice_prompt, preview_text, prefix, confirmed` | provider enum 仅 `bailian`；可选 target_model/language_hints/preferred_name/language |
| `clone_voice` | `provider, project_root, prefix, confirmed, rights_confirmed, public_exposure_confirmed, usage_terms_confirmed, usage_scope`，且 reference_audio_path / audio_url 二选一 | usage_scope enum `non-commercial|commercial-authorized`（强制显式选择，无默认）；可选 target_model/language_hints/max_prompt_audio_length/enable_preprocess |
| `list_voices` | `provider, project_root` | 只读，无需 confirmed |
| `delete_voice` | `provider, project_root, voice_id, confirmed` | 云端 + 本地登记一起删 |

  - 四个工具**不走** `enforceGenerationStage`、请求快照和任务账本（不产生 audio-* 资产，可在媒体生产之前的音频设计阶段使用）；但必须 `realpath(project_root)` 并成功读取/校验 `.short-drama/project.json`（证明在合法项目内）。
  - `design_voice` 分发：MCP 层做入参校验（复用 bailian.mjs 导出的 validators 与模型矩阵）→ `adapter.createVoiceDesign` → 写 voice-ledger → 预览音频落盘 → 返回 ledger 条目（含 preview_path）。
  - 实现顺序说明（2026-09-12 终修）：实现中预览音频先于 ledger 写入尝试；预览持久化失败时云端音色仍按成功登记/上报（`preview_path:null` + 中文 warning，提示用 `list_voices`/`delete_voice` 收敛，不重试付费调用），ledger 写入失败则尽力删除已落盘预览并同样返回 voice_id + warning；两层失败同时发生时 warning 仍明确告知云端音色已创建。
  - `clone_voice` 分发：
    1. 若给 `audio_url`：校验 https 公网（拒绝 localhost/私网）。
    2. 若给 `reference_audio_path`：realpath 必须位于项目 `assets/` 内（仿 ASR 路径校验）；扩展名白名单 `.wav,.mp3,.m4a,.aac,.ogg,.flac,.webm`；大小 ≤ 20 MiB；魔数嗅探（RIFF/ID3/`0xFFFx`/`ftyp`/OggS/`fLaC`）与扩展名一致。
    3. 内部调用泛化后的托管发布（见 4.5），固定 `service:'litterbox'`、`expires_in:'72h'`，`usage_scope` 由工具必填参数透传（`non-commercial|commercial-authorized`）；同 sha256+scope 有效收据自动复用。
    4. 调 `adapter.createVoiceClone({url, ...})` → 写 ledger（source='clone'，记录 upload receipt id）。
  - `list_voices`：`listCloudVoices()` 结果逐项叠加本地 ledger 字段（name/source/created_at/preview_path），并单独返回仅存在于本地的登记。
  - `delete_voice`：只有云端删除返回 2xx 后才删除 ledger 条目和预览文件；非 2xx 一律失败并保留本地登记（幂等收敛由用户在云端确认后重试，不按错误码猜测）。
  - `call()` 中在 `adapter(args.provider)` 通用分发之前加这四个名字的专用分支（与 transcribe 特例同层）。

### 4.4 新增 `scripts/voice-ledger.mjs`

- 文件：`.short-drama/voices.json`，形状：

```json
{
  "version": 1,
  "voices": [
    {
      "voice_id": "cosyvoice-v3.5-plus-xxxx",
      "flavor": "cosyvoice-design",
      "target_model": "cosyvoice-v3.5-plus",
      "prefix": "cv",
      "name": "voice_xxx_1",
      "source": "design",
      "preview_path": ".short-drama/voice-previews/<voice_id>.wav 或 null（克隆可能无预览）",
      "upload_receipt_id": null,
      "request_id": "...",
      "created_at": "2026-09-12T10:00:00.000Z"
    }
  ]
}
```

- API：`readVoiceLedger(root)`（文件不存在返回空骨架，形状损坏抛错）、`addVoiceEntry(root, entry)`、`removeVoiceEntry(root, voiceId)`、`findVoiceEntry(root, voiceId)`；全部写操作经 `withFileLock`（锁 `.short-drama/locks/voice-ledger-<hash>`），原子临时文件替换，复用 file-lock.mjs。
- voice_id 落盘文件名消毒：`/[^A-Za-z0-9._-]/g → '_'`，预览文件写 `.short-drama/voice-previews/<safeId>.<format>`（目录不在 assets/ 内，不进资产账本）。
- `selfCheck()`：临时目录上的增/查/删往返、并发/损坏 JSON 行为、文件名消毒。
- 在 `integration-self-check.mjs` 的脚本自检循环中登记该文件。

### 4.5 改 `scripts/media-hosting/`

- `litterbox.mjs`：`capabilities.media_types` 改为 `['image', 'audio']`（litterbox 本身不限类型，仅拦危险扩展名；现有 DISALLOWED 已覆盖）。selfCheck 同步更新。
- `publish.mjs`：把 `publishReferenceImage` 的主体泛化为内部 `publishReferenceMedia(rootArg, input, mediaType)`：
  - image 走现有 assertImage + asset 类型白名单（character/scene/prop/storyboard/other）+ assets.json 版本/sha 校验；
  - audio 分支：不查 assets.json（克隆参考音频允许是 assets/ 内任意音频文件，包括用户自行放入的录音），改为 realpath 必须在 `assets/` 内、扩展名白名单 + 魔数嗅探、大小 ≤ host 上限；收据 `media_type:'audio'`。
  - 收据结构、sha256 去重、锁、`.short-drama/uploads/` 路径、密钥字段扫描全部复用。
  - `publishReferenceImage` 保留为薄包装（MCP 现有工具行为零变化）。
- 不新增 MCP 发布工具；audio 发布函数只由 mcp.mjs 的 clone 分支内部调用。

### 4.6 配置与文档

- `.mcp.json`：`env_vars` 增加 `BAILIAN_API_KEY`。
- `skills/configure-generation-providers/SKILL.md`（已确认模型清单只在此文件，`agents/` 下无）：
  - 百炼列为**配音默认推荐 Provider**，凭证 `BAILIAN_API_KEY`（DashScope 控制台获取，写入凭证的方式与其它 key 一致）；
  - 列出 6 个音频模型与推荐顺序；说明 v3.5-plus/flash 必须先 `design_voice`/`clone_voice`，v2 可用预置音色零门槛；
  - 各模型参数表（speed/format/sample_rate/volume/pitch/language_hints/instruction/language_type）与 project.json parameters 锁定规则。
- `skills/design-drama-audio/SKILL.md`：
  - 推荐流程改为：用 `design_voice`（声音描述）或 `clone_voice`（授权参考音频，需三项权利确认）产出真实 voice_id → 写入 audio-plan `voice_bindings`（provider=`bailian`、model=实际模型、voice_id）→ 批准后全量并发 `generate_audio`；
  - 同一角色跨状态复用同一 voice_id 的既有约束不变；
  - 补百炼约束：instruction 仅三模型、语言矩阵、自定义音色强制、长文本自动分段、wav/mp3 试听；
  - StarRouter 配音段落保留为备选路径。
- `skills/drama-generation-service/SKILL.md`：工具可用性清单（第 10 行附近）加四个新工具；保留"缺工具需重启 Codex"提示。
- `README.md`：provider/能力表加百炼一行（配音默认推荐、声音设计/克隆），环境变量表加 `BAILIAN_API_KEY`。
`.codex-plugin/plugin.json`：按仓库发布惯例将 `version` bump 为三段式 SemVer（例如 `0.4.1`），不添加构建时间戳。

## 5. 数据流

### 5.1 设计音色

```
Codex → MCP design_voice
  → 读 project.json（合法项目校验）
  → bailian.createVoiceDesign()  POST customization (voice-enrollment/create_voice)
  → 成功：voice_id + preview_audio
  → voice-ledger.addVoiceEntry()，预览写 .short-drama/voice-previews/
  → 返回 {voice_id, target_model, status, preview_path, request_id}
```

### 5.2 克隆音色

```
Codex → MCP clone_voice(reference_audio_path + 三项确认 + usage_scope)
  → 路径/扩展名/魔数/大小校验（assets/ 内）
  → publishReferenceMedia('audio') → litterbox 72h URL（收据去重）
  → bailian.createVoiceClone({url, prefix, target_model, ...})
  → ledger 登记（含 upload_receipt_id）
  → 返回 {voice_id, target_model, status, request_id}
```

### 5.3 配音合成（走既有通道）

```
generate_audio(provider=bailian, model=cosyvoice-v3.5-plus, voice=<ledger 中的 voice_id>)
  → 阶段门禁 + project.json provider/参数一致性
  → document-reference: audio-plan voice_bindings 校验（provider/model/voice_id/逐字台词）
  → 请求快照 + reserveTask
  → bailian.audio()：分段合成 → wav 合并 → data URL
  → syncTaskResult：候选版本落 assets/audio/、账本回写（与 starrouter 完全同构）
```

## 6. 错误处理与安全

- 所有百炼 HTTP 非 2xx：抛 `BAILIAN_REQUEST_FAILED(<status>): <code>: <message>`（截断 500 字符）；网络错误不透出原始堆栈。
- 缺凭证：`BAILIAN_API_KEY 未配置`（与 `STARROUTER_API_KEY 未配置` 同风格）。
- 付费操作（design/clone/delete/audio）一律 `confirmed === true`；克隆额外强制三项权利确认与显式 `usage_scope`，与 `publish_reference_image` 同一套话术。
- 私网/localhost URL 一律拒绝（出站由百炼发起，禁止 SSRF 到内网）。
- 本地参考音频只能来自当前项目 `assets/`（realpath  containment，沿用 ASR/图片参考的边界模型）。
- 收据禁密钥字段扫描复用 `rejectSecrets`。
- 云端删除失败不破坏本地数据；本地登记写入失败时（设计已成功）返回 voice_id 的同时带 warning，提示用户可用 list_voices/delete_voice 收敛，不谎称失败。

## 7. 测试策略（全部无外部依赖，selfCheck 在 MCP 启动时执行）

1. `bailian.mjs selfCheck`：第 4.1 节列举的纯函数用例。
2. `providers.mjs selfCheck`：百炼参数目录归一化/锁定用例。
3. `voice-ledger.mjs selfCheck`：临时目录往返。
4. `litterbox.mjs`/`publish.mjs selfCheck`：audio 能力与音频魔数分支；图片路径行为保持不变（现有 image selfCheck 必须原样通过）。
5. `integration-self-check.mjs` 增补：
   - project.json 配置 `audio: {provider:'bailian', model_or_workflow:'cosyvoice-v3.5-plus', parameters:{...}}` 被接受（不需要真实 API 调用，校验发生在 store 层）；
   - 非法参数（v2 传 ja、instruction 传 v3-plus）被 project-store 拒绝；
   - voice-ledger 增删与 list 叠加在临时项目上端到端跑通（adapter HTTP 用注入/fetch 桩，不打真实网络——沿用现有 selfCheck 纯本地原则）；
   - clone_voice 对项目外路径、缺确认、URL 私网地址在到达 Provider 前被拒绝。
6. 手工冒烟（可选，需真实 key）：`live-smoke-test.mjs` 风格，检测到 `BAILIAN_API_KEY` 时跑一次 design→合成短句→delete 收敛；无 key 时 skip。
