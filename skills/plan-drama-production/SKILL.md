---
name: plan-drama-production
description: 汇总本地导演本、已选资产和结构化分镜形成短剧制作计划。用于确定逐镜生成方式、Provider、模型、参考素材、声音、依赖、预算和验收顺序；不提交生成任务。
---

# 规划短剧制作

读取本地已选导演本、人物/场景/道具、分镜和项目配置。由 Codex 使用 `assets/prompts/production_plan.{zh,en}.txt` 输出 `production-plan.json`，逐镜记录：输入版本、分镜图类型、实际格数、视频方式、声音方式、Provider、模型或工作流、`prompt_profile`、`input_mode`、分辨率、画幅、时长、候选数、参考素材及其用途与顺序、依赖关系、预计付费次数、失败回退和验收项。每镜 `image_strategy.mode` 固定为 `generate`，不得跳过分镜图生成。

逐镜判断 `image_strategy.board_type` 和 `panel_grid_size`：静态构图、单一决定性瞬间或只需视频首帧锚点用 `single`（单图）且固定 1 格；同一连续镜头需要展示多个时间关键帧、动作阶段或运镜轨迹用 `storyboard`（故事版）；多人调度、对白反应、轴线、复杂动作或需要现场沟通多个叙事节拍用 `shot-board`（分镜板）。后两类由 Codex 按不可合并的叙事节拍判断 2–16 格，不按时长机械抽帧，也不机械套用项目默认 4 格。项目配置仅提供默认回退值 `shot-board` 和 4 格。视频引用顺序中分镜图优先占用一个图片槽位；其余人物、场景、道具超过 Provider 剩余图片槽位时，默认 `overflow_strategy=compose-assets`，使用 `media-tools.mjs compose-grid` 确定性拼为一张参考合板，并在 `reference_assets` 中只登记合板及其来源用途。用户要求保持素材独立时改为 `reject` 并把槽位不足写入 `unresolved`。

板型必须再按本分镜构图合同复核（`visual_plan.composition`、`composition_contract` 或 `photographyPlan.composition` 的 primary/secondary code、evidence 与 ai_risks；受控码见 `references/controlled-vocabulary.json` 的 `cinematography.compositionPatterns`，各模式风险族、证据门槛与 0.4 风险码表的权威解释见 [导演构图模式参考](../../references/director-composition.md)，板型、格数或证据门禁存疑时按其模式卡片核对）：静态单一情绪、一个决定性瞬间且无动作阶段或运镜变化（单人情绪、静止等待、留白反应）坚持 `single`；追逐、跃起、冲接触、雨战、余势收镜等要在一镜内交代动作阶段或运镜轨迹变化用 `storyboard` 按阶段定格；多人站位与朝向几何、对峙或桌边谈判、关系三角、包围/夹击/群体冲锋、依赖前景遮挡或窄门缝阅读、武器持有或接触动作、多手道具交互用 `shot-board`，把人数、站位、视线网、蓄力—接触—结果拆成可现场沟通的节拍。合同 ai_risks 命中的镜面/水面、雨雾霓虹烟尘、窄缝遮挡、高速拖影、竖屏裁切等风险只决定格数与回退，不得用增加格数替代证据。证据门禁先于板型：evidence 需要 set_dressing、weather_atmosphere 或 action_blocking（复合证据以 `+` 连接时逐组件成立）时，set_dressing/weather_atmosphere 必须有原文或已选场景/道具资产支撑，action_blocking 还可由已确认调度事实支撑，但调度事实不能替代天气/陈设所需的原文或资产证据；均无据时该镜不得按现状排产，`status=blocked` 并把缺失证据与构图 code 写入 `unresolved`，退回 `revise-drama-storyboards` 补证据或更换构图；图片/视频媒体模板对无证据高风险元素同样停止出片并退回分镜，制作计划不得靠板型或提示词措辞绕过。

每镜 `review_checks` 必须从合同 ai_risks 与证据元素反推具体、可观察、具名的验收项，不得复制同一组空泛检查：镜面/光滑水面核对映像与真人及现场陈设一致、无多指或多余摄像机；雨、雾、霓虹、烟尘核对天气光色有据、方向统一且不淹没接触点与人物身份；群体镜核对人数、身份和服色锚点、无多余路人；武器与多手交互核对形制、持有关系、手数和接触前/中/后；窄门缝或前景遮挡核对可见宽度、双眼完整和关键动作不被盖；高速拖影核对双眼、面部与接触点清晰可辨；前后夹击/包围核对前后景两方身份、距离和朝向可辨；竖屏镜头核对脸、关键道具和接触点位于中上安全区、底部字幕安全区不被占、动势边缘留余量。这些构图风险项与对白嘴部、道具三态、行走打斗物理、画内屏幕等既有风险项按命中取舍组合，视频验收会按此原顺序逐项核对。

文本策划全部由 Codex 完成，不调用外部文本模型。Provider、模型/工作流、尺寸、时长、候选数、参考文件、声音方式、预算上限和批量付费范围必须逐项展示；只有用户确认后才把 `approved: true` 写入计划。

MiniMax H3 仅在 Provider 能力明确声明原生音频且用户选择原生声音时，才使用 `audio_strategy.mode=native`，并锁定逐秒对白表、全片音乐锚点和相邻镜头成对声音转场；此时不安排独立 TTS。其他情况进入 `design-drama-audio`。

使用 `project-store.mjs put-episode-document <项目目录> production-plan <episode-key> <version> <文件>` 保存不可变版本。选定后必须先由 `generate-storyboard-images` 按逐镜类型和格数生成、落盘并选定整集分镜图，全部完成后才能调用 `generate-drama-videos`。计划不得包含 API Key、Token 或远程业务对象 ID。

复核时以 `shot-board` 作为复杂场面的推荐默认，但必须按每镜实际分镜合同确认板型：静态单一瞬间可用 `single`，连续动作可用 `storyboard`，多人调度、对白反应或复杂交互优先用 `shot-board`；不要为了追求类型分布而强行切换。只有分镜图加独立参考图实际超过 Provider 槽位时才使用 `compose-assets`，未超槽位保留独立参考图。项目 `automation_mode=true` 且仅缺 Provider 已支持的分辨率时，agent 直接选择并落档，不等待用户。
