# 本地短剧生产合同

标准流程固定为：

`analysis → script → director-book → asset-analysis → asset-generation → production-plan → per-shot image or Blender storyboard → videos/audio → editing → delivery`

`viral-recreation` 是该状态机的 profile，不是新增阶段。它在 analysis 内额外要求：本地文件或经授权确认的链接导入 → selected 本地参考视频 → `.short-drama/reference-video/prepared.json` → `.short-drama/reference-video-analysis.json` → `episodes/<episode>/recreation-workflow/selected.json` → `.short-drama/recreation-compiled/<episode>/<version>.json`。链接导入收据记录平台、作品 ID、规范链接、下载器、权利确认和本地 SHA-256，但不得保存 Cookie 或 API key。各产物必须按 source key、版本和 SHA-256 串联；编译约束包作为现有 brief、剧本、导演本、分镜、制作计划、音频和剪辑的机器可校验上游输入。

所有状态、文本、分镜和媒体都以用户指定的本地项目目录为事实来源，不调用或回写任何业务系统 API。

```text
<project>/
├── .short-drama/
│   ├── project.json
│   ├── state.json
│   ├── environment.json / RESUME.md
│   ├── skill-runs.json
│   ├── prompt-runs/<prompt-run-id>.json
│   ├── requests/<request-id>.json
│   ├── uploads/<upload-receipt-id>.json
│   ├── source-analysis.json / brief.json / bible.json / outline.json
│   ├── reference-video/prepared.json / reference-video-analysis.json（复刻 profile）
│   ├── reference-imports/<source>/<version>.json（链接导入收据）
│   ├── assets.json
│   ├── shot-reviews.json
│   └── tasks.json
├── source/
│   ├── manifest.json
│   └── src-<name>/v001.<ext>
├── episodes/<episode-key>/
│   ├── episode.json
│   ├── scripts/<version>.(json|md|txt)
│   ├── script-review/<version>.json
│   ├── director-book/<version>.json
│   ├── asset-plan/<version>.json
│   ├── production-plan/<version>.json
│   ├── video-prompts/<version>.json
│   ├── audio-plan/<version>.json
│   ├── recreation-workflow/<version>.json（复刻 profile）
│   └── storyboard/<version>.json
├── assets/{characters,scenes,props,storyboards,audio,videos,other}/
├── editing/ep-NNN/timeline.json / review.json
└── delivery/ep-NNN/
```

所有项目必须遵循 [项目规范 v1](project-spec-v1.md)：JSON 使用 snake_case 业务字段，项目 key 使用小写 kebab-case，分集使用 `ep-001`，版本使用 `v001`，媒体资产使用类型前缀并携带 provenance。

用 `node scripts/project-store.mjs init <项目目录> [项目元数据.json]` 初始化并执行 init 环境预检；进入媒体或剪辑阶段前再运行 `node scripts/preflight.mjs <media|editing> <项目目录>`。原始资料先用 `put-source` 或 `select-source` 归档，项目、简报/圣经/目录、分集、剧本和分镜均通过该脚本写入。每阶段先用 `node scripts/skill-runs.mjs required <项目目录> <阶段>` 获取并完整执行原子 Skill，完成后用 `record` 绑定项目内证据；同一阶段已有证据时可用 `record-stage <项目目录> <阶段>` 批量重算凭证。阶段检查、推进与回退使用 `node scripts/workflow.mjs <status|check|advance|rewind> <项目目录> [阶段]`；`advance` 会拒绝缺少 Skill 凭证、真实本地产物或验收的阶段。

初始化一次性创建资产、任务、逐镜审核和 Skill 账本。媒体 MCP 不信任聊天中的流程声明或手写 selected 文件：每次付费生成前校验当前阶段并重新检查所有上游阶段门禁；失败发生在请求快照和 Provider 访问之前。项目配置同时校验画幅—分辨率方向和 Provider 模型参数枚举。

图片、音频和视频生成成功后，必须立即用 `node scripts/asset-ledger.mjs <import|fetch|decode> ...` 把结果存入项目的 `assets/`，登记 SHA-256、文件大小、本地相对路径和 provenance，再允许选版或进入下游。独立配音先保存并选中 `audio-plan/vNNN.json`。资产生成与媒体制作阶段结束时用 `snapshot-stage-evidence.mjs` 生成不可变证据，避免后续合法修改总账导致早期凭证失效。远程 URL 只是临时传输结果，不得作为最终资产。

剧本阶段的 `short-drama` 必须绑定实际分集剧本版本；人物分析必须绑定 `assets/characters/profiles.json`。新项目默认 `storyboard.preferred_medium=blender`，制作计划仍逐镜选择：复杂空间、多人调度、动作接触、轴线风险和连续运镜优先白模；静态特写、细腻表演和画风确认使用图片。旧计划缺少 `storyboard_strategy` 时按图片分镜兼容。

图片分镜镜头要求对应 `board-epNNN-NNN` 已生成、选版并通过八维审计。白模分镜镜头先由 `direct-blender-previz` 写入 `episodes/<episode>/previz/shot-NNN-vNNN.json` 导演合同，再由 `generate-blender-previz` 渲染为 `other-previz-epNNN-NNN`，登记、完整观看、按七项 100 分合同验收并选版；总分低于 85 或任一单项低于 70% 时不得提交正式视频。两类分镜都不能替代正式视频所需的人物、场景和道具资产。

资产计划中的人物、场景或道具若已有 selected、未失效且不是 Provider 产出的本地版本，可直接复用；缺失、失效或由 Provider 生成/变换时，动态要求对应生成 Skill 与 `drama-generation-service`，防止 Provider 变换资产绕过执行凭证。

生成工具必须携带 `project_root`、`target` 和模态对应的 `prompt_document`。MCP 先核对项目已确认 Provider；视频与当前 selected 视频提示词逐字段一致，图片绑定当前资产计划/分镜和 Provider 提示词记录，音频绑定当前配音计划的逐字台词与音色。通过本地合同校验后，在访问 Provider 前自动保存实际调用参数到 `.short-drama/requests/` 并原子登记 `submitting`；同目标同输入已有在途任务时不会再次付费。视频实际路径逐项绑定清单资产版本，Litterbox URL 绑定提交时有效的本地收据。快照禁止密钥和内联媒体，不能手工覆盖。

只接受公网 URL 的 Provider 可按需使用 `publish-drama-references`。Litterbox 仅作匿名免费临时传输，时效固定为 1h/12h/24h/72h；上传写入 `.short-drama/uploads/` 收据并要求权利、公开风险及用途许可确认。同资产版本默认复用有效收据，剩余时效不足时才经确认强制重传；过期 URL 和上传收据都不能替代本地资产。

原系统的 LLM 提示词已按 [Codex 原生合同](codex-contracts.md) 固化在所属 Skill：Codex 直接执行合同，完成后用 `render-prompt.mjs --codex-output` 保存输入与实际产物；只有 `provider_prompts` 用 `--output` 渲染为媒体模型提示词。项目内所有 JSON 写入采用原子替换；新导演本、资产计划、制作计划、分镜、视频提示词、剧本和媒体版本不得覆盖旧版本。视频提示词先形成模型无关的镜头事实，再由同一 Skill 编译为 `seedance2`、`h3` 或已确认的 `generic` 协议，禁止跨协议混写。

使用 `node scripts/audit-plugin.mjs` 验证 Skill、提示词、人工索引与脚本引用。该检查不读取外部项目仓库。
使用 `node scripts/validate-project.mjs <项目目录>` 校验实际项目配置、目录、命名、来源、选版、资产 provenance、文件存在性和 SHA-256。
