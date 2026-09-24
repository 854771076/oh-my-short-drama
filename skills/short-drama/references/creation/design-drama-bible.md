# 设计故事圣经

读取本地 `brief.json`，原创扩写时使用本 Skill 的 `../../assets/modules/design-drama-bible/prompts/ai_story_expand.{zh,en}.txt`，并按需读取 [开场规则](../../../../references/writing/opening-rules.md)、[节奏曲线](../../../../references/writing/rhythm-curve.md)、[满足矩阵](../../../../references/writing/satisfaction-matrix.md)、[反派设计](../../../../references/writing/villain-design.md) 和 [卡点设计](../../../../references/writing/paywall-design.md)。输出 `bible.json`：故事规则、三幕结构、主配角外观与动机、关系、角色弧、冲突阶梯、伏笔回收、付费卡点和结局；用 `project-store.mjs put-document` 保存。

不得改变已确认的题材、语言和结局类型。这里只定义人物的剧情事实与弧线；结构化人物档案交给 `generate-character-profiles`，视觉候选交给 `generate-character-images`。
