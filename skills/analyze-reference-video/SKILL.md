---
name: analyze-reference-video
description: 导入或读取项目内已选择的本地参考短视频，拆解为带时间码、关键帧、转写依据、权利边界和置信度的参考视频分析；不直接生成复刻成片。
---

# 分析参考短视频

仅用于 `.short-drama/project.json` 的 `workflow.type=viral-recreation`。用户提供平台链接时必须先检查元数据并取得下载/参考分析权利确认；不得把 `automation_mode` 当作确认。所有支持的平台默认先使用 yt-dlp；只有用户显式指定 `--provider dtk` 时，抖音/TikTok 才使用本机 DTK v5。

链接导入必须遵守以下浏览器约束：

- 首次尝试 `yt-dlp`；当它明确返回 HTTP 403，或明确要求登录、注册用户、`--cookies-from-browser`、fresh cookies 等鉴权挑战时，先请用户在自己的 Chrome 打开作品、完成登录并让视频可播放，再用 `--after-browser-login` 重试一次。该重试会给 yt-dlp 增加 `--cookies-from-browser chrome --impersonate chrome`，只在进程内读取现有会话，不导出或持久化 Cookie。重试仍是明确鉴权挑战时，才进入现有 Chrome 播放会话兜底。普通网络、解析、磁盘或格式错误始终禁止误切浏览器。
- 浏览器兜底只能接管用户自己已经打开的 Chrome 标签页和既有登录会话。先读取现有浏览器/标签页状态，匹配用户给出的页面；禁止调用创建标签页或启动隔离会话的能力，禁止打开 Codex 临时浏览器、隐藏浏览器或新的 Chrome session。
- 若没有匹配的现有 Chrome 标签页，或页面仍要求登录，停止自动下载并明确请用户在自己的 Chrome 中打开链接、完成登录且让视频可播放；用户回复登录完成后先重试 yt-dlp，仍失败才继续浏览器会话提取，不得直接改口要求上传文件。不得替用户提交账号、密码、短信验证码、扫码确认或风控验证。
- 页面可播放后，只从该既有标签页读取当前作品的实际媒体请求或播放器资源。临时 CDN URL、Cookie、请求头、签名、令牌和浏览器存储不得写入聊天、项目文件、命令参数、日志或导入收据，也不得复用于其他作品。
- 下载到本机暂存文件后必须调用 `import-browser-file`；该入口会验证会话声明、受支持容器、文件大小、真实视频流、时长、帧率、分辨率与 SHA-256，然后才登记并选中来源。校验失败时不得登记来源，也不得把网页、错误响应或零字节文件当成视频。

本 Skill 必须分两段执行。第一段只负责导入、选中、权利确认和 `prepare`，随后暂停正式分析并切到 `use-hypit-video`。复刻项目的中间理解阶段固定使用 Hypit：参考视频准备完成、权利范围确认后，先运行 `ensure-hypit.mjs ensure --project-root <项目目录>`，再让官方 Hypit Skill 建立与当前项目隔离的 Hypit 工作目录，读取并整理参考视频的 Brief、Analysis、Timeline 和 Treatment。Hypit 只负责理解参考片的注意力结构、语义事件、画面/字幕/声音关系和可迁移机制；这一步禁止调用 Hypit `build`、生成模型或导出最终成片。完成中间分析后，使用 `record-hypit-handoff.mjs` 登记实际 Hypit 文件、当前 selected reference-video 版本及 SHA-256，生成 `.short-drama/hypit/handoff.json`，再记录 `use-hypit-video` Skill 证据。第二段只有在 handoff 校验通过后才能生成和记录正式 `reference-video-analysis`；不得先写正式分析再补 Hypit。

```bash
node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/reference-video-import.mjs" inspect '<链接或分享文本>'
node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/reference-video-import.mjs" import <项目目录> '<链接或分享文本>' <source-key> <version> --rights-basis owned|licensed|authorized-reference
# 首次明确鉴权挑战会返回 YTDLP_USER_LOGIN_REQUIRED/退出码 42；用户登录后先重试 yt-dlp：
node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/reference-video-import.mjs" import <项目目录> '<链接或分享文本>' <source-key> <version> --after-browser-login --rights-basis owned|licensed|authorized-reference
# 仅在上述重试仍返回 YTDLP_HTTP_403_BROWSER_SESSION_REQUIRED 或 YTDLP_LOGIN_BROWSER_SESSION_REQUIRED 后，从用户既有 Chrome 会话下载并调用：
node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/reference-video-import.mjs" import-browser-file <项目目录> '<原页面链接>' <本地暂存视频> <source-key> <version> --browser-session existing-user-chrome --content-id <作品ID> --rights-basis owned|licensed|authorized-reference
```

`DTK_API_KEY`、Cookie 等凭据只能从本机环境、下载器自身配置或用户既有浏览器会话读取，不得写入项目、命令参数、日志或提示词。链接导入完成后确认 `source/manifest.json` 中存在已选择的 `reference-video` 来源，并运行 `validateReferenceImportReceipts` 所在的项目校验，再执行：

```bash
node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/reference-video.mjs" prepare <项目目录> <source-key> <version>
```

完整观看或逐镜查看准备清单列出的关键帧；存在音轨时使用已配置 ASR 或用户提供的字幕核对台词。自动 scene score 只提供候选切点，不得把它叙述为已经人工确认的叙事边界。除明确 403 或登录/浏览器会话挑战后按上述用户既有 Chrome 会话读取当次媒体流外，只能通过受控导入命令下载；浏览器得到的本地文件也必须交给 `import-browser-file` 校验登记，不得把参考原片登记进正式视频资产账本。

Hypit 的中间理解只是辅助证据，不是项目事实来源：逐项回看本地关键帧、时间码和转写，确认后再翻译为当前插件的 `reference-video-analysis`。Hypit 未覆盖、无法验证或与本地证据冲突的内容写入 `limitations` 或 `open_questions`，不能直接沿用。

必须取得用户对 `rights.status`、`allowed_uses` 和限制的明确说明。`allowed_uses` 与 `restrictions` 只能使用 `analysis`、`authorized-close-recreation`、`identity`、`voice`、`music`、`trademark`、`dialogue`、`visual-style` 这些受控能力值，禁止填写自由文本以绕过交集校验。未知权利只能记录为 `reference-only`，且后续仅允许结构迁移。`automation_mode` 不能代替权利确认。

读取 `assets/prompts/reference_video_analysis.{zh,en}.txt` 的 `reference_video_analysis` Codex 合同，用 prepared 清单、项目配置、关键帧观察和转写生成 `.short-drama/reference-video-analysis.json`。每项结构判断必须回链 `evidence[].id`；原片事实、机制推断和创作建议分开，不能把标题、画面猜测或不完整 ASR 写成确定事实。

先运行：

```bash
node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/recreation-workflow.mjs" validate-analysis <分析文件>
```

再用 `project-store.mjs put-document <项目> reference-video-analysis <分析文件>` 落盘，并用 `render-prompt.mjs --codex-output` 保存合同运行记录。准备清单、当前 selected 来源绑定的 `.short-drama/hypit/handoff.json`、分析文件和合同记录缺一不可；`skill-runs.mjs record` 会拒绝缺少或过期的 handoff。
