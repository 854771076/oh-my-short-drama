# 短剧工厂

本地优先、可追溯、可扩展的标准短剧制作插件，支持 Codex、Claude Code 与 Hermes Agent。从小说、故事梗概或创意开始，由智能体完成文本创作，通过生成 Provider 完成图片、视频和音频，最终在本地完成剪辑与交付。

```text
Codex / Claude Code / Hermes → oh-my-short-drama → drama-generation MCP → 阿里云百炼 / StarRouter / RunningHub / Comfly
                                                                  ↘ Litterbox 临时参考图 URL（按需）
```

## 核心原则

- 文本资产由 Codex 直接生成，不调用外部文本模型。
- 图片、视频、语音和音乐统一通过 `drama-generation-service` 路由。
- 项目、剧集、分镜、素材、任务、选版和交付均在本地管理。
- 所有媒体版本记录 Provider、模型、任务、参数、上游资产和 SHA-256。
- 每次媒体调用完整保存模型入参、提示词和引用清单，并由任务记录绑定请求 SHA-256。
- MCP 工具不可用时停止媒体生产，禁止使用占位文件伪造成片。
- 默认全自动化模式下，agent 自主处理覆盖、删除、回退、选版、上传和付费生成的常规确认；关闭项目 `automation_mode` 后恢复用户逐项确认。权限、素材权利和安全门禁始终不能绕过。

## 标准流程

```text
初始化项目
  → Codex 分析原文与要求
  → 剧本初稿 → Humanizer 自然化 → 剧本复核
  → 导演本落盘
  → 资产分析
  → 人物 / 场景 / 道具生成并落盘
  → 分镜与制作规划
  → 视频提示词落盘
  → 视频与配音生成
  → 逐镜验收
  → Remotion 剪辑
  → 成片交付
```

完整使用顺序、Skill 关系和确认项见 [使用手册](references/usage-guide.md)。

## 支持的生成 Provider

凭据可使用下列环境变量，也可在 Dashboard 的“生成配置”中录入。Dashboard 凭据保存在本机 `~/.config/oh-my-short-drama/credentials.json`（仅当前用户可读写），环境变量优先；两种方式都不会把凭据写入项目。旧版 `~/.config/codex-short-drama/credentials.json` 会被兼容读取，并在下次保存时迁入新路径。

### 阿里云百炼（配音默认推荐）

```bash
export BAILIAN_API_KEY='your-dashscope-key'
```

只提供语音模态：CosyVoice 全系列（推荐 `cosyvoice-v3.5-plus`，需先设计/克隆自定义音色；`cosyvoice-v2` 支持预置音色）与 `qwen3-tts-vd-2026-01-26`。通过 `design_voice`（文本设计音色）、`clone_voice`（参考音频克隆，本地素材自动临时发布 72h，需确认权利与使用范围）、`list_voices`、`delete_voice` 管理音色；音色登记保存在项目 `.short-drama/voices.json`，预览音频保存在 `.short-drama/voice-previews/`。

`audio_url` 客户端校验只拒绝非 HTTPS、落在本机/私网/链路本地/云元数据等保留网段的 IP 字面量以及 `.localhost` 域名，不对公网域名做 DNS 解析；若公网域名实际解析到内网地址，超出此客户端门禁范围，须由网络出站策略控制。

### StarRouter

- 图片：`gpt-image-2`
- 视频：Seedance 1.0、1.5、2.0、Fast 系列，以及 MiniMax H3 / H3-Max
- 音频：`speech-2.8-hd`、`speech-2.8-turbo`、Qwen3 TTS、PawSense、`tts-1`
- 转写/翻译：`qwen3-asr-flash`、`whisper-1`
- 音乐：`suno_music`，用于 OP、ED、BGM 和音乐短视频配乐

```bash
export STARROUTER_API_KEY='your-key'
export STARROUTER_BASE_URL='https://starrouter.io/v1'
```

可通过 `STARROUTER_IMAGE_MODELS`、`STARROUTER_VIDEO_MODELS`、`STARROUTER_AUDIO_MODELS` 扩展目录；自定义模型仍需补充参数合同和真实调用验证。完整枚举见 [StarRouter Provider 合同](references/starrouter-provider.md)。

### RunningHub

图片、视频和音频可通过用户自己的工作流运行：

```bash
export RUNNINGHUB_API_KEY='your-key'
export RUNNINGHUB_IMAGE_WORKFLOW_ID='workflow-id'
export RUNNINGHUB_VIDEO_WORKFLOW_ID='workflow-id'
export RUNNINGHUB_AUDIO_WORKFLOW_ID='workflow-id'
```

详见 [RunningHub Provider 合同](references/runninghub-provider.md)。密钥不得写入项目配置、提示词、任务账本或版本记录。

内置 `krea2-normal-v1` 图片工作流和 `minimax-h3-reference-to-video` 视频工作流，不需要手写 `node_info_list`。

