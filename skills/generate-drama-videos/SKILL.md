---
name: generate-drama-videos
description: 通过用户选择的生成 Provider 提交并查询短剧视频镜头。用于 StarRouter、RunningHub 等视频生成、并发控制和单镜恢复。
---

# 生成短剧视频

开始视频制作前，对本次待提交镜头逐镜按制作计划校验分镜媒介：`storyboard_strategy.mode=image` 必须有当前图片分镜选版和八维审计；`mode=blender` 必须有当前白模选版、导演合同和七项验收，且白模登记时长、导演合同时长、制作计划时长完全一致。缺少或失败任意一项时停止；单镜重生成不被其他未提交镜头阻塞。每镜的 Provider、模型或工作流 ID、prompt_profile、input_mode、提示词、时长与参考绑定以当前 selected `video-prompts` 为准，分辨率/画幅/声音等参数以 project.json 已确认配置为准；MCP 逐镜硬校验一致后才提交，任何手工改词、改参数都会被拒绝。同一目标与输入指纹存在在途任务时禁止重复提交。

整集视频只允许按下面三次 MCP 调用成批完成，禁止逐镜让用户重复确认或手工拼接参考 URL：

1. **一次发布参考图**：需要公网 URL 的 Provider（StarRouter、Comfly）先调用一次 `ensure_reference_urls`（`project_root`、`episode_key`、service、expires_in、usage_scope 加四个确认布尔值）。调用前把将要公开的素材清单（资产 key@版本、用途、有效期、non-commercial/commercial-authorized）给用户看一次；有效收据自动复用、不重复上传。RunningHub 直接上传本地文件，不发布。视频/音频参考不在批量发布范围，对应镜头改用单次 `submit_video` 传已授权公网 URL。
2. **一次费用确认**：调用 `submit_episode_videos`，先 `confirmed:false`。MCP 返回逐镜费用摘要（镜号、Provider、模型、时长、分辨率/画幅、参考数、总时长）和逐镜校验错误。把摘要原样给用户，确认费用后再以 `confirmed:true` 提交；MCP 在同一次调用内并发提交全部通过校验的镜头，单镜失败（权限、余额、审核、schema、在途冲突）只记入 failed，不阻塞其他镜头，也不自动重试或换模型。
3. **一次整集等待**：调用 `await_episode_tasks`（可选 `timeout_seconds`，默认 480、上限 540）。MCP 在服务端并发轮询全部在途镜头，pending 会刷新本地任务状态与时间，completed 自动下载登记候选并回写（含成片宫格检测标记），failed 原样返回错误，超时返回 pending 清单；`automation_mode=true` 时立即用同一参数续调直到整集终态，不得因单次 MCP 超时停止或再次询问用户；关闭全托管时才返回等待状态。不要逐镜 `get_generation_task`（仅限单镜恢复）。

只有单镜重生成或修复失败镜头时才使用单次 `submit_video`（传 `project_root`、目标视频资产 key 和 `{episode_key,version_id,shot_number}`）；它与批量调用共用同一套校验、快照、预登记和宫格输入扫描路径。

H3 `audio_policy.mode=native` 时，声音随视频一次生成，不再提交外部 TTS；必须核对逐秒对白、音乐锚点和相邻镜声音转场。只有制作计划明确为 post-dub/independent 时才调用独立音频 Skill。

多格分镜板（`panel_grid_size > 1` 的 `board-*` 选版）仅允许交给有独立语义参考能力的 Provider：Seedance 2.0 用 `full-reference`、H3 用 `Ref2VA`、其他模型用 `reference_image` 角色；此时 prompt 还必须包含固定反宫格声明和分镜板时间顺序条款。Comfly 只有一个参考图槽位，严禁整张提交多格板：必须用 `node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/media-tools.mjs" extract-grid-cell <分镜图> <项目/assets/other/.../vNNN.png> <列数> <行数> <格号> 85` 裁出当前镜头单格，再以 `created_by=codex`、`origin=transformed`、`source_assets` 指回分镜选版的方式登记为 selected `other-*`，并在视频提示词 references 中标记 `role=storyboard-frame`；MCP 会拒绝缺少该链路的付费提交。多格板同样严禁放进首尾帧像素槽位。成片检测若高置信命中宫格会写 `grid_high_confidence` 并禁止误报放行；中置信 `grid_suspect` 仍须完整观看后记录证据。身份合板不得混入分镜格。

整集所有无依赖镜头由 `submit_episode_videos` 一次确认后全量提交；RunningHub 同一 API Key 最多 2 路并发，超出的提交在适配器内排队，其他 Provider 由上游网关排队。再由 `await_episode_tasks` 在一次调用内并发轮询全部在途任务；completed 后 MCP 自动下载并登记候选版本、回写 `outputVersionId`，但不会绕过验收自动选版。单镜失败不阻塞无依赖镜头；权限、余额、审核、schema、模型能力或在途冲突错误不自动重试、换模型或换 Provider，定位修复后只对失败镜头单次 `submit_video` 重提。`get_generation_task` 仅用于单镜恢复。

RunningHub 内置 `minimax-h3-reference-to-video` 接受本地图片 0–9、视频 0–2、音频 0–2，适配器自动上传并注入专用 workflow；无需 `node_info_list`。Comfly `minimax-h3` 固定使用 Ref2VA，接受 1–3 张公开 HTTPS 参考图片或 1 段公开视频，二者互斥且不支持参考音频。两者都必须使用 H3 提示词合同。

## StarRouter 模型与枚举

- 2.0：`dreamina-seedance-2-0-fast-260128`、`dreamina-seedance-2-0-260128`、`doubao-seedance-2-0-260128`、`doubao-seedance-2-0-fast-260128`。
- 1.x：`doubao-seedance-1-5-pro-251215`、`doubao-seedance-1-0-pro-250528`、`doubao-seedance-1-0-pro-fast-251015`。
- MiniMax：`MiniMax-H3`、`MiniMax-H3-Max`。
- 2.0 固定参数：`prompt_profile=seedance2`；`input_mode ∈ {first-last-frame,full-reference}`；`duration ∈ {4,5,6,7,8,9,10,11,12,13,14,15}`；`resolution ∈ {480p,720p,1080p}`；`ratio ∈ {16:9,9:16,1:1,4:3,3:4}`；`fps=24`；`generate_audio ∈ {true,false}`；`watermark ∈ {true,false}`。
- 多模态全参考只允许适配器登记的 Dreamina 2.0 模型：图片最多 9、视频最多 3、音频最多 3、总数最多 12。1.x 使用 `prompt_profile=generic`，禁止视频/音频多模态引用；其时长、分辨率和画幅组合必须先以远端模型目录或真实探测确认，不从 2.0 推断。
- MiniMax 固定 `prompt_profile=h3`，`input_mode ∈ {T2VA,I2VA,FL2VA,L2VA,Ref2VA}`，`ratio ∈ {21:9,16:9,4:3,1:1,3:4,9:16}`。`MiniMax-H3` 支持 `size ∈ {768P,2K}`、4–15 秒和参考图/视频/音频；`MiniMax-H3-Max` 支持 `size ∈ {480P,768P}`、5–15 秒，但不支持参考素材与 Ref2VA。首尾帧使用 `first_frame/last_frame`，参考素材使用 `reference_image/reference_video/reference_audio`，两类模式互斥。
