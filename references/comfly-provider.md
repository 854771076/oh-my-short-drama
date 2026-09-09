# Comfly Provider 合同

插件迁移现项目的 Comfly MiniMax H3 视频适配器，使用 `COMFLY_TOKEN`、可选 `COMFLY_BASE_URL`（默认 `https://vvicat-comfly-prod.vvicat.dev`）和可选非负整数 `COMFLY_APP_ID`。

- 模型固定为 `minimax-h3`，`prompt_profile=h3`、`input_mode=Ref2VA`，时长为 5–15 秒整数；不静默钳制或取整。
- 图片输入为 1–3 张：无自定义尺寸时对应工作流 1518/1519/1520；指定 `720p|1K|2K` 与 `16:9|9:16` 时对应 1540/1541/1542。
- 视频输入最多 1 段，对应工作流 1521；视频与图片互斥，不支持参考音频。
- 提交路径为 `/internal/comfly/tasks?model=comfyui&type=<workflow>`，查询路径为 `/internal/comfly/tasks/<task-id>`。

Comfly 当前合同只接受可公开读取的 HTTPS 参考地址，不直接读取本地文件。上传参考素材会改变外部状态；可路由 `publish-drama-references` 使用用户确认的 Litterbox 临时公开图，也可使用用户指定的其他存储。必须确认权利、公开风险、用途许可和到期时间后再传 URL；成片输出仍须立即下载到本地资产账本。不得把 `COMFLY_TOKEN` 写入项目、请求快照或 provenance。
