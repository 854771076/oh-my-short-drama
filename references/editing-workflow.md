# 本地 Remotion 剪辑与交付

本方案保留成熟 CLI 流程的 selected 版本、逐镜四项验收、独立字幕、声音平衡、时间线 manifest 和全片验收门禁；执行层改为本地 Remotion。剪辑只读取本地 `assets.json` 中已选且通过逐镜验收的视频、音频和图片版本。涉及 Remotion 工程、React 标记、字幕或渲染时先使用 `remotion-best-practices`，按需读取其中 create、markup、captions 和 render 指南。

## 1. 入库与时间线

- 保留源文件，不原地修改。
- 用 `media-tools.mjs probe` 记录分辨率、帧率、时长、编码、采样率与声道。
- 在项目 `editing/<episode-key>/` 下维护该集候选 `timeline.json`；`segments[]` 记录镜头选版、入出点和 `{type,duration_frames}` 转场，`audio_tracks[]` 独立记录对白/旁白/环境/BGM/SFX/原生声轨及音量包络，`subtitles[]` 使用 Caption 合同，`labels[]` 记录人物角标、标题与片尾，`graphics[]` 记录必须由后期补齐的 phone-call/countdown/message 剧情图形层，`mix` 固化目标响度。用 `node scripts/editing-store.mjs put-timeline <项目> <timeline.json>` 按 `episode_key` 统一校验并落盘。
- `segments[]` 的 `shot_key` 与视频 `asset_key` 都必须使用 `shot-epNNN-NNN`；进入交付前必须按当前已选制作计划的镜号和顺序完整覆盖，不能漏镜、增镜或重排。
- Remotion 素材复制或链接到工程 `public/`，使用 `staticFile()`；视频与音频使用 `@remotion/media`，图片使用 `<Img>`。

## 2. 粗剪、字幕与转场

- 先按叙事因果建立粗剪，再裁掉无效开头、重复动作、动作回弹和空白尾帧；不得截断对白、呼吸、拟音或转场余量。
- 优先在动作峰值、视线落点、对白意群结束、声音瞬态或构图匹配点切换。J/L-cut 必须保持说话者清晰、口型不冲突。
- 字幕以实际音轨转写并人工复核，使用 Remotion `Caption` JSON：`text`、`startMs`、`endMs`、`timestampMs`、`confidence`。默认同时生成 UTF-8 SRT、ASS 和烧录字幕。
- 高级字幕基线：优先填写 `speaker`；说话人小号、正文高对比、细色线或轻量阴影，避免整片使用厚重黑色圆角底框。正文放在下三分之一安全区，长句按语义断行，入出点留 2–4 帧余量，不能遮住脸、手、关键道具或画内文字。
- 硬切、动作/视线/构图匹配优先；短淡化只用于时间、地点或情绪变化。常规淡化约 6–12 帧，不给所有镜头统一套转场。
- 每个切点都要有可核对的动作、视线、声音或空间轴依据；`transition` 字段不得替代真实实现。后期效果必须记录空间方向、遮挡边界和实际验收观察。

## 3. 声音与画面

- 先保证对白和旁白可懂，再平衡环境音、动作音和 BGM。只做可逆增益、EQ、降噪、压缩、限幅和短淡化。
- 无平台专门标准时，全片参考 -14 至 -16 LUFS，true peak 不高于 -1 dBTP，最终以完整试听无削波、泵动和人声遮盖为准。
- 统一画幅、帧率、色彩空间和像素长宽比；裁切不得伤及脸、手、关键道具、画内文字和字幕安全区。
- 低分辨率候选镜头先生成可追溯的本地规范化副本，再进入 Remotion；可使用 Lanczos 放大、轻微锐化和色彩匹配，不覆盖资产账本中的原始媒体，并记录输入版本与转码参数。
- 同角色的未来来电与当前对白共享同一基础声纹；电话感只用约 300–3400 Hz 窄带、轻压缩/限幅和短淡入淡出表达。替换电话音轨时必须静音原生对白的同一区间，记录来源和区间，并逐角色 A/B 验证。

## 4. Remotion 实现与交付

- 动画使用 `useCurrentFrame()` 与 `interpolate()`；禁止 CSS transition、CSS animation 和 Tailwind 动画类。
- 片段用 `<Sequence>` 表达帧起止，时间线参数集中由 `timeline.json` 驱动，不能把素材路径和切点散落在组件中。
- 先启动 `npx remotion studio --no-open` 预览，再输出低码率审片版；问题清零后运行 `npx remotion render` 生成交付版。
- 完整观看并听完最终文件，用 `node scripts/editing-store.mjs put-review <项目> <episode-key> <审片.json>` 保存 narrative、visual、audio、transitions、captions、technical 六项结论，再用 `node scripts/editing-store.mjs manifest <项目> <episode-key> <成片> <SRT> <ASS>` 生成带哈希的不可覆盖 manifest。每集 `delivery/<episode-key>/` 至少包含批准版视频、SRT、ASS、manifest、逐镜版本清单和验收记录，不包含缓存或未批准候选。

最小时间线骨架：

```json
{
  "episode_key": "ep-001", "fps": 24, "width": 1080, "height": 1920,
  "segments": [{ "shot_key": "shot-ep001-001", "asset_key": "shot-ep001-001", "version_id": "v001", "source_in_ms": 0, "source_out_ms": 5000, "timeline_start_ms": 0, "timeline_end_ms": 5000, "transition": { "type": "none", "duration_frames": 0 } }],
  "audio_tracks": [{ "asset_key": "audio-ep001-linwan", "version_id": "v001", "role": "dialogue", "source_in_ms": 0, "source_out_ms": 5000, "timeline_start_ms": 0, "timeline_end_ms": 5000, "volume_envelope": [{ "time_ms": 0, "gain_db": 0 }, { "time_ms": 5000, "gain_db": 0 }] }],
  "subtitles": [{ "text": "台词", "startMs": 100, "endMs": 900, "timestampMs": 100, "confidence": 1, "speaker": "林晚" }],
  "graphics": [{ "type": "countdown", "title": "剩余时间", "text": "00:10", "startMs": 100, "endMs": 900 }],
  "labels": [], "mix": { "target_lufs": -15, "true_peak_dbtp": -1 }
}
```
