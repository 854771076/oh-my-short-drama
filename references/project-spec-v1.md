# 短剧本地项目规范 v1

本规范是插件创建、继续、复制和校验短剧项目的唯一文件合同。文本资产由 Codex 使用各 Skill 内置提示词直接输出；图片、视频和音频才调用用户选择的 Provider。项目文件不得包含 API Key、Token、密码或 Authorization。

## 固定目录

```text
<project>/
├── .short-drama/
│   ├── project.json
│   ├── state.json
│   ├── environment.json
│   ├── environment/<timestamp>-<mode>.json
│   ├── skill-runs.json
│   ├── RESUME.md
│   ├── prompt-runs/prompt-<uuid>.json
│   ├── evidence/<stage>-<uuid>.json
│   ├── requests/req-<uuid>.json
│   ├── uploads/upload-<uuid>.json
│   ├── source-analysis.json
│   ├── brief.json
│   ├── bible.json
│   ├── outline.json
│   ├── art-style.json
│   ├── assets.json
│   ├── tasks.json
│   └── shot-reviews.json
├── source/
│   ├── manifest.json
│   └── src-<name>/v001.<ext>
├── episodes/ep-001/
│   ├── episode.json
│   ├── scripts/v001.(md|txt|json)
│   ├── script-review/v001.json
│   ├── director-book/v001.json
│   ├── asset-plan/v001.json
│   ├── storyboard/v001.json
│   ├── production-plan/v001.json
│   ├── video-prompts/v001.json
│   └── audio-plan/v001.json
├── assets/{characters,scenes,props,storyboards,audio,videos,other}/<asset-key>/v001.<ext>
├── editing/ep-001/{timeline.json,review.json}
└── delivery/ep-001/{final.mp4,final.srt,final.ass,manifest.json}
```

用户未明确指定其他绝对路径时，新项目统一位于 `~/darma_project/<project-key>`；Dashboard 与 `project-store.mjs init <相对项目目录>` 使用同一默认根目录。新项目还会在项目根创建 `AGENTS.md` 作为 Codex 的项目级恢复入口；若目录已有用户自己的 `AGENTS.md`，初始化不会覆盖。更换会话时只要从项目根或其子目录打开任务，SessionStart hook 会向上定位 `.short-drama/project.json` 并恢复阶段；从无关目录打开时必须显式给出项目路径。不要建立跨项目全局记忆，避免旧选版、旧 Provider 或旧阶段污染当前项目。

初始化必须原子创建 `assets.json`、`tasks.json`、`shot-reviews.json` 与 `skill-runs.json` 空账本。`format.resolution` 使用“宽x高”，方向必须与 `aspect_ratio` 一致；Provider、模型和 `parameters` 必须通过已注册目录校验。更新 Provider 参数时整组替换，不能残留上一模型字段。

每个版本目录通过 `selected.json` 指向当前入选版本。版本文件不可覆盖；剧本初稿、Humanizer 成稿和后续修改依次产生新版本。`script-review` 必须记录并匹配当前 selected 剧本版本，批准后才允许进入导演本。剪辑、审片和交付必须按 `ep-NNN` 分集保存，禁止多集共用 timeline 或 manifest。复制项目时保留相对路径，删除 `.short-drama/tasks.json` 中仍在运行的外部任务前必须先核对 Provider 状态。

资产计划包含人物时，必须先由 `generate-character-profiles` 生成并确认 `assets/characters/profiles.json`；计划中的每个规范人物名都必须存在于人物档案，不能用资产计划本身冒充人物档案执行证据。

`skill-runs.json` 记录每个阶段实际执行的原子 Skill、项目内证据及 SHA-256，并绑定该次 Skill 使用的 `prompt-runs` 记录与哈希。用 `skill-runs.mjs required` 获取当前阶段要求，完整读取对应 `SKILL.md`、运行所属 Codex 合同或 Provider 提示词并完成产物后，再用 `record` 登记；缺少正确执行模式或 `completion_prompts` 指定的最终合同会拒绝登记。局部细化、修改和推荐提示词不能冒充最终产物合同，也不能用同一个无关文件冒充多个关键 Skill 产物。证据或提示词运行记录变化后必须重新执行并登记。`workflow.mjs check|advance|complete` 会重新检查全部已完成阶段，而不只检查当前阶段。

