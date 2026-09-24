# 编写单集剧本

当项目为 `viral-recreation` 时，先读取当前分集 `.short-drama/recreation-compiled/<episode>/<version>.json` 中 selected 版本，按其中的 `script.segments`、slots、权利范围和禁复制边界编写剧本；选版时 `project-store.mjs select-script` 会把当前复刻工作流版本写入 selected 标记并硬校验，不得从参考原片直接复制被要求转换的台词或身份元素。

本阶段必须先执行插件内置 `short-drama` 方法论，再由本 Skill 完成单集格式化。已有专业剧本直接复用。长篇改编先用 `agent_clip` 按真实剧情边界连续分段，再用 `screenplay_conversion` 逐段忠实转换；两者都显式传 output_language，原文、对白和旁白仍逐字保留来源语言。只转换原文明确存在的场景、动作、对白和旁白，不擅自扩写。原创时读取 [开场规则](../../../../references/writing/opening-rules.md)、[节奏曲线](../../../../references/writing/rhythm-curve.md) 和 [钩子设计](../../../../references/writing/hook-design.md)，遵守本地简报、故事圣经和分集目录的剧情事实。

输出 JSON、Markdown 或纯文本剧本，包含规范场景头、可见动作、逐字对白/旁白、出场人物与道具。校验后用 `project-store.mjs put-script` 保存不可变初稿；随后必须由 `humanizer` 产生新版本并由 `review-drama-script` 批准，才能进入导演本。
