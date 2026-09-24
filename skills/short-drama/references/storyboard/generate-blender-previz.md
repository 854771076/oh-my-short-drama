# 生成 Blender 白模分镜

只处理制作计划中 `previz_strategy.mode=blender` 的镜头。开始前必须已有当前 selected 结构化分镜、人物/场景/道具选版，以及 `direct-blender-previz` 生成的当前镜头白模导演合同；选择 `storyboard_strategy.mode=image` 的镜头还要求 selected 分镜图和八维审计。静态特写、表演细节或画风确认镜头优先保留图片分镜。

直接执行导演合同中的 JSON 场景。基础灰模使用 `cube`、`cylinder`、`sphere`、`human`；确有叙事需要时使用经过门禁的 `weapon` 与 `effect` 预设，不临时下载来源和授权不明的模型。人物位移区间使用 `walk` 保留落脚节奏，身体调度使用根节点 `rotation_degrees`，视线反应使用 `head_keyframes`，阻挡等关节动作使用 `arm_keyframes`；不在生成阶段重新解释剧情或改变相机动机。人物可以共用白色材质，但同框身份难辨时应使用稳定的色块或标签，不为预演制作精细模型、贴图和毛发。

渲染前读取当前制作计划并核对该镜时长；调用时必须把计划中的 `duration_seconds` 传给 `--expected-duration`，脚本发现合同不一致就停止，不生成可选版视频：

```bash
"${BLENDER_BIN:-blender}" --background --python "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/blender-previz.py" -- --spec <场景.json> --output <预演.mp4> --blend-output <场景.blend> --expected-duration <制作计划镜头时长>
```

人物默认使用插件自带的 `public/models/ue-mannequin-retopology.glb`，以便检查肩胯、手脚和关节动作；默认模型缺失时必须停止，不得静默退回程序化简模。只有用户明确指定其他兼容骨架时才传 `--mannequin-model <本地.glb>` 覆盖默认值。模型只用于本地渲染，不登记为项目资产，不上传给视频 Provider。

兵器用 `attach_to` 绑定 UE Mannequin 的 `left_hand` 或 `right_hand`，并以 `contact_checks` 检查 `tip`/`origin` 到对手骨骼或另一件兵器的距离。术法预设只表达发射、轨迹、碰撞和消散，不把辉光或粒子数量当成动作成立；施法者起手、目标反应、冲击点和镜尾结果仍须分别可读。预设字段与适用边界见 `direct-blender-previz/generate-blender-previz/weapons-vfx.md`。

没有 Blender 可执行文件但能安装官方 `bpy` Python 包时，可用 `uv run --python 3.11 --with bpy python <插件目录>/scripts/blender-previz.py ...` 验证无界面批处理。实际项目输出登记为 `other-previz-epNNN-NNN` 的 `other` 资产，版本文件落在 `assets/other/<key>/vNNN.mp4`；provenance 使用 `origin=generated`、`created_by=codex`、`model_or_workflow=blender-eevee-previz`，`prompt_document` 指向当前 storyboard 镜头，`parameters` 必须同时写入计划时长 `duration`、项目内导演合同路径 `direction_contract` 和该合同文件的 `direction_contract_sha256`。缺少任一绑定都不得登记候选。

MP4 生成成功不等于白模完成。登记和审核前必须用 `ffprobe` 核对 MP4 实际时长、平均帧率、帧数和分辨率与合同、制作计划一致，并重新核对 MP4 与合同 SHA-256；不能只相信 provenance 声明。随后完整观看，至少每 0.5–1 秒抽查一次，并在动作入点、接触点、完成点、每个多机位切点和镜尾逐帧核对；检查剧情因果与节拍、人物调度与表演、相机动机与运动曲线、构图与视觉层级、空间/轴线/连续性、物理与接触、技术交付七项。把媒体 `asset_sha256`、各项得分、P0/P1/P2 问题以及与导演合同同序的 `hard_gates[]` 写入 `shot-reviews.json`；每项硬门禁必须包含 `gate/status/frame/observation` 的实际逐帧证据，任一失败即不得选版。审核入口会在自动选版前重新验证合同路径与哈希、实际媒体参数和当前制作计划版本。正式镜头还必须给出真实来源剧本、导演本、结构化分镜和制作计划版本；没有真实来源的临时演示只能标记 `test_only`，不得判断“符合剧情”、不得选版或进入正式视频。

人数、身份、剧情因果、对白对象关系、轴线、物理接触、关键物可见性或剧本要求的镜尾反应任一未在实际画面中成立，都不得用合同字段或总分抵消。存在 P0/P1、任一硬门禁失败、总分低于 85/100 或任一项低于该项满分 70% 时，必须明确标记“不通过”，不得以“完成”“可用”或“已通过”交付；需要展示失败样片时必须同时展示审计结论。登记的 provenance `parameters.duration`、导演合同 `duration_seconds` 与制作计划镜头时长必须完全一致。通过后才可选中预演资产。`purpose=motion-reference` 当前只允许 RunningHub `minimax-h3-reference-to-video`，把 selected 预演版本作为 `type=video, role=reference_video` 的执行期派生引用写入新 video-prompts 版本；StarRouter 尚无可追溯的本地视频发布链，Comfly 白模路径明确不上传视频，两者当前都只允许白模作编导证据。
