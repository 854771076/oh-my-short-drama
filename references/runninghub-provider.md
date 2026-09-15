# RunningHub Provider 合同

RunningHub 既支持用户自己的通用工作流，也内置迁移自现项目的 Krea2 图片和 MiniMax H3 视频工作流：

- 环境变量：`RUNNINGHUB_API_KEY`、可选 `RUNNINGHUB_BASE_URL`，以及通用工作流的 `RUNNINGHUB_IMAGE_WORKFLOW_ID`、`RUNNINGHUB_VIDEO_WORKFLOW_ID`、`RUNNINGHUB_AUDIO_WORKFLOW_ID`。Krea2 默认工作流 ID 为 `2096515700701929473`，可用 `RUNNINGHUB_KREA2_WORKFLOW_ID` 覆盖；H3 默认平台工作流 ID 为 `2086743729407733762`，可用 `RUNNINGHUB_H3_WORKFLOW_ID` 覆盖。
- 本地参考素材先上传到 `/openapi/v2/media/upload/binary`。
- 任务提交到 `/task/openapi/create`，查询使用 `/openapi/v2/query`。
- 同一 API Key 的图片、视频和音频提交共用 2 个并发槽位；超出的请求在适配器内等待，任务查询不占用提交槽位。
- `node_info_list` 由工作流定义决定；字段值可使用 `@prompt` 和 `@asset:0`、`@asset:1` 等占位，提交前由适配器替换。

内置 H3 使用 `model=minimax-h3-reference-to-video`，不要求 `node_info_list`。本地 `reference_image_paths`、`reference_video_paths`、`reference_audio_paths` 会依次上传并注入内置 ComfyUI workflow；图片 0–9 张、视频 0–2 段、音频 0–2 段，纯文本零媒体也可用。统一入口会把 1–4 秒请求物化为 5 秒后再与已选提示词文档核对，因此落盘计划和快照的有效时长不得低于 5 秒；画幅为 `16:9|9:16`；分辨率为 `480p|720p|1K|2K`。工作流同时生成视频与原生音频。

内置图片使用 `model=krea2-normal-v1`，不要求 `node_info_list`。适配器把 prompt 注入节点 5，并按 `resolution=1K|2K` 与 `aspect_ratio=1:1|16:9|9:16|3:4|4:3|2:3|3:2` 设置节点 8；当前普通工作流不接受参考图。

选择 RunningHub 前，用户必须确认工作流 ID、覆盖节点、参考文件、预计费用和输出模态。视频还必须传入已选 `prompt_version`、prompt_profile、input_mode 和 reference_manifest；MiniMax H3 工作流必须使用 `h3` 及其真实 T2VA/I2VA/FL2VA/L2VA/Ref2VA 模式。T2VA 不带素材，I2VA/FL2VA/L2VA 分别绑定首帧、首尾帧、尾帧，Ref2VA 使用与类型一致的 `reference_image/reference_video/reference_audio`；适配器会在上传前核对数量、顺序和角色。插件不猜测节点 ID，也不把某个工作流的 schema 当成通用协议。查询任务时显式传 `media_type`，返回统一 `outputs[]`；全部远程输出仍必须下载进本地资产库。

通用图片工作流使用 `reference_paths` 时还必须提交等长 `reference_manifest`，逐项绑定本地 selected 图片版本和用途；清单只用于本地审计，不注入 RunningHub 节点。
