# RunningHub Provider 合同

RunningHub 既支持用户自己的通用工作流，也内置迁移自现项目的 Krea2 图片、MiniMax H3 视频和 SeedVR2.5 视频超分工作流：

- 环境变量：`RUNNINGHUB_API_KEY`、可选 `RUNNINGHUB_BASE_URL`，以及通用工作流的 `RUNNINGHUB_IMAGE_WORKFLOW_ID`、`RUNNINGHUB_VIDEO_WORKFLOW_ID`、`RUNNINGHUB_AUDIO_WORKFLOW_ID`。Krea2 默认工作流 ID 为 `2096515700701929473`，可用 `RUNNINGHUB_KREA2_WORKFLOW_ID` 覆盖；H3 默认平台工作流 ID 为 `2086743729407733762`，可用 `RUNNINGHUB_H3_WORKFLOW_ID` 覆盖。
- 本地参考素材先上传到 `/openapi/v2/media/upload/binary`。
- 任务提交到 `/task/openapi/create`，查询使用 `/openapi/v2/query`。
- 同一 API Key 的图片、视频和音频提交共用 2 个并发槽位；超出的请求在适配器内等待，任务查询不占用提交槽位。
- `node_info_list` 由工作流定义决定；字段值可使用 `@prompt` 和 `@asset:0`、`@asset:1` 等占位，提交前由适配器替换。

内置视频超分使用 `operation=video-upscale`、`model=seedvr2.5-video-upscale`，工作流固定为 `2099866760106491906`，不接受环境变量替换或手写 `node_info_list`。仓库映射来自 RunningHub 官方 `getJsonApiFormat` 导出，输入固定为节点 `25` 的 `video` 字段，输出固定为节点 `27` 的 `VHS_VideoCombine`；适配器只上传当前 selected 视频并覆盖这一项，禁止空节点试错或借用其他 SeedVR 工作流。该命名能力只列入 transform 目录，不列入普通视频生成模型。

超分完成后先保留 Provider 原始输出，再检查时长和帧率是否与来源一致；工作流映射未声明会改变这两项，因此漂移会被拒绝。若来源有音轨而 Provider 输出缺失，回写器以视频流复制和源音频 AAC 封装生成最终候选，并在 provenance 中同时记录原始输出版本/哈希和源音轨版本/哈希。候选仍不自动选中：必须做结构化 QC、完整观看并覆盖 `resolution,duration_fps,audio_preservation,faces_hands_text,motion_artifacts,color_crop` 六项专项观察。

真实冒烟先运行不带 `--confirmed` 的摘要命令：

```bash
node scripts/generation/live-smoke-test.mjs runninghub seedvr2.5-video-upscale "$SEEDVR25_PROJECT_ROOT" "$SEEDVR25_ASSET_KEY" "$SEEDVR25_VERSION_ID"
```

摘要会列出 selected 资产、SHA-256、时长、分辨率、帧率、音轨、上传事实、固定工作流和节点覆盖；RunningHub 工作流接口未提供免提交价格时会明确标记不可估价。只有用户针对这份摘要再次确认后才追加 `--confirmed`，随后轮询同一个任务 ID，禁止失败后静默重提。

内置 H3 使用 `model=minimax-h3-reference-to-video`，不要求 `node_info_list`。本地 `reference_image_paths`、`reference_video_paths`、`reference_audio_paths` 会依次上传并注入内置 ComfyUI workflow；图片 0–9 张、视频 0–2 段、音频 0–2 段，纯文本零媒体也可用。统一入口会把 1–4 秒请求物化为 5 秒后再与已选提示词文档核对，因此落盘计划和快照的有效时长不得低于 5 秒；画幅为 `16:9|9:16`；分辨率为 `480p|720p|1K|2K`。工作流同时生成视频与原生音频。

内置图片使用 `model=krea2-normal-v1`，不要求 `node_info_list`。适配器把 prompt 注入节点 5，并按 `resolution=1K|2K` 与 `aspect_ratio=1:1|16:9|9:16|3:4|4:3|2:3|3:2` 设置节点 8；当前普通工作流不接受参考图。

选择 RunningHub 前，用户必须确认工作流 ID、覆盖节点、参考文件、预计费用和输出模态。视频还必须传入已选 `prompt_version`、prompt_profile、input_mode 和 reference_manifest；MiniMax H3 工作流必须使用 `h3` 及其真实 T2VA/I2VA/FL2VA/L2VA/Ref2VA 模式。T2VA 不带素材，I2VA/FL2VA/L2VA 分别绑定首帧、首尾帧、尾帧，Ref2VA 使用与类型一致的 `reference_image/reference_video/reference_audio`；适配器会在上传前核对数量、顺序和角色。插件不猜测节点 ID，也不把某个工作流的 schema 当成通用协议。查询任务时显式传 `media_type`，返回统一 `outputs[]`；全部远程输出仍必须下载进本地资产库。

通用图片工作流使用 `reference_paths` 时还必须提交等长 `reference_manifest`，逐项绑定本地 selected 图片版本和用途；清单只用于本地审计，不注入 RunningHub 节点。
