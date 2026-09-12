---
name: configure-generation-providers
description: 配置并验证本地短剧插件的生成 Provider。用于选择阿里云百炼、StarRouter、RunningHub 或 Comfly，检查凭据和读取模型或工作流目录；不执行付费生成。
---

# 配置生成 Provider

先调用 `list_generation_providers` 查看模态能力，再让用户为图片、视频、语音和音乐分别选择 Provider；不得假设所有模态使用同一家。文本资产默认由 Codex 直接完成，不需要外部文本 Provider。

确认选择后，把四种模态的 `provider`、`model_or_workflow`、模型 `parameters` 和视频 `prompt_profile` 写入一个不含凭据的更新 JSON，再执行 `node scripts/project-store.mjs update-project <项目目录> <更新 JSON>`；Dashboard 应按模型目录展示枚举、数字范围和布尔参数。生成 MCP 会补齐未显式传入的项目参数，并拒绝与已确认参数不一致的调用；标记为可覆盖的默认参数除外，视频时长必须以当前选版的逐镜头制作计划和提示词为准。旧项目没有 `parameters` 或 `music` 时仍可读取，在 Dashboard 保存一次生成配置即可补齐。凭据使用环境变量或 Dashboard 本机私有凭据文件，环境变量优先；不得写入项目。

不要直接编辑 `project.json`。项目存储会拒绝未注册 Provider、该 Provider 不支持的模型/模态和模型枚举之外的参数；模型切换时 `parameters` 整体替换而非与旧字段合并。Comfly `minimax-h3` 不接收 `generate_audio` 参数，声音策略写入制作计划的 `audio_strategy`，不能伪装成 Provider 参数。

- **阿里云百炼（配音默认推荐）**：环境变量 `BAILIAN_API_KEY`（[DashScope 控制台](https://bailian.console.aliyun.com/) 获取），只提供语音模态。音频模型按推荐顺序为 `cosyvoice-v3.5-plus`、`cosyvoice-v3.5-flash`、`cosyvoice-v3-plus`、`cosyvoice-v3-flash`、`cosyvoice-v2`、`qwen3-tts-vd-2026-01-26`。其中 v3.5-plus/flash 只接受自定义音色，必须先用 `design_voice`（文本描述设计）或 `clone_voice`（授权参考音频克隆）取得 voice_id 并写入 audio-plan 的 `voice_bindings`；`cosyvoice-v2` 支持预置音色，可零门槛起步。模型参数：`speed`（0.5–2）、`response_format`（wav/mp3/pcm/opus，v2 无 opus）、`sample_rate`（8000/16000/22050/24000/44100/48000）、`volume`（0–100）、`pitch`（0.5–2）、`language_hints`（v3.5/flash 11 语种、v3-plus 7 语种、v2 仅 zh/en）、`instruction`（仅 v3.5-plus/flash 与 v3-flash，加权长度 ≤100）；qwen 模型仅 `language_type`（Chinese/English）。声音管理工具为 `design_voice`/`clone_voice`/`list_voices`/`delete_voice`；克隆本地音频会临时公网发布 72h，必须显式选择 `usage_scope` 并确认三项权利条款。
- StarRouter：环境变量 `STARROUTER_API_KEY`，可选基址与图片、视频、语音模型目录变量；协议见 [StarRouter 合同](../../references/starrouter-provider.md)。内置模型枚举如下：
  - image：`gpt-image-2`。
  - video：`MiniMax-H3`、`MiniMax-H3-Max`、`dreamina-seedance-2-0-fast-260128`、`dreamina-seedance-2-0-260128`、`doubao-seedance-2-0-260128`、`doubao-seedance-2-0-fast-260128`、`doubao-seedance-1-5-pro-251215`、`doubao-seedance-1-0-pro-250528`、`doubao-seedance-1-0-pro-fast-251015`。
  - audio：`speech-2.8-hd`、`speech-2.8-turbo`、`qwen3-tts-vc-realtime-2025-11-27`、`qwen3-tts-vc-realtime`、`pawsense-audio`、`tts-1`；`suno_music` 用于 OP、ED、BGM、音乐短视频。
  - asr：`qwen3-asr-flash`、`whisper-1`，用于项目音频转写/翻译和原生对白审计；可用 `STARROUTER_ASR_MODELS` 扩展目录、`STARROUTER_ASR_MODEL` 指定默认审计模型。
- RunningHub：环境变量 `RUNNINGHUB_API_KEY`，可选基址和通用图片/视频/音频工作流 ID；内置图片 `krea2-normal-v1`，可用 `RUNNINGHUB_KREA2_WORKFLOW_ID` 覆盖；内置 H3 可用 `RUNNINGHUB_H3_WORKFLOW_ID` 覆盖平台工作流 ID。协议见 [RunningHub 合同](../../references/runninghub-provider.md)。
- Comfly：`COMFLY_TOKEN`、可选 `COMFLY_BASE_URL` 和 `COMFLY_APP_ID`；当前模型固定为 `minimax-h3`。协议见 [Comfly 合同](../../references/comfly-provider.md)。

凭据不得写入项目文件、参数或聊天。环境变量覆盖的模型目录属于动态扩展，不会自动获得参数兼容性保证；先调用 `list_models` 探活并核对远端目录。401/403 归为认证，429 归为限流。不要用付费任务代替连接检查。新增 Provider 只注册生成适配器并补最小自检，不修改短剧创作 Skill。

用户明确授权逐模型付费验收后，可运行 `node scripts/generation/live-smoke-test.mjs --confirmed --output <本地目录>`。脚本对内置的 1 个图片、9 个视频和 2 个语音模型各调用一次，轮询视频到终态，下载全部结果并写 `report.json`；没有 `--confirmed` 或输出目录时拒绝执行。
