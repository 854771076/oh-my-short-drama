---
name: remotion-best-practices
description: 本地短剧 Remotion 剪辑与渲染规范。用于创建或维护 Remotion 工程、编写帧确定的 React 时间线、处理字幕和音视频、预览及渲染；不生成源素材。
---

# Remotion 短剧剪辑规范

本 Skill 是剪辑阶段的必经实现层。先运行 `node scripts/preflight.mjs editing <项目目录>`，再读取 [本地剪辑与交付规范](../../references/editing-workflow.md)。只接收逐镜四项验收通过且已 selected 的本地资产；保留源文件，每集时间线由 `editing/<episode-key>/timeline.json` 驱动并由 `editing-store.mjs` 校验。

没有 Remotion 工程时，在项目 `editing/` 下用 `npx create-video@latest --yes --blank --no-tailwind remotion` 创建；已有工程直接复用。素材放入工程 `public/`，用 `staticFile()` 引用；视频和音频使用 `@remotion/media`，图片使用 `<Img>`。Remotion 包统一用 `npx remotion add` 安装兼容版本。

所有动画和时间逻辑必须帧确定：使用 `useCurrentFrame()`、`useVideoConfig()`、`interpolate()`、`Easing` 和 `<Sequence>`；禁止 CSS transition、CSS animation 与 Tailwind 动画类。素材路径、入出点、音量、字幕和转场参数集中来自 timeline，不散落硬编码。剧情依赖而生成模型禁止或无法可靠绘制的手机 UI、倒计时、消息、地点和时间信息，必须由 timeline 驱动的 Remotion 图形层补齐并在完整审片中逐项核对。`segments[]` 驱动画面，`audio_tracks[]` 驱动可重叠的 J/L-cut 与音量包络，`labels[]` 驱动角标和标题。转场保存为 `{type,duration_frames}`；以硬切、动作切、视线切、构图匹配和 J/L-cut 为主，常规淡化只在明确语义下使用 6–12 帧。

字幕必须从实际成片音轨转写并人工复核，内部统一使用 Remotion `Caption` JSON：`text`、`startMs`、`endMs`、`timestampMs`、`confidence`，可附 `speaker` 和样式；同时输出烧录字幕、UTF-8 SRT 和 ASS。每条独立音轨记录 selected 资产版本、源/时间线范围、角色和 `volume_envelope`；混音固定 `target_lufs` 与 `true_peak_dbtp`。H3 原生整轨只允许轻量、可逆的增益、EQ、降噪、压缩、限幅与短交叉淡化，不得用外部 TTS/BGM 覆盖失败。

先用 `npx remotion studio --no-open` 预览，再用 `npx remotion render` 输出低码率审片版；完整观看和听完、保存六项审片结论后才渲染交付版。成片目标与转场、响度、角标、画面连续性和交付清单以 `editing-workflow.md` 为准。
