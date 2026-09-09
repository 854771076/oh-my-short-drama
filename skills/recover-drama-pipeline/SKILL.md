---
name: recover-drama-pipeline
description: 恢复中断、失败或状态不一致的短剧生成流程。用于核对任务 ID、输入指纹、选版和下游 stale 状态。
---

# 恢复短剧流水线

先读本地 `.short-drama/state.json`、`tasks.json` 和 `assets.json`；对异步生成只调用 `get_generation_task` 并把任务记录的 type 作为准确 `media_type` 传入，不要先重提。按 Provider、输入指纹、任务终态、统一 `outputs[]` 和本地文件判断：在途继续等待，远端成功但本地缺文件时先重新下载，明确失败才评估重试。

网络失败最多重试原镜三次且指数退避；401/403、余额、审核、schema、能力或语言门禁错误停下修正。局部失败只暂停该镜。任何重新付费生成都必须重新确认，恢复过程不得读取或回写外部业务系统。