选中新的来源、剧本、导演本、资产计划、分镜、制作计划、视频提示词或媒体版本，以及更新项目创作/Provider 配置、时间线或完整审片时，脚本会自动回退到最早受影响阶段并清除该阶段及之后的 Skill 凭证；`state.json.invalidatedAt` 保存各受影响阶段的最近失效时间。新 Skill 记录及其提示词运行必须晚于该时间，历史 `prompt-runs` 只供审计，不能重放为当前凭证。交付完成后执行 `workflow.mjs complete`，在 `state.json.finishedAt` 固化终态。

## 生成请求快照

文本资产不调用文本模型。Codex 按所属 Skill 与 [Codex 原生合同](codex-contracts.md) 直接制作；完成后 `render-prompt.mjs --codex-output` 将合同、合同哈希、完整变量、解析后的约束、实际产物和产物哈希保存为不可变 `.short-drama/prompt-runs/prompt-<uuid>.json`。合同本身不会自动执行，必须由阶段返回的原子 Skill 明确选择。只有 `skill-map.json` 登记的 `provider_prompts` 能使用 `--output`；脚本会拒绝 Codex 合同与 Provider 提示词混用。

图片、视频、音频 MCP 调用前会自动生成 `.short-drama/requests/req-<uuid>.json`，并在访问 Provider 前以请求 ID 登记 `submitting` 任务。本地参考文件必须位于当前项目 `assets/` 且逐项等于清单版本的真实路径；Litterbox URL 必须绑定提交时间点有效的同版本收据。视频必须引用明确的 `{episode_key,version_id,shot_number}` 提示词文档。快照保存实际提交给生成适配器的完整参数并计算稳定输入指纹；快照使用独占创建，不覆盖旧请求，失败和中断请求同样保留。

正式生成图片分别引用当前 `asset-plan` 的资产 key 或 `storyboard` 的镜号，音频逐句引用当前 `audio-plan` 的 `line_index`；入口在付费前核对选版、批准状态、提示词正文、逐字台词和音色绑定。仅 `other-*` 辅助图允许没有独立制作文档。临时发布到 Litterbox 的参考图另写 `.short-drama/uploads/upload-<uuid>.json`，记录本地资产版本、哈希、公开 URL 与到期时间；`list_reference_uploads` 可跨会话查询有效或过期收据。有效同版本收据默认复用，`force_reupload` 只在用户再次确认延长时效后使用。

生成 Provider、模型及项目级 `parameters` 必须与 `project.json.providers` 的已确认选择一致；调用未显式传参数时使用这里保存的默认值，显式传入不同值时在付费前拒绝。视频提交还会读取当前 selected、approved 且无未决项的 `video-prompts`，逐项核对目标镜号、模型/工作流、提示词正文、profile、输入模式、时长和参考素材清单；账本中的参考资产必须仍是 selected 版本。该校验发生在付费请求之前。

交付 `manifest.json` 当前为 v2：除成片、SRT、ASS 的相对路径、大小与 SHA-256 外，还固定记录 `editing/<episode>/timeline.json` 和已批准 `review.json` 的相对路径、大小与 SHA-256。任一输入或交付文件变化都会使交付门禁失败，必须重新审片并生成新的交付版本。

`.short-drama/tasks.json` 中每个任务必须包含 `requestPath`、`requestSha256` 和 `inputFingerprint`。生成资产只能绑定已完成任务，任务的 `outputVersionId` 必须指回该资产版本；请求、任务和 provenance 的目标、模态、Provider、模型、提示词文档、参数及视频参考素材版本必须一致。项目校验会重新核对这条完整证据链、请求文件 SHA-256 和密钥字段。API Key、Token、Authorization、密码、Secret 或超过 1MB 的内联媒体不得写入请求快照。

