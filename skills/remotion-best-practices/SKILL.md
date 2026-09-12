---
name: remotion-best-practices
description: 本地短剧 Remotion 剪辑与渲染规范。用于创建或维护 Remotion 工程、编写帧确定的 React 时间线、处理字幕和音视频、预览及渲染；不生成源素材。
---

# Remotion 短剧剪辑规范

本 Skill 是剪辑阶段的必经实现层。先运行 `node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/preflight.mjs" editing <项目目录>`，再读取 [本地剪辑与交付规范](../../references/editing-workflow.md)。只接收逐镜四项验收通过且已 selected 的本地资产；保留源文件，每集时间线由 `editing/<episode-key>/timeline.json` 驱动并由 `editing-store.mjs` 校验。

没有 Remotion 工程时，在项目 `editing/` 下用 `npx create-video@latest --yes --blank --no-tailwind remotion` 创建；已有工程直接复用。素材放入工程 `public/`，用 `staticFile()` 引用；视频和音频使用 `@remotion/media`，图片使用 `<Img>`。Remotion 包统一用 `npx remotion add` 安装兼容版本。composition 的 `durationInFrames` 必须从 timeline 实际尾点计算，不能把“一分钟短剧”硬编码为 60 秒；目标时长默认允许约 ±15% 自然浮动，平台明确限长除外。

所有动画和时间逻辑必须帧确定：使用 `useCurrentFrame()`、`useVideoConfig()`、`interpolate()`、`Easing` 和 `<Sequence>`；禁止 CSS transition、CSS animation 与 Tailwind 动画类。素材路径、入出点、音量、字幕和转场参数集中来自 timeline，不散落硬编码。剧情依赖而生成模型禁止或无法可靠绘制的手机 UI、倒计时、消息、地点和时间信息，必须由 timeline 驱动的 Remotion 图形层补齐并在完整审片中逐项核对；图形按语义分层，来电/倒计时使用不遮挡主体的顶部或侧边 HUD；回传信息若与对白字幕同时出现，只显示“目标/状态”等非重复信息的状态 HUD，只有独立无对白插入镜头才使用完整叙事卡片。图形优先锚定剧情载体附近的非人脸区域，但不得遮挡载体本身，不能所有类型套同一个居中大黑卡。`segments[]` 驱动画面，`audio_tracks[]` 驱动可重叠的 J/L-cut 与音量包络，`labels[]` 驱动角标和标题。转场保存为 `{type,duration_frames}`；以硬切、动作切、视线切、构图匹配和 J/L-cut 为主，常规淡化只在明确语义下使用 6–12 帧，并用 `Easing.out` 等帧确定曲线避免机械线性闪变。实现交叉淡化时，前一画面必须在底层覆盖完整 `duration_frames`，不能让两个首尾相接的 `<Sequence>` 只对新镜头做 opacity 淡入，否则切点首帧会暴露黑底；对应原生环境声必须同步延长并做等长淡出/淡入，避免视觉柔和但声音硬跳。每个切点先判断叙事因果、动作峰值和视线落点，再决定是否保留原生空白；不得靠连续淡化掩盖素材逻辑断裂。画面统一只允许可追溯的轻量色彩匹配（如饱和度、对比度、亮度微调），参数必须进入 timeline 或剪辑记录，不得散落在组件，也不得用全局滤镜抹平角色、时间或地点差异。

字幕必须从实际成片音轨转写并人工复核，内部统一使用 Remotion `Caption` JSON：`text`、`startMs`、`endMs`、`timestampMs`、`confidence`，可附 `speaker` 和样式；同时输出烧录字幕、UTF-8 SRT 和 ASS。字幕走正常电影样式，不做综艺/新闻花字：默认不显示说话人（只有画外音、电话等需要辨识声源的镜头在 Caption 上设 `show_speaker: true`），说话人名条用小号浅灰次级文字；双人对白用 `speakers: ["甲","乙"]`，每行以“- ”开头且不叠名条。烧录样式必须与 `export-edit-subtitles.mjs` 生成的 ASS 完全一致：PlayRes 取成片宽高，字号约画面高 1/28（1080×1920 为 69px、名条 39px），左右下外边距约 8%，白色正文加细黑描边（约 2px）和 1px 轻投影，不要任何不透明底盒或黑色圆角贴纸；名条描边 1px、无投影。每条最多 2 行、单行容量按分辨率换算（1080×1920 约 13 字），时间线中的语义换行用 `whiteSpace: pre-line` 保留，不能把长句交给浏览器自动折行而产生孤字；句末不显示 `。`/`.`。中文常规阅读速度约 6–12 字/秒，导出器拦截超过 12 字/秒和短于 700ms 的停留，短时回声只能等义压缩，不能为了塞入时间码改写剧情事实；入出点对齐帧栅格、相对语音留 2–4 帧余量。字幕不能遮脸、手、关键道具或画内文字，必须在缩小预览和安全区内复核。每条独立音轨记录 selected 资产版本、源/时间线范围、角色和 `volume_envelope`；混音固定 `target_lufs` 与 `true_peak_dbtp`。H3 原生整轨只允许轻量、可逆的增益、EQ、降噪、压缩、限幅与短交叉淡化，不得用外部 TTS/BGM 覆盖失败。

先用 `npx remotion studio --no-open` 预览，再用 `npx remotion render` 输出低码率审片版；完整观看和听完、保存六项审片结论后才渲染交付版。成片目标与转场、响度、角标、画面连续性和交付清单以 `editing-workflow.md` 为准。
