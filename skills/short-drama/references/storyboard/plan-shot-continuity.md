# 规划跨镜连续性

读取当前 selected 且已批准的 `storyboard`、`director-book` 和 `production-plan`，并使用 `../../assets/modules/plan-shot-continuity/prompts/continuity_plan.{zh,en}.txt` 生成一份 `continuity-plan`。只采用这些文档、已选资产和已通过审核的白模导演合同中的证据；不得推断未声明的道具、持物关系、入画边、出画边或精确米制坐标。

默认使用 `coordinate_mode=semantic`，以画面左/中/右、前/中/后景、朝向、视线对象和出入画边表达语义位置。只有当前镜头存在已审核且版本匹配的 Blender 白模导演合同，才可使用 `blender-world` 并逐字复制其中的坐标；不得从分镜图透视或经验估算三维坐标。

逐镜记录 `camera_setup_id`、`start_state`、`end_state`、人物位置/姿态/运动方向/持物、道具状态、轴线、机位侧和主光锚点。对每组相邻镜调用 `continuity-plan.mjs` 导出的 `recommendTailLink(previous,current)`：仅同场景、同机位、同轴线且状态无未解释跳变时，才可启用 `previous-tail`；第一镜、切换机位、越轴、场景变化或有意状态跳变使用 `independent`。合法 previous-tail 必须绑定上一镜号、上一镜 `camera_setup_id` 和 `video.first-frame` 能力。

任何无法由证据解释的差异都写入 `unresolved`，并令 `approved=false`；不得把猜测写进 `allowed_changes` 以绕过校验。`allowed_changes` 只记录剧本、导演本或已批准调度明确要求的变化，`evidence` 指向相应来源。

用 `node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/project-store.mjs" put-episode-document <项目目录> continuity-plan <episode-key> <version> <文件>` 保存不可变版本。只有 `unresolved=[]` 且逐镜校验通过后才能写 `approved=true`，随后必须用同一脚本的 `select-episode-document` 显式选定；未选定的连续性计划不能进入视频提示词编译。

计划确定使用上一镜尾帧时，媒体阶段调用 `prepare_previous_tail`。上一镜视频换版后必须重新派生尾帧，不能继续使用旧文件或旧 SHA-256。
