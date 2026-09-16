# 参考视频复刻工作流设计

日期：2026-09-16

状态：用户已确认

## 1. 目标

允许用户向短剧工厂提供一个本地短视频，由 Codex 将其拆解为带时间码证据的参考分析，并生成可执行、可修改、可继续派生变体的声明式复刻工作流。复刻工作流继续编译到现有剧本、资产、分镜、视频提示词、媒体和 Remotion 时间线，不另建第二套生产状态机。

## 2. 核心原则

- 复刻的是生产工作流，不是只输出一次性的分析或像素复制。
- 作者层使用台词段、词语和叙事节拍作为语义锚点；渲染层才解析成秒和帧。
- 参考原片属于 `source/`，不得登记为正式视频资产或被媒体门禁误认为成片。
- 现有九阶段保持不变；`viral-recreation` 只通过项目 profile 和条件 Skill 增加门禁。
- 旧项目缺少 profile 时按 `standard` 读取，不要求迁移即可继续使用。
- 未明确确认权利范围时可以分析原片，但只允许结构迁移；近似复刻、真人身份、声音、音乐和商标复用必须有明确权利依据。
- 所有分析、工作流、素材和成片都绑定本地文件、版本和 SHA-256；URL 和聊天描述不是事实来源。

## 3. 用户流程

```text
初始化 viral-recreation 项目
  → 导入并选择本地参考视频
  → 本地探测、镜头切分、关键帧和音轨准备
  → Codex 形成参考视频分析
  → Codex 形成声明式复刻工作流
  → 编译到现有 brief / script / director-book / storyboard / production-plan
  → 生成和选版素材
  → Remotion 剪辑与渲染
  → 复刻对照验收并交付
```

用户只需确认两类非自动事实：素材权利范围，以及复刻模式 `structure-only` 或 `authorized-close-recreation`。`automation_mode=true` 不能代替这两项确认。

## 4. 项目合同

`project.json` 新增兼容字段：

```json
{
  "workflow": {
    "type": "standard",
    "version": 1
  }
}
```

可用 `type` 为 `standard`、`viral-recreation`。切换 profile 从 `analysis` 失效。

视频来源沿用 `source/manifest.json`，来源对象新增 `kind: document|reference-video`；旧对象缺少该字段时按 `document`。参考视频版本继续保留 `localPath`、`sizeBytes`、`sha256`、`createdAt`，技术元数据保存在准备清单中，避免旧 manifest 版本合同扩张过大。

## 5. 本地准备清单

`.short-drama/reference-video/prepared.json` 记录：

- source key、version、SHA-256；
- 时长、画幅、分辨率、帧率、音轨；
- 场景切点和每个镜头的起止毫秒；
- 项目内关键帧路径及哈希；
- 可选音轨路径及哈希；
- 工具限制和结构化失败项。

准备命令只接受已选择的本地 `reference-video` 来源，不隐式下载 URL。镜头检测使用 ffmpeg scene score，并用固定间隔兜底；镜头数和抽帧数设上限。

选定复刻工作流后生成 `.short-drama/recreation-compiled/<episode>/<version>.json`。该编译约束包锁定 selected 工作流版本、工作流 SHA-256 与分析 SHA-256，并把 Script、Media、Caption、Speech、Film 五层提供给后续简报、剧本、导演本、分镜、制作计划、音频和剪辑 Skill；哈希漂移时 analysis 门禁直接失败。

## 6. 参考分析合同

`.short-drama/reference-video-analysis.json` 包含：

- `source_ref` 与准备清单哈希；
- `rights`：状态、允许用途、限制、确认时间；
- `technical`；
- `evidence[]`：时间范围、关键帧、转写、屏幕文字、观察；
- `structure`：钩子、节拍、转折、兑现和 CTA；
- `visual_grammar`：景别、构图、运镜、剪辑、字幕和声音规律；
- `replication`：保留机制、转换元素和禁复制元素；
- `confidence`、`limitations`、`coverage`、`open_questions`。

每个事实必须回链时间码或关键帧；推断和建议不能伪装成来源事实。

## 7. 声明式复刻工作流

`episodes/<episode>/recreation-workflow/vNNN.json` 分为：

- `slots[]`：hook、host、topic、product、price、cta、language 等可替换参数；
- `script.segments[]`：稳定 segment id、角色、台词和可选逐词对齐；
- `media_tracks[]`：素材槽位、用途和语义触发器；
- `captions`：样式和逐词高亮策略；
- `speech`：声音策略和对齐方式；
- `film`：画幅、尺寸、帧率和布局；
- `unresolved` 与 `approved`。

触发器绑定 `segment_id` 与可选 `start_word/end_word`，不得以裸秒数作为作者层唯一依据。编译或渲染后可以保存解析出的帧范围，但源语义锚点必须保留。

## 8. 状态机和 Skill

不修改 `workflow-stages.mjs`。当 profile 为 `viral-recreation`：

- `analysis` 条件增加 `analyze-reference-video`、`design-video-recreation`；
- analysis 门禁要求准备清单、参考分析和至少一集已选复刻工作流；
- 参考分析或已选工作流变化从 `analysis` 失效；
- 工作流必须绑定当前 selected 来源和当前分析哈希。

新增 Skill 使用 Codex 合同生成分析和复刻工作流；本地脚本只提供确定性媒体证据，不用脚本猜测叙事事实。

## 9. 安全与兼容

- 最大输入默认 2 GiB，场景切分最多 200 镜，关键帧最多 200 张。
- SHA-256 使用流式读取；不把完整视频读入内存。
- 输出路径必须位于项目根，ffmpeg 使用参数数组且不经过 shell。
- `rights_basis`、`rights_scope` 命名避免与密钥审计中的 `authorization` 冲突。
- 旧项目、旧来源 manifest 和 standard profile 的 required Skill 集合保持不变。
- 不直接复制 Hypit 源代码或把它作为运行依赖；只吸收声明式、语义锚点和可重编译思想。

## 10. MVP 验收

1. `project-store put-source` 能导入 mp4/mov/webm/mkv 并标记 reference-video。
2. `reference-video.mjs prepare` 对已选视频产生可校验准备清单、镜头关键帧和可选音轨。
3. 两类新文档合同会拒绝来源哈希漂移、裸秒触发、未决却批准和未授权近似复刻。
4. viral profile 动态要求两个新 Skill，standard profile 不受影响。
5. analysis 阶段会验证准备清单、分析和工作流的引用链。
6. 插件审计、集成自检、全部离线测试和三清单版本一致性检查通过。
