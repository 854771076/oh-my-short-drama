# 独立短剧插件能力审计

审计基线为原项目的标准短剧制作链、内置短剧提示词和相关资产/任务流程。原项目当前包含 284 个 API route，其中大量属于账号、团队、管理后台、支付、积分、云存储和在线资产库；这些不是本地短剧制作能力，不移植。

## 已保留并本地化

| 制作能力 | 插件实现 | 结论 |
|---|---|---|
| 项目、分集与版本 | `manage-drama-projects`、`project-store.mjs`、`project-spec-v1.md` | 固定目录、统一配置、来源归档、不可变版本、显式选版 |
| 小说/要求分析到剧本 | analysis、brief、bible、outline、`short-drama`、episode Skills | 文本由 Codex 完成；剧本强制经过短剧方法论、Humanizer 与复核 |
| 导演本 | `write-drama-director-book` | 场次导演合同单独保存 |
| 剧本自然化与复核 | `humanizer`、`review-drama-script` | 新版本落盘，复核版本必须匹配所选剧本；合规清单形成硬门禁 |
| 人物、场景、道具分析 | `plan-drama-assets`、三类资产 Skills | 证据化提取、版本和未决项门禁 |
| 人物/场景/道具设定板 | 各资产生成 Skill | 人物含脸部、三主视图与辅助设定；场景含九视角、平面/轴测；道具含主视图、三视图与结构细节 |
| 分镜与镜头修订 | storyboard/revision Skills | 资产白名单、来源覆盖、连续性与版本化 |
| 分镜图、视频提示词、镜头视频 | storyboard image/video Skills | 视频提示词按 Seedance 2.0、MiniMax H3 或已确认通用协议编译并本地版本化；由 Provider 实时能力控制参数 |
| 配音与声音方案 | `design-drama-audio` | 台词抽取、音色选择/描述、TTS 工作流和本地选版 |
| 生成服务 | `drama-generation-service` | StarRouter 图片/视频/语音、RunningHub 通用及内置 H3 workflow、Comfly H3；每个媒体版本保留完整 provenance |
| 临时参考图发布 | `publish-drama-references`、Litterbox 适配器 | 免费匿名短期 HTTPS URL、逐项确认、哈希绑定、本地上传收据、有效收据复用、并发去重和跨会话查询；不作为资产库 |
| 异步任务与恢复 | task ledger、monitor/recover Skills | 跨进程安全账本、输入去重、统一输出和结果对账 |
| 剪辑与交付 | `remotion-best-practices`、timeline/delivery Skills | 吸收成熟 CLI 的选镜、切点、字幕、角标、转场、响度与完整审片规则，并用 Remotion 实现 |
| 跨会话恢复与环境 | SessionStart hook、`RESUME.md`、`AGENTS.md`、`preflight.mjs` | 项目内恢复当前阶段、选版和任务；初始化及媒体/剪辑阶段留下无密钥环境报告 |

## 从原系统能力转换而来

- 数据库项目、剧集、分镜和资产表转换为项目目录、JSON 版本和 SHA-256 资产账本。
- 在线任务服务转换为本地任务账本；Provider 任务 ID 只作为外部回执，不是资产。
- 提示词数据库与 seed 转换为各原子 Skill 自带的中英文模板；固定词表集中在 `controlled-vocabulary.json`，动态项目上下文在调用时生成。
- 原项目 Provider 调用转换为独立 MCP 生成服务；文本不再绕到外部文本模型。
- 原 CLI 的 selected 版本、逐镜验收、字幕、声音平衡、时间线 manifest 和全片验收门禁保留，执行层使用本地 Remotion。

## 明确不保留

- 登录、用户、团队、邀请、权限、管理员后台。
- 支付、积分、套餐、价格发布和用量计费。
- 永久云对象存储、在线素材市场、全局共享资产库和业务数据库同步。只保留为模型传输服务的可选临时参考图发布。
- 在线模板 CRUD、提示词管理后台、通知、SSE 和 Web 页面状态。
- 无限画布、节点编辑器及其节点 ID 合同。

原项目四组制作提示词共有 45 个唯一 stem：38 个按原能力映射，`character_reference_to_sheet` 合并优化为人物完整 `character_asset_sheet`，`panel_h3_video` 重构为独立于画布的 `h3_video`；`cat_meme_*` 属于猫咪梗剧专项，`director_snapshot_render` 属于在线导演台快照，`project_cover_generation` 属于产品封面，`character_voice_recommend_cosy` 绑定单一音频供应商，这 5 个不进入标准短剧插件。插件另补 source analysis、brief、director book、production plan、script review、画风/资产完整设定板和 Seedance 2.0 等标准制作模板，当前合计 51 组中英文模板。

这些能力服务原产品 SaaS，不是“从本地素材到本地成片”的必要步骤；引入它们会重新耦合原系统。

## 当前边界

- StarRouter 当前声明图片、视频和 MiniMax 同步语音能力；长文本异步语音返回 TAR，尚未开放为可直接剪辑的音频资产。RunningHub 继续支持用户自定义音频工作流。
- 口型同步没有绑定某个厂商接口；需要用户提供具备该能力的 Provider 工作流，并在制作计划中明确参考视频、音频和费用。
- 插件不内置大型模型价格表或替用户估价；生成前读取实时 Provider 目录并要求用户确认费用影响。
- Litterbox 免费匿名接口仅用于临时参考图传输，文件公开且受 Catbox 使用条款约束；不保证长期可用，也不替代本地资产。
- Remotion 工程按项目创建，不在插件里复制固定业务工程；这样可保持素材路径、画幅、字幕和交付规格可追溯。

## 验证口径

`node scripts/audit-plugin.mjs` 必须同时验证 Skill 归属、全部中英文模板、变量对称、系统变量注入、无未替换变量、项目规范、Seedance/H3 专属合同、UI 元数据和原系统字段隔离。`node scripts/integration-self-check.mjs --self-check` 必须跑通九阶段门禁、来源归档、并发任务账本、资产 provenance 与选版、视频提示词版本、逐镜验收、时间线、完整审片、交付 manifest 和全项目校验；插件与每个 Skill 必须通过官方结构校验。
