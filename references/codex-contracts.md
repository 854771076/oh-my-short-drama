# Codex 原生制作合同

原系统把文本制作规则包装成发给外部 LLM 的 system prompt；本插件不调用文本模型。迁移后采用以下语义：

- `SKILL.md` 是执行入口：说明何时调用、先读哪些本地资产、判断顺序、用户确认点和落盘方式。
- 标有“Codex 执行合同”的模板是细化合同：其中 `{name}` 是具名输入槽，不是让 Codex 猜测的自然语言变量。Codex 从 Skill 指定的 selected 项目文件组装同名值，缺少值时停止或保留未决，不虚构。
- 合同中的“角色”描述只是专业职责边界，不建立第二个代理，也不把内容发给外部文本模型。
- Codex 完成输出后，用 `render-prompt.mjs --template <合同> --vars <输入.json> --codex-output <实际产物> --project-root <项目>` 保存合同快照、变量、解析后的合同和实际产物哈希。
- `skill-map.json` 的 `provider_prompts` 才是直接渲染后提交给图片模型的媒体提示词；它们使用 `--output` 生成本地提示词，再由 `drama-generation-service` 提交。
- 一个 Skill 有多个合同时，`skill-map.json.completion_prompts` 指定能证明最终资产完成的合同；局部细化、修改和推荐合同只作辅助，不能单独通过阶段门禁。

文本合同与媒体提示词都必须留在所属 Skill，避免一个全局长提示词同时承担分析、剧本、分镜和生成。阶段编排只加载当前原子步骤，所以 Codex 不需要一次理解全部 51 组模板。
