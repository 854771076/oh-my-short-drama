# 白模导演合同与评分

## 合同结构

JSON 顶层同时保存编导依据和 Blender 可执行场景：

```json
{
  "schema_version": 1,
  "source": {
    "episode_key": "ep-001",
    "storyboard_version": "v001",
    "production_plan_version": "v001",
    "shot_number": 1,
    "storyboard_medium": "blender",
    "board_asset": null
  },
  "direction": {
    "dramatic_intent": "本镜造成的关系或信息变化",
    "primary_read": "观众第一眼必须读到的唯一信息",
    "axis": {
      "line": "轴线两端或运动方向",
      "camera_side": "相机保持在哪一侧",
      "screen_direction": "人物和动作的屏幕方向"
    },
    "beats": [
      {"name": "发现", "start_frame": 1, "end_frame": 12, "actor": "人物A", "action": "转头看向目标", "result": "目标被建立"}
    ],
    "camera": {
      "shot_size": "medium-wide",
      "lens_mm": 48,
      "principal_move": "slow_track_then_settle",
      "motivation": "跟随行动并在阻断点转移注意",
      "stop_frame": 80
    },
    "continuity": {
      "entry_exit": "人物从画面右侧进入",
      "eyelines": "人物A与人物B先看目标，再看人物C",
      "end_state": "人物C完成阻挡，目标仍可见"
    }
  },
  "review_contract": {
    "hard_gates": ["剧情因果", "人数与身份", "轴线与屏幕方向", "物理接触", "关键物可见"],
    "score_target": 85
  },
  "fps": 24,
  "duration_seconds": 5,
  "resolution": [640, 360],
  "cameras": [
    {"name": "建立镜头", "location": [0, -10, 3], "target": [0, 1, 1.2], "lens": 48, "keyframes": []},
    {"name": "人物A正打", "location": [2, -6, 2.2], "target": [-1, 0, 1.5], "lens": 62, "keyframes": []},
    {"name": "人物B反打", "location": [-2, -6, 2.2], "target": [1, 0, 1.5], "lens": 62, "keyframes": []}
  ],
  "camera_cuts": [{"frame": 1, "camera": "建立镜头"}, {"frame": 25, "camera": "人物A正打"}, {"frame": 49, "camera": "人物B反打"}],
  "objects": []
}
```

人物对象可使用：

- `heading_degrees`：初始朝向。
- `keyframes[].location/rotation_degrees/scale`：身体调度和视线转向。
- `head_keyframes[].rotation_degrees`：先由头部建立视线，身体随后跟随，避免用整个人体旋转冒充反应。
- `walk={start_frame,end_frame,step_frames,swing_degrees,phase_offset}`：位移期间的落脚节奏；同行人物用 `phase_offset=0|1` 错开半拍。
- `walk` 会让普通左右臂与腿反相摆动；`pose=block` 的阻挡臂仍由导演关键帧控制，避免步态覆盖表演动作。
- `pose=block`、`arm_rotation_degrees`、`arm_keyframes`：阻挡手臂从垂下到伸出的关节动画。
- `bone_keyframes[].rotations`：以 UE Mannequin 默认导入姿态为基准，按逻辑骨骼名填写 XYZ 旋转偏移，控制骨盆、脊柱、锁骨、上臂、前臂、手、大腿、小腿和足；武打优先使用它表达完整肢体链，旧 `arm_keyframes` 只用于简单阻挡兼容。不得把 Blender 骨骼本地绝对欧拉角直接写入合同。
- `hand_pose_keyframes[]`：按帧分别设置左右手为 `open`、`relaxed` 或 `fist`；武打默认用 `fist` 或 `relaxed`，不得让默认张开的手指冒充拳或护手。
- `color=[r,g,b]`：多人身份难辨时使用稳定的中性灰阶或低饱和色，不能随镜头变化。
- `shape=weapon`：`weapon_type` 支持 `sword`、`dao`、`spear`、`staff`、`shield`；用 `attach_to={object,bone,location,rotation_degrees}` 绑定人物左右手骨。武器局部 Z 轴由握柄指向尖端。
- `shape=effect`：`effect_type` 支持 `orb`、`beam`、`ring`、`burst`；使用普通 `keyframes` 控制位移、旋转和缩放，使用 `color` 与 `emission` 区分术法归属。