### Comfly

```bash
export COMFLY_TOKEN='your-token'
export COMFLY_BASE_URL='https://vvicat-comfly-prod.vvicat.dev'
export COMFLY_APP_ID='0'
```

当前接入 `minimax-h3` 视频，支持 1–3 张公开图片或一个公开视频。详见 [Comfly Provider 合同](references/comfly-provider.md)。

### Litterbox 临时图床

当 Comfly 等 Provider 只接受公网 HTTPS 参考图时，可使用 `publish-drama-references`。Litterbox 免费、匿名、无需 Key，时效为 `1h/12h/24h/72h`；链接公开且不是永久资产。每次上传前必须确认素材权利、公开暴露和使用条款，并明确选择非商业用途或已获许可的商业用途；收据保存到项目 `.short-drama/uploads/`。同一资产版本默认复用有效收据，可用 `list_reference_uploads` 跨会话查看；只有时效不足并再次确认后才强制重传。最终素材仍只以本地账本为准。详见 [Litterbox 合同](skills/publish-drama-references/references/litterbox.md)。

## 安装与更新

### Codex

该仓库已登记到本地 `personal` marketplace 时执行：

```bash
codex plugin add oh-my-short-drama@personal
```

### Claude Code

仓库包含原生 `.claude-plugin/plugin.json`、marketplace、hooks 和独立 MCP 配置：

```bash
claude plugin marketplace add 854771076/oh-my-short-drama
claude plugin install oh-my-short-drama@short-drama
```

开发时可直接运行 `claude --plugin-dir /absolute/path/to/oh-my-short-drama`。更新已安装版本使用 `claude plugin marketplace update short-drama` 后执行 `claude plugin update oh-my-short-drama@short-drama`；也可启用 Claude Code 的 marketplace 自动更新。

### Hermes Agent

Hermes 可直接把本仓库的 `skills/` 目录作为 tap：

```bash
hermes skills tap add 854771076/oh-my-short-drama
hermes skills install 854771076/oh-my-short-drama/use-short-drama-studio
```

需要完整工作流和仓库级 `scripts/`、`references/` 时，应克隆整个仓库，在仓库根目录启动 Hermes，并在 `~/.hermes/config.yaml` 的 `skills.external_dirs` 中加入仓库的绝对 `skills/` 路径；单独安装 Skill 只包含该 Skill 自身目录，不提供 Claude/Codex 的 MCP 与 hooks。Hermes 更新 Skill 使用 `hermes skills check` 和 `hermes skills update`。

### 上游 Release 自动同步

