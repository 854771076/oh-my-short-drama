# Codex 原生制作合同

原系统把文本制作规则包装成发给外部 LLM 的 system prompt；本插件不调用文本模型。迁移后采用以下语义：

- `skills/short-drama/SKILL.md` 是唯一执行入口；reference 模块说明当前能力的输入、判断顺序、确认点和落盘方式。
- 标有“Codex 执行合同”的模板是细化合同：其中 `{name}` 是具名输入槽，不是让 Codex 猜测的自然语言变量。Codex 从 Skill 指定的 selected 项目文件组装同名值，缺少值时停止或保留未决，不虚构。
- 合同中的“角色”描述只是专业职责边界，不建立第二个代理，也不把内容发给外部文本模型。
- Codex 完成输出后，用 `render-prompt.mjs --template <合同> --vars <输入.json> --codex-output <实际产物> --project-root <项目>` 保存合同快照、变量、解析后的合同和实际产物哈希。
- `module-map.json` 的 `provider_prompts` 才是直接渲染后提交给图片模型的媒体提示词；它们使用 `--output` 生成本地提示词，再由 `drama-generation-service` 提交。
- 一个模块有多个合同时，`module-map.json.completion_prompts` 指定能证明最终资产完成的合同；局部细化、修改和推荐合同只作辅助，不能单独通过阶段门禁。

文本合同与媒体提示词都必须留在所属模块，避免一个全局长提示词同时承担分析、剧本、分镜和生成。阶段编排只加载当前 reference，所以 Codex 不需要一次理解全部模板。

声音合同也必须来源可审计：`speech-timing` 固定来源资产版本与 SHA，`dubbing_contract` 固定原文/适配文、目标区间、意图、潜台词、完整情绪弧、重音、停连、呼吸和三轮策略。Provider 请求只能由当前合同编译，禁止调用方手写覆盖 voice 授权、合同版本或 timing 版本；最终审核记录必须绑定实际音频 SHA。