## `project.json`

初始化元数据和落盘配置使用相同的 snake_case 结构；`createdAt`、`updatedAt` 由脚本生成，初始化输入省略：

```json
{
  "schema_version": 1,
  "key": "my-short-drama",
  "title": "短剧名称",
  "automation_mode": true,
  "description": null,
  "format": {
    "aspect_ratio": "9:16",
    "resolution": "1080x1920",
    "fps": 24,
    "episode_count": 12,
    "episode_duration_seconds": 90
  },
  "languages": {
    "output": "zh-CN",
    "spoken": "zh-CN",
    "subtitle": "zh-CN"
  },
  "creative": {
    "adaptation_mode": "original",
    "genre": "都市情感",
    "tone": "现实、克制",
    "rating": "PG-13",
    "art_style": {
      "id": "system-realistic",
      "name": "真人风格",
      "description": "真实电影级画面质感，适合标准真人短剧制作。",
      "prompt": "Realistic cinematic look, real-world scene fidelity, rich transparent colors, clean and refined image quality.",
      "visualBible": { "version": 1, "palette": {}, "baseline": {}, "lighting": {}, "narrative_arc": [], "motion_language": {}, "negative_constraints": [] }
    }
  },
  "storyboard": {
    "type": "shot-board",
    "default_panel_grid_size": 4
  },
  "providers": {
    "image": { "provider": "starrouter", "model_or_workflow": "gpt-image-2", "prompt_profile": null, "parameters": { "resolution": "1K", "aspect_ratio": "1:1", "n": 1, "quality": "auto" } },
    "video": { "provider": "starrouter", "model_or_workflow": "dreamina-seedance-2-0-260128", "prompt_profile": "seedance2", "parameters": { "duration": 5, "resolution": "720p", "ratio": "9:16", "generate_audio": false, "watermark": false } },
    "audio": { "provider": null, "model_or_workflow": null, "prompt_profile": null, "parameters": {} },
    "music": { "provider": "starrouter", "model_or_workflow": "suno_music", "prompt_profile": null, "parameters": { "make_instrumental": false } }
  },
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

`automation_mode` 控制项目后续操作的确认策略，默认值为 `true`。开启后，Codex/agent 可自行判断并提交项目内的选版、批量范围、费用和重试确认，不再为每一步询问用户；但仍必须满足阶段门禁、权限/素材权利事实和安全校验，缺少这些依据时必须停下。设置为 `false` 时恢复逐项确认。

未确认的可选值写 `null`，不删除字段，也不使用示例值代替用户决策。例外是新项目画风默认使用 `system-realistic` 完整预设，分镜默认使用 `shot-board`（分镜板）和 4 格；用户可在资产生成前修改。制作计划仍须逐镜在 `single`（单图）、`storyboard`（故事版）和 `shot-board`（分镜板）之间判断，项目默认值只作回退。项目 key 创建后不可变。

## 命名

| 对象 | 格式 | 示例 |
|---|---|---|
| 项目 | 小写 kebab-case | `my-short-drama` |
| 原始资料 | `src-<name>` | `src-original-novel` |
| 分集 | `ep-NNN` | `ep-001` |
| 版本 | `vNNN` | `v001` |
| 人物 | `char-<name>` | `char-linwan` |
| 场景 | `scene-<name>` | `scene-office-night` |
| 道具 | `prop-<name>` | `prop-letter` |
| 故事板 | `board-<episode>-<shot>` | `board-ep001-shot001` |
| 视频镜头 | `shot-<episode>-NNN` | `shot-ep001-001` |
| 音频 | `audio-<episode>-<subject>` | `audio-ep001-linwan` |
| 其他 | `other-<name>` | `other-style-preview` |

key 表示稳定身份，名称、描述和文件可以更新，key 不随版本变化。

## `episode.json`

```json
{
  "key": "ep-001",
  "order": 1,
  "title": "第一集",
  "logline": null,
  "target_duration_seconds": 90,
  "status": "draft",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

`status` 只能是 `draft`、`approved`、`in-production`、`completed`。

`project.format.episode_duration_seconds` 与 `episode.target_duration_seconds` 都表示策划目标，不是要求成片精确卡秒的硬截止。默认实际成片可在目标值约 ±15% 内自然浮动；超过该范围需要记录叙事原因并重新请用户确认。平台明确规定最大时长时，以平台上限为硬约束。

## 来源与媒体版本

原始资料使用 `project-store.mjs put-source|select-source` 复制到 `source/`，并登记相对路径、文件大小和 SHA-256。分析文档通过 `src-xxx@v001` 引用，不保存原机器绝对路径。

每个媒体版本必须携带：

```json
{
  "id": "v001",
  "localPath": "assets/videos/shot-ep001-001/v001.mp4",
  "sizeBytes": 12345678,
  "sha256": "...",
  "provenance": {
    "origin": "generated",
    "created_by": "provider",
    "provider": "starrouter",
    "model_or_workflow": "dreamina-seedance-2-0-260128",
    "task_id": "remote-task-id",
    "prompt_document": { "episode_key": "ep-001", "version_id": "v001", "shot_number": 1 },
    "source_assets": [{ "key": "board-ep001-shot001", "version_id": "v001" }],
    "parameters": { "duration": 5, "resolution": "1080p", "ratio": "9:16" }
  },
  "createdAt": "2026-01-01T00:00:00.000Z"
}
```

`origin` 只能是 `imported`、`generated`、`transformed`。Provider 新生成和生成式改图分别使用 `generated`、`transformed`，两者都必须记录 Provider、模型/工作流、任务 ID 和制作文档引用；本地确定性变换使用 `transformed` + `created_by=codex` 并记录源资产版本，不伪造远程任务。所有引用都使用稳定 key 与明确版本。

资产记录可包含 `staleVersionIds`。项目画风变化时，人物、场景、道具、故事板和视频的既有版本会自动加入该集合并取消选版；已失效版本不能再次选择或通过阶段门禁。重新生成或重新导入应创建新 `vNNN`，不得清除旧版本的失效事实。

## 命令与校验

```bash
node scripts/project-store.mjs init <项目目录> <项目元数据.json>
node scripts/project-store.mjs put-source <项目目录> src-original-novel v001 <原文文件>
node scripts/project-store.mjs select-source <项目目录> src-original-novel v001
node scripts/project-store.mjs migrate-project-layout <项目目录> ep-001
node scripts/preflight.mjs <init|media|editing> <项目目录>
node scripts/render-prompt.mjs --template <合同> --vars <变量.json> --codex-output <实际产物> --project-root <项目目录>
node scripts/render-prompt.mjs --template <媒体模板> --vars <变量.json> --output <提示词文件> --project-root <项目目录>
node scripts/snapshot-stage-evidence.mjs <项目目录> asset-generation|media-production
node scripts/validate-project.mjs <项目目录>
node scripts/workflow.mjs complete <项目目录>
```

`preflight media` 按 `project.json.providers` 中实际选定的 Provider 逐一检查对应环境变量，不以“任意 Provider 有凭据”代替。每次预检除刷新当前 `environment.json` 外，还会保留带时间戳的历史报告；报告只保存布尔检查结果，不保存凭据。

旧项目只迁移配置时执行 `migrate-project-config`；脚本会先写入 `.short-drama/project.legacy.<timestamp>.json`。旧项目若仍把时间线、审片或成片直接放在 `editing/`、`delivery/` 根目录，执行 `migrate-project-layout <项目> <episode-key>`；脚本只移动不存在冲突的已知文件，并把旧 manifest 保留为 `manifest.legacy.<timestamp>.json`，随后必须重新审片并生成 manifest v2。旧版 `v1` 文件和无 provenance 资产不会被静默改名或伪造来源，必须人工核对后以 `v001` 重新登记。