单机位摄影使用 `camera`；正反打、多机位覆盖使用具名 `cameras[]` 和从第 1 帧开始的 `camera_cuts[]`。每个摄影机的 `keyframes[]` 可分别设置 `location`、`target` 和可选 `lens`。正反打机位必须位于同一轴线侧，匹配相邻镜头的视线方向、头部留白和景别尺度；接触或命中优先回到能同时说明双方空间关系的机位。默认保持固定焦段；只有叙事需要透视变化时才给 `lens` 做关键帧。

白模模式允许 `board_asset=null`；图片模式引用白模时必须填写当前 selected 图片分镜。生成的白模资产 provenance 必须在 `parameters.direction_contract` 记录本合同的项目内相对路径，在 `parameters.direction_contract_sha256` 记录合同文件 SHA-256，并用 `parameters.duration` 记录制作计划时长。门禁会重新探测 MP4 的实际时长、平均帧率、帧数和分辨率，同时复核合同与媒体哈希，声明值不能替代实际媒体证据。

`beats` 必须按时间顺序排列；相邻节拍可共享一个边界帧或首尾相接，但不得倒序、被前一节拍完全覆盖或大段重叠。`review_contract.hard_gates` 至少完整包含示例中的五项固定硬门禁，不得用模糊名称删减。

`purpose=motion-reference` 时，合同 `duration_seconds` 必须与制作计划该镜 `duration_seconds` 完全一致；`beats`、人物与相机关键帧均不得超出该范围，并应覆盖镜尾停稳。白模、合同或登记 provenance 任一时长不一致，都不得选版或提交正式视频。当前只允许可直接绑定本地资产的 RunningHub `minimax-h3-reference-to-video`；视频提示词必须把当前 selected 白模登记为 `type=video, role=reference_video` 的执行期派生引用，该引用不回写制作计划 `reference_assets`。

武打合同还应提供 `contact_checks[]`，用双方人物逻辑骨骼或对象的 `origin`/`mid`/`tip`、接触帧和 `max_distance` 在渲染前验证接触距离；提供 `plant_checks[]`，用人物、左右足、帧段和 `max_drift` 验证支撑脚没有明显滑动。检查失败时生成器直接停止，不输出可选版视频。

## 评分

总分 100：

- 剧情因果与节拍 20：发现、反应、行动、结果顺序清楚。
- 人物调度与表演 15：朝向、视线、落脚、停步和动作归属可信。
- 相机动机与运动曲线 20：主运动明确，起步、减速和停稳服务剧情。
- 构图与视觉层级 15：首要信息突出，关键人物和道具不过度遮挡。
- 空间、轴线与连续性 15：地理、180 度轴线、屏幕方向和镜尾状态成立。
- 物理与接触 10：手、道具、目标的入点—接触—完成态可读。
- 技术交付 5：时长、帧率、画幅、编码和安全区正确。

任一硬门禁失败都不得用总分抵消。审核记录的 `hard_gates[]` 必须与导演合同同序，每项写入 `{gate,status,frame,observation}`，以实际帧证据决定 passed/failed。对白或对峙镜头还要检查对白对象关系是否可辨；剧本指定的镜尾反应必须由实际入画人物完成。评分只基于完整视频和逐帧证据，不以 JSON 中写过人物或动作作为完成证明。
评分结果写入逐镜审核账本，`score.breakdown` 的键和顺序必须与上表一致；总分至少 85，且每项至少取得该项满分的 70%。
