---
name: edit-drama-timeline
description: 编辑短剧时间线并渲染成片。用于智能粗剪、镜头裁切与重排、字幕、转场、画面增强、声音优化、冲突合并和编辑器渲染；不生成源镜头。
---

# 使用 Remotion 编辑短剧时间线

先运行 `node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/preflight.mjs" editing <项目目录>`，完整执行插件内置 `remotion-best-practices`，再读取 [本地剪辑方案](../../references/editing-workflow.md)。剪辑门禁沿用成熟 CLI 方案：只导入逐镜四项验收通过的 selected 视频及其音轨，在项目 `editing/<episode-key>/` 中建立候选 `timeline.json`；用 `node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/editing-store.mjs" put-timeline <项目> <timeline.json>` 按 `episode_key` 校验每段选版、验收、路径、切点、转场和字幕后落盘，不覆盖源素材。

需要裁剪、换声、稳定、降噪、调色、局部修复、补帧、对口型或超分时，先切换到 `transform-drama-media` 执行统一媒体操作；时间线不得直接引用刚生成的候选。候选必须完成对应专项观察、结构化 QC 与完整观看，并由 `review_media_operation` 批准成为 selected 后才可导入。`dialogue_sync=lip-synced` 必须指向 provenance 为 `operation=lip-sync` 的同一 selected 版本，且 `.short-drama/shot-reviews.json` 中该精确 `asset@version` 必须是已批准的 `review_type=media-operation`、`operation=lip-sync` 记录；不能用原镜普通验收或另一版口型报告代替。对口型专项审核未通过时不得标记 `lip-synced`；超分专项审核未验证分辨率、时长帧率、音轨、脸手文字和运动伪影时，不得把高分辨率文件当成正式镜头。

字幕必须来自实际音轨转写并人工复核，不能用提示词冒充；有字幕时 timeline 必须写 `subtitle_source:{method:"asr"|"manual-transcription",reviewed:true,source_assets:[...]}` 并绑定 selected 实际音轨。模型提示词刻意禁字、但剧情依赖手机界面、倒计时、消息、地点或时间信息时，必须把这些内容作为确定性的 Remotion 图形层纳入时间线与完整审片。任何镜头的源区间与时间线区间相差超过 ±10% 时必须写 `retime_exception:{confirmed:true,reason}`；对白覆盖的镜头必须写 `dialogue_sync` 为 `native`、`lip-synced`、`offscreen` 或 `no-visible-speech`。超过 5 秒无任何音轨的区间必须补声音或写 `silence_exceptions`；只有对白/旁白而没有环境、音乐、音效或原生声轨时必须补声音设计或写 `sound_design_exception`。实际总时长超过目标 ±15% 必须写用户确认的 `duration_exception:{user_confirmed:true,reason}`。时间线按 [剪辑合同](../../references/editing-workflow.md) 保存并由 `editing-store.mjs put-timeline` 硬校验。每次渲染候选前执行 `freeze-edit-candidate.mjs create`；先渲染审片版，用 `media-tools.mjs qc <文件>` 生成结构化报告，将完整 JSON 放进审片记录 `qc`，再完整观看和听完后 `put-review`。只有 `qc.passed=true` 且六维审片通过才可交付。

字幕按正常电影样式制作，不做综艺/新闻花字：每条字幕保留 `speaker`（或双人对白的 `speakers`）供 SRT 元数据与审片使用，但默认 `show_speaker: false` 不在画面上显示说话人；只有画外音、电话等需要辨识声源的镜头才对该条设 `show_speaker: true`，双人对白带“- ”前缀。正文单一白色高对比字色、细黑描边加轻投影，不使用全片统一厚重黑色圆角贴纸或不透明底盒；下三分之一安全区不得遮挡脸、手和关键道具。每条最多 2 行，长句必须由时间线显式写入语义换行，Remotion 使用 `whiteSpace: pre-line` 保留，禁止自动换行产生单字/短词孤行；不要写句末 `。`/`.`（导出也会自动省略）。中文常规阅读速度控制在约 6–12 字/秒，停留不短于 700ms，快速回声可在不改变事实与语气的前提下压缩为等义短句。字幕入出点对齐帧栅格、按语音起止留 2–4 帧余量，连续对白按说话人切换而不是固定时长。候选冻结后用 `node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/export-edit-subtitles.mjs" export <冻结timeline> <候选.srt> <候选.ass>` 生成同版本外置字幕；导出逐条校验，任一不通过即整体拒绝并列出每条错误（超长、超字/秒、停留过短、重叠、越界等），修正时间线后重新导出，禁止手改 SRT/ASS 或复用旧候选文件。镜头衔接审查必须逐切点记录“上一镜动作/视线/声音如何把下一镜带入”；若计划写了转场但实现仍为硬切，必须修改时间线或计划，不能仅保留名义字段。涉及后期补画的剧情动作，必须在时间线记录 `effect`/`graphics`，并在全片审片中单独验证其空间方向、接触关系和遮挡边界。

导入时间线前检查所有候选镜头的分辨率、帧率、色彩空间和像素长宽比；低分辨率修复镜头先以可追溯的本地转码副本统一到成片规格，允许轻量 Lanczos 放大、锐化和色彩匹配，但不得覆盖资产库原文件。转码参数和来源版本必须进入剪辑记录，避免在 Remotion 渲染时临时、不可复现地处理。

未来来电、监听器和录音回放使用独立音轨覆盖原生对白区间：基础声纹必须与当前角色一致，只叠加约 300–3400 Hz 电话窄带、轻压缩/限幅和 2–4 帧淡入淡出。时间线记录被静音的原生区间与替换音轨来源，防止原声和替换声叠加；处理后逐角色 A/B 试听当前声与未来声是否仍能识别为同一人。

转场字段必须落到 Remotion：`fade` 使用 6–12 帧帧确定性 opacity 曲线，前一画面必须在底层延长或定格覆盖完整淡化区间，原生环境声同步做等长交叉淡化，不能出现“画面柔和、声音硬跳”；`action-cut` 只允许前后镜动作方向、主体姿态、空间位置与道具状态能连续承接，若同一造型人物跨地点或道具状态突变，应补建立镜头、重排或用有明确时空含义的短淡化，不能把“瞬移”标成动作切；`hard-cut`/`eyeline-cut` 保持零帧硬切，J/L-cut 通过独立音轨重叠实现。不得把所有切点统一套淡化。对每次转场记录选择该类型的叙事理由，并至少抽取切点前一帧、切点精确帧、淡化中点和完成帧，复核没有单帧黑闪、跳轴、声音跳变或动作断裂；仅依赖按秒联系表或长黑帧检测不能通过转场验收。
