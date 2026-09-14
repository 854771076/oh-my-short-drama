---
name: monitor-drama-tasks
description: 用本地账本监控短剧异步生成任务。用于任务查询、滚动等待、去重、失败分类、有限重试和本地资产对账；不依赖业务系统或判断创作质量。
---

# 监控短剧任务

每个任务记录 `taskId`、本地目标 key、type、Provider、输入指纹、模型、提交时间、状态、尝试次数和输出版本；type 只能是 image、video、audio。付费调用前先登记 `submitting`，同一目标与输入指纹已有 submitting/queued/running 任务时禁止重提。“已提交”与“Provider 完成”都不等于本地资产已就绪。

生成 MCP 会在调用 Provider 前自动保存请求快照，并在响应后把任务与 `requestPath`、`requestSha256`、`inputFingerprint` 绑定，无需手工复制提示词或参数。轮询结果用 `update` 更新，恢复时用 `list` 回读；媒体任务完成时必须传已落盘的本地 `outputVersionId`。手工接入新 Provider 时先用 `task-ledger.mjs snapshot` 保存同样结构，再用 `put` 绑定任务；脚本会拒绝快照缺失、任务不一致、重复在途输入或本地完成版本不存在。

整集视频等待默认调用 `await_episode_tasks`（`project_root`、`episode_key`，可选 `timeout_seconds` 默认 480/上限 540、`poll_interval_seconds`）：MCP 在服务端按任务记录的 Provider/taskId 并发轮询该集全部 queued/running 视频任务，每次查询都会把 pending 写回为 running 并刷新本地时间；completed 时自动处理统一 `outputs[]`、下载导入为本地候选版本并原子回写 `outputVersionId`（同时跑成片宫格检测打标）；不自动选版，须先完成验收。超时后返回 pending 清单；`automation_mode=true` 时必须立即用相同参数续调，直到全部任务进入终态，不能把超时或无变化当作停止条件，也不能向用户重复询问；关闭全托管时才可返回等待状态。轮询瞬断不判失败。单镜恢复或图片/音频任务才按 Provider、taskId、type（作为 `media_type`）和 `project_root` 调用 `get_generation_task`。`submitting` 表示进程可能在远端调用期间中断，必须人工核对 Provider 后再标记失败，不能直接重提。无变化时退避。网络或外部任务短暂丢失最多重试原目标三次；401/403、余额、审核、schema、模型能力和语言门禁错误立即停下。取消先停调度器，再取消明确的 queued/running task ID，并回读到零。

Provider 状态与本地账本不一致时按 task ID、输入指纹和本地文件哈希对账；不能靠时间顺序猜测，也不能用重复提交修复状态。远端完成但文件尚未保存本地时保持 running，不得记为 completed。
