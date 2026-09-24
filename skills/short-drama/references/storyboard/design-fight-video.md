# 设计打斗视频

用于当前分集存在近身冲突、兵器对抗、追逐或能力战时。读取已选剧本、导演本、人物/道具/场景资产与制作约束，输出一份可被 `build-drama-storyboard` 消费的 `fight_design` 对象，建议随制作计划一并保存为不可变版本。

先锁定不可被参考资料覆盖的事实：角色、武器、能力、动作顺序、胜负、时长、画幅、结尾和权利范围。参考资料只用于补充通用机制；零命中时按原创处理，不强行套案例。

每个关键动作必须写成：目的 → 起势/身体路径 → 对手响应 → 接触或落空 → 受力反馈 → 位移/状态结果 → 下一动作条件。每个空间阶段必须写起点、转向点、终点、观察轴和环境反馈；上一段末态必须成为下一段起点。一打多不得排队，终结必须来自前文形成的破绽。

动作与技能分开：能落到兵器、身体路径、接触结果或连续动作链的内容归入动作；只有具备独立“前置 → 发动 → 作用 → 终止”机制、且无法具体化为动作链的内容才归入能力。选用能力前必须检查法器、身体部位、介质和状态条件。

输出至少包含：`locked_facts`、`conflict_arc`、`character_signatures`、`action_beats`、`spatial_route`、`shot_plan`、`continuity_constraints`、`unresolved`、`approved`。`shot_plan` 每项包含 `shot_number`、`duration_seconds`、`narrative_purpose`、`camera`、`positions`、`action`、`handoff`；不得用模型平台语法、负面词、字幕或声音指令替代动作事实。

保存前运行：

```bash
node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/validate-fight-plan.mjs" <fight_design.json>
```

校验通过后，再将其中的动作事实转译到 `storyboard` 和 `plan-shot-continuity`；不要把 `fight_design` 当成正式视频提示词，也不要跳过逐镜审核。
