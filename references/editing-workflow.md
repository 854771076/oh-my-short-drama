# 本地 Remotion 剪辑与交付

本方案保留成熟 CLI 流程的 selected 版本、逐镜四项验收、独立字幕、声音平衡、时间线 manifest 和全片验收门禁；执行层改为本地 Remotion。剪辑只读取本地 `assets.json` 中已选且通过逐镜验收的视频、音频和图片版本。涉及 Remotion 工程、React 标记、字幕或渲染时先使用 `remotion-best-practices`，按需读取其中 create、markup、captions 和 render 指南。

## 1. 入库与时间线

- 保留源文件，不原地修改。
- 项目中的单集时长是策划目标而非精确截止；默认允许实际成片约 ±15% 自然浮动，超出时记录叙事理由并重新确认。Remotion composition 必须读取时间线实际总时长，不能硬编码 60 秒；动作完成、对白可读和结尾呼吸优先于机械卡点。
- 用 `media-tools.mjs probe` 记录分辨率、帧率、时长、编码、采样率与声道。
- 在项目 `editing/<episode-key>/` 下维护该集候选 `timeline.json`；`segments[]` 记录镜头选版、入出点和 `{type,duration_frames}` 转场，`audio_tracks[]` 独立记录对白/旁白/环境/BGM/SFX/原生声轨及音量包络，`subtitles[]` 使用 Caption 合同，`labels[]` 记录人物角标、标题与片尾，`graphics[]` 记录必须由后期补齐的 phone-call/countdown/message 剧情图形层，`mix` 固化目标响度。用 `node scripts/editing-store.mjs put-timeline <项目> <timeline.json>` 按 `episode_key` 统一校验并落盘。
- `segments[]` 的 `shot_key` 与视频 `asset_key` 都必须使用 `shot-epNNN-NNN`；进入交付前必须按当前已选制作计划的镜号和顺序完整覆盖，不能漏镜、增镜或重排。
- Remotion 素材复制或链接到工程 `public/`，使用 `staticFile()`；视频用 `OffthreadVideo`、音频用 `Audio`（均从 `remotion` 引入，时间裁切用 `trimBefore`/`trimAfter` 帧字段），图片使用 `<Img>`。
- 候选渲染前用 `freeze-edit-candidate.mjs create` 在 `editing/<episode-key>/candidates/<candidate-key>/` 冻结 timeline、Remotion 源码/依赖清单和全部引用媒体哈希；历史 manifest 只能指向该冻结快照，不能指向持续修改的工作时间线。

## 2. 粗剪、字幕与转场

- 先按叙事因果建立粗剪，再裁掉无效开头、重复动作、动作回弹和空白尾帧；不得截断对白、呼吸、拟音或转场余量。
- 优先在动作峰值、视线落点、对白意群结束、声音瞬态或构图匹配点切换。action-cut 必须同时连续承接动作方向、主体姿态、空间位置和道具状态；同一造型人物跨地点或道具突变时补建立镜头、重排或使用有明确时空含义的短淡化。J/L-cut 必须保持说话者清晰、口型不冲突。
- 字幕以实际音轨转写并人工复核，使用 Remotion `Caption` JSON：`text`、`startMs`、`endMs`、`timestampMs`、`confidence`，可附 `speaker`（字符串）、`speakers`（1–2 人，双人对白）和 `show_speaker`（布尔，默认 false）。候选冻结后用 `export-edit-subtitles.mjs` 从该候选的冻结 timeline 同步生成 UTF-8 SRT 和 ASS，禁止复用其他版本文件；导出逐条校验，任一字幕不通过就整体拒绝并返回每条的错误码，不生成半截文件。
- 电影字幕基线：默认不显示说话人（`show_speaker` 仅用于画外音、电话等需要辨识声源的镜头）；SRT 始终保留说话人元数据行，ASS 烧录默认隐藏。双人对白每条物理行前加“- ”且不叠名条。ASS 布局按时间线实际分辨率生成：PlayResX/Y 等于成片宽高，字号约画面高 1/28，左右下外边距约 8%；正文白色、细黑描边、轻投影（BorderStyle 1，无底盒），禁用厚重黑色圆角贴纸。每条最多 2 行，单行容量按分辨率换算（1080×1920 约 13 字），长句必须在时间线显式语义断行并由 Remotion `whiteSpace: pre-line` 保留，禁止自动折行产生孤字；导出自动省略每行句末的 `。`/`.`。中文常规阅读速度约 6–12 字/秒，导出拦截超过 12 字/秒和短于 700ms 的停留，快速回声只能等义压缩；入出点对齐帧栅格并相对语音留 2–4 帧余量（不对齐出警告，由人工修时间线）。字幕放在下三分之一安全区，不能遮住脸、手、关键道具或画内文字。
- 剧情图形按语义选择布局：来电人与倒计时使用顶部/侧边安全区 HUD；回传信息与对白字幕并存时只显示“目标/状态”等非重复信息，独立无对白插入镜头才用完整叙事卡片。图形可锚定手机、屏幕等剧情载体附近的非人脸区域，但不能遮住载体本身；不得所有 phone-call/countdown/message 图形共用居中大黑卡遮挡人物或关键道具。
- 硬切、动作/视线/构图匹配优先；短淡化只用于时间、地点或情绪变化。常规淡化约 6–12 帧，使用帧确定的缓出曲线，不给所有镜头统一套转场；剪辑前先确认动作因果和视线落点，不能用淡化掩盖生成镜头的逻辑断裂。
- 每个切点都要有可核对的动作、视线、声音或空间轴依据；`transition` 字段不得替代真实实现。后期效果必须记录空间方向、遮挡边界和实际验收观察。
- Remotion 实现约束：`fade` 只能用 6–12 帧帧确定性 opacity 曲线，并让前一画面在底层覆盖完整淡化区间；首尾相接的 Sequence 不能只淡入新镜头，否则切点会暴露黑底。原生环境声同步延长并做等长交叉淡化，动作/硬切保持零帧，J/L-cut 由独立音轨重叠表达；每个淡化至少复核切点前一帧、精确切点、淡化中点和完成帧，不能只依赖按秒联系表或长黑帧检测。