本仓库每天检查 [`oh-my-short-drama` 的最新正式 Release](https://github.com/854771076/oh-my-short-drama/releases)。检测到新版本后，同步 `skills/`、`scripts/`、`references/`、`studio/`、hooks、Codex 清单和 MCP 配置，运行完整门禁并创建 PR；README、许可证、GitHub Actions 与 Claude 兼容层由本仓库独立维护，不会被覆盖。上游当前没有正式 Release 时工作流正常退出，不会回退到分支快照。

首次启用前，请在仓库 `Settings → Actions → General → Workflow permissions` 允许 GitHub Actions 创建 Pull Request；同步任务只在下载和创建 PR 的步骤获得写令牌，自检步骤不持有写凭据。

本仓库的标签发布会生成 `.tar.gz`、`.zip` 和 `SHA256SUMS`。发布标签必须严格等于 Codex/Claude 清单版本，例如 `v0.4.0+codex.20260912111400`。

插件在 SessionStart 时会检查 GitHub 最新正式 Release，检查结果缓存 24 小时；仅发现新版本时提示，网络或 GitHub 故障不会阻塞启动。也可手动强制检查：

```bash
node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/check-update.mjs" --check
```

安装、更新或修改 Provider 环境后，Codex 必须使用 `⌘Q` 完全退出再重新打开并新建任务；Claude Code 执行 `/reload-plugins` 或重启会话。不要直接修改客户端插件缓存；源码目录才是事实来源。

## 开始使用

在 Codex 新任务中选择“使用本地短剧工厂”，或直接描述：

```text
制作一个一分钟、9:16、多人多机位的短剧。未指定路径时项目保存在 ~/darma_project/<project-key>。
```

新项目会先确认必要参数，再按照 [项目规范 v1](references/project-spec-v1.md) 初始化。也可以直接使用脚本：

```bash
node scripts/project-store.mjs init project-key project.json
node scripts/preflight.mjs init ~/darma_project/project-key
node scripts/project-store.mjs put-source ~/darma_project/project-key src-original-novel v001 novel.txt
node scripts/project-store.mjs select-source ~/darma_project/project-key src-original-novel v001
node scripts/skill-runs.mjs required ~/darma_project/project-key analysis
node scripts/validate-project.mjs ~/darma_project/project-key
```

未确认的可选配置保存为 `null`，不会用示例值替用户决定。

### 本地创作工作台

Dashboard 使用 Node.js 内置 HTTP 服务，不需要安装前端依赖。默认工作区是本机用户主目录下的 `~/darma_project`，其中每个项目统一放在一级子目录中：

```bash
node scripts/studio.mjs init
node scripts/studio.mjs serve
```

需要覆盖默认位置时，仍可在命令后传入绝对工作区路径。

通过 `project-store.mjs init project-key` 在默认根目录初始化项目后，Dashboard 会自动在本机启动并打开；从 Dashboard 页面内新建项目时不会重复打开窗口。

然后打开 `http://127.0.0.1:4173`。工作台会按 `project.key` 连接一级目录中的真实项目，支持新建项目、供应商凭据与模型配置、非付费连接测试、项目校验、分集与已选文档、任务账本、交付预览、资产导入，以及确认后选版和撤回选版；项目 JSON 和媒体仍由原有账本脚本管理。

## 本地项目结构

```text
project/
├── AGENTS.md              # 新会话项目级恢复入口（已有文件时不覆盖）
├── .short-drama/          # 配置、当前/历史环境报告、恢复说明、提示词/媒体请求快照与账本
├── source/                # 原始资料及版本清单
├── episodes/ep-001/       # 剧本、复核报告、导演本、资产计划、分镜、制作计划
├── assets/                # 人物、场景、道具、故事板、视频、音频
├── editing/ep-NNN/        # 分集时间线与完整审片记录
└── delivery/ep-NNN/       # 分集成片、字幕和带哈希 manifest
```

版本使用 `v001`、`v002`；人物、场景、道具、故事板、视频和音频分别使用 `char-`、`scene-`、`prop-`、`board-`、`shot-`、`audio-` 前缀。旧版本不可覆盖。

## MCP 工具

插件提供 `drama-generation` MCP：

- `list_generation_providers`
- `list_media_hosts`
- `list_reference_uploads`
- `publish_reference_image`
- `list_models`
- `generate_image`
- `submit_video`
- `get_generation_task`
- `generate_audio`
- `design_voice` / `clone_voice` / `list_voices` / `delete_voice`

如果当前任务看不到这些工具，应使用 `⌘Q` 完全退出 Codex，再重新打开并新建任务；不得降级为占位媒体。

## 仓库结构

```text
.codex-plugin/plugin.json  # 插件清单
.mcp.json                  # 生成服务 MCP 注册
hooks/                     # 会话恢复 hook
skills/                    # 原子化制作 Skills 与内置提示词
scripts/                   # 项目、资产、任务、生成和校验脚本
references/                # 项目合同、Provider 合同和制作参考
```

原系统的文本 LLM 提示词已转换为所属 Skill 的 Codex 执行合同，不会再提交给外部文本模型；只有图片等媒体模板保留 Provider prompt 语义。`render-prompt.mjs` 会把合同、变量、Codex 实际产物或媒体提示词留存在项目 `prompt-runs/`，`skill-runs.mjs record` 再把正确模式的运行记录绑定到对应 Skill。剧本阶段固定执行内置 `short-drama` + `write-drama-episode` + `humanizer` + `review-drama-script`；剪辑阶段固定执行内置 `remotion-best-practices` + `edit-drama-timeline`。上游选版、配置、时间线或审片变化会自动回退受影响阶段；`workflow.mjs complete` 会复查全部阶段。交付 manifest v2 同时锁定时间线、批准审片、成片和字幕的哈希。

## 验证

```bash
node scripts/audit-plugin.mjs
node scripts/integration-self-check.mjs --self-check
node scripts/validate-project.mjs /absolute/path/to/project
```

GitHub Actions 会在每次 push 和 PR 中检查脚本语法、JSON、插件审计、构图词表、工作台与集成自检。打标签前可在本地运行同一组核心门禁：

```bash
node scripts/audit-plugin.mjs
node scripts/composition-vocabulary.test.mjs
node scripts/studio.test.mjs
node scripts/integration-self-check.mjs --self-check
```

逐模型真实冒烟测试会产生费用，只有用户明确确认后执行：

```bash
node scripts/generation/live-smoke-test.mjs --confirmed --output /absolute/path/to/output
```

该脚本会对内置图片、视频和音频模型各调用一次，轮询视频到终态，下载本地文件并生成 `report.json`。

## 进一步阅读

- [Skill 总索引](skills/short-drama-skill-index/SKILL.md)
- [项目规范 v1](references/project-spec-v1.md)
- [本地生产合同](references/pipeline.md)
- [能力审计](references/feature-completeness.md)
- [提示词与 Skill 索引](references/prompt-skill-index.md)
- [剪辑工作流](references/editing-workflow.md)

## 许可证

项目使用 [MIT License](LICENSE)。`skills/humanizer/` 保留其原作者版权声明与独立 [MIT License](skills/humanizer/LICENSE)。
