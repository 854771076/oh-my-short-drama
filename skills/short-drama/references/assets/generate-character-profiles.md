# 生成人物档案

先运行 `node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/character-profiles.mjs" context <项目目录>`，将输出 JSON 作为 `characters_lib_info`；它是动态本地人物上下文，不是枚举。`input` 使用当前确认的小说或剧本文本。再用 `render-prompt.mjs` 渲染 `../../assets/modules/generate-character-profiles/prompts/agent_character_profile.{zh,en}.txt`：`character_profile_enums` 与 `character_profile_reference_vocabulary` 会从插件本地 [受控词表](../../../../references/controlled-vocabulary.json) 自动注入，不得由用户临时填写。

先合并别名、第一人称映射和关系，禁止把仅被提及或不出镜的对象建成人物。`performance_bible`、`voice_identity` 只记录原文明示或跨场景重复的长期特征；一次性动作、情绪和特效不得固化。每个角色至少保留初始形象，只有换装、年龄或持续造型变化才新增版本。

输出必须符合 [人物档案 Schema](generate-character-profiles/character-profile-output.schema.json)，且顶层只能有 `new_characters[]` 与 `updated_characters[]`。先运行 `node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/character-profiles.mjs" validate <项目目录> <结果 JSON>`；向用户展示新增、合并与冲突结果并确认后，才运行 `apply` 写入 `assets/characters/profiles.json`。人物事实确认后交给 `generate-character-images`；用户未确认前不得生成图片。