## 3. 声音与画面

- 先保证对白和旁白可懂，再平衡环境音、动作音和 BGM。只做可逆增益、EQ、降噪、压缩、限幅和短淡化。
- 无平台专门标准时，全片参考 -14 至 -16 LUFS，true peak 不高于 -1 dBTP，最终以完整试听无削波、泵动和人声遮盖为准。
- 统一画幅、帧率、色彩空间和像素长宽比；裁切不得伤及脸、手、关键道具、画内文字和字幕安全区。全片轻量色彩匹配参数必须写入 timeline 或剪辑记录，不能只硬编码在 Remotion 组件中。
- 低分辨率候选镜头先生成可追溯的本地规范化副本，再进入 Remotion；可使用 Lanczos 放大、轻微锐化和色彩匹配，不覆盖资产账本中的原始媒体，并记录输入版本与转码参数。
- 所有镜头级变换统一走 `submit_media_operation`，结果先作为未选候选保存。裁剪审核记录范围内、范围外、时长和音轨；替换音轨记录范围内、范围外、同步、声纹和时长；稳定、降噪、调色、遮罩模糊、补帧与局部重绘记录范围内、范围外、身份和时序连续；对口型记录同步时点、身份、口腔伪影、非目标脸和时长；超分记录分辨率、时长帧率、音轨、脸手文字、运动伪影和色彩裁切。每类操作都先保存 `media-tools.mjs qc` 完整输出并完整观看，再由 `review_media_operation` 选版；不得仅因任务成功或文件分辨率变大就导入时间线。
- 同角色的未来来电与当前对白共享同一基础声纹；电话感只用约 300–3400 Hz 窄带、轻压缩/限幅和短淡入淡出表达。替换电话音轨时必须静音原生对白的同一区间，记录来源和区间，并逐角色 A/B 验证。

## 4. Remotion 实现与交付

- 动画使用 `useCurrentFrame()` 与 `interpolate()`；禁止 CSS transition、CSS animation 和 Tailwind 动画类。
- 片段用 `<Sequence>` 表达帧起止，时间线参数集中由 `timeline.json` 驱动，不能把素材路径和切点散落在组件中。
- 预览用 `node scripts/render-edit.mjs render <项目> <episode-key> --preview`（底层 `remotion studio --no-open`），审片版与交付版统一用 `node scripts/render-edit.mjs render <项目> <episode-key> [--out <path>]`（底层 `npx remotion render`）；不要绕过脚手架手搓裸 `npx remotion render` 或 `npx create-video`。
- 完整观看并听完最终文件，先把 `node scripts/media-tools.mjs qc <成片>` 的完整 JSON 原样写入审片记录 `qc`，再用 `node scripts/editing-store.mjs put-review <项目> <episode-key> <审片.json>` 保存六项结论。QC 硬检音视频流、黑帧、长静音、长冻结、BT.709、响度和真峰值；批准记录必须 `qc.passed=true`。最后用 `node scripts/editing-store.mjs manifest <项目> <episode-key> <成片> <SRT> <ASS>` 生成不可覆盖 manifest；脚本核对 QC 成片哈希、分辨率和时长。后续审计发现 P0/P1 时必须再次 `put-review` 写入失败结论，使旧 manifest 因 review 哈希变化而失效。

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
