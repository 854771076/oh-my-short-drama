---
name: short-drama
description: 短剧剧本创作方法论。用于从创作简报、人物体系和分集目录编写单集剧本，并检查开场、节奏、爽点、钩子、付费卡点和合规；不负责项目存储或媒体生成。
---

# 短剧剧本方法论

本 Skill 是剧本阶段的必经方法层，产物仍由 `write-drama-episode`、`humanizer` 和 `review-drama-script` 落盘与验收。先读取项目已确认的 source-analysis、brief、bible、outline 和目标分集；不得另建 `.drama-state.json`，不得绕过本地项目状态机。

原创或授权改编按当前阶段读取：[题材指南](../../references/writing/genre-guide.md)、[开场规则](../../references/writing/opening-rules.md)、[节奏曲线](../../references/writing/rhythm-curve.md)、[爽点矩阵](../../references/writing/satisfaction-matrix.md)、[钩子设计](../../references/writing/hook-design.md)、[付费卡点](../../references/writing/paywall-design.md)、[反派设计](../../references/writing/villain-design.md) 和 [合规清单](../../references/writing/compliance-checklist.md)。不为凑方法论指标篡改忠实改编事实；集数、平台和付费策略未确认时保持未决。

单集必须具备：可拍的场景头与动作、角色可区分的对白、明确的本集目标和冲突升级、至少一个有效信息变化或情绪兑现、与全剧伏笔/人物弧一致的收束，以及能自然推动下一集的尾钩。开场尽快建立异常、冲突或承诺；每个节拍都应改变关系、信息、风险或选择。爽点和反派压力服务人物目标，不机械堆反转；旁白不重复可见画面。

动作节拍只写视频模型能稳定表现的单一可见动作及其结果，避免用抽象气氛、文学比喻、不可见心理、精细到难以控制的微位移或复合动作链代替画面。连续对白之间要留出有叙事作用的动作、反应或停顿；修改任一节拍后连读前后节拍，复核人物位置、在场关系和道具持有状态。忠实转换仍以来源事实为上限，不得为满足这些写作规则补造动作。

完成方法层检查后调用 `write-drama-episode` 生成初稿，再强制调用 `humanizer` 产生新版本，最后由 `review-drama-script` 复核开场、节奏、兑现、对白、连续性、制作可行性和合规。三者缺一不可；任何剧情事实、结局、人物关系或付费卡点变化先由用户确认。

剧本批准后把明确年龄、人物身份、造型变化原因、逐字对白/旁白和声音来源意图交给下游，不在本 Skill 内伪造媒体实现。主流程由人物吸引力与保护门禁开始，依次进入空间连续性与可选尾帧承接、原生声音及复听、受控兜底与可选口型、授权配乐、媒体修复/超分、交付；具体执行必须路由对应原子 Skill。
