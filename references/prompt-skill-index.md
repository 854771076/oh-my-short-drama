# 本地提示词与 Skill 索引

所有文件都是插件内置静态资产，不依赖外部提示词目录、数据库或业务系统。先读取 [Codex 原生合同说明](codex-contracts.md)：文本类文件是 Codex 执行合同，不再作为 system prompt 发送给另一个 LLM；`skill-map.json` 的 `provider_prompts` 才是直接提交媒体模型的模板。Skill 决定何时加载哪一份，Codex 每次只处理当前原子步骤。

花括号变量是具名输入槽。文本步骤完成后，用 `node scripts/render-prompt.mjs --template <合同> --vars <输入.json> --codex-output <实际产物> --project-root <项目>` 留存合同、变量和产物；媒体模板用 `--output <本地提示词>` 渲染。输出文件已存在时默认拒绝覆盖；确认需要重渲染可追加 `--force`（提示词运行记录仍不可变新增）。缺少变量或包含密钥字段时失败。

| 原子产物 | Skill | 模板 |
|---|---|---|
| 单集资产分析 | `plan-drama-assets` | `asset_analysis` |
| 来源与要求分析 | `analyze-drama-source` | `source_analysis` |
| 创作简报 | `define-drama-brief` | `drama_brief` |
| 市场创作灵感 | `ideate-drama-from-market` | `market_inspiration` |
| 场次导演本 | `write-drama-director-book` | `director_book` |
| 剧本质量复核 | `review-drama-script` | `review_drama_script` |
| 逐镜制作计划 | `plan-drama-production` | `production_plan` |
| 艺术风格确认与配置 | `generate-drama-art-style` | `art_style_decision`、`config_generation` |
| 故事扩写 | `design-drama-bible` | `ai_story_expand` |
| 分集拆分 | `outline-drama-series` | `episode_split` |
| 剧本转换 | `write-drama-episode` | `screenplay_conversion` |
| 剧情片段 | `write-drama-episode` | `agent_clip` |
| 人物档案 | `generate-character-profiles` | `agent_character_profile` |
| 人物视觉候选 | `generate-character-images` | `agent_character_visual` |
| 创建人物描述 | `generate-character-images` | `character_create` |
| 修改人物描述 | `generate-character-images` | `character_modify` |
| 重生成人物描述 | `generate-character-images` | `character_regenerate` |
| 参考图修订人物 | `generate-character-images` | `character_description_update` |
| 图片反推人物描述 | `generate-character-images` | `character_image_to_description` |
| 完整角色原画设定板 | `generate-character-images` | `character_asset_sheet` |
| 场景提取 | `generate-scene-assets` | `select_location` |
| 创建场景描述 | `generate-scene-assets` | `location_create` |
| 修改场景描述 | `generate-scene-assets` | `location_modify` |
| 重生成场景描述 | `generate-scene-assets` | `location_regenerate` |
| 参考图修订场景 | `generate-scene-assets` | `location_description_update` |
| 多视角场景原画设定板 | `generate-scene-assets` | `scene_asset_sheet` |
| 关键道具提取 | `generate-prop-assets` | `select_prop` |
| 参考图修订道具 | `generate-prop-assets` | `prop_description_update` |
| 标准道具资产图 | `generate-prop-assets` | `prop_generate` |
| 分镜规划 | `build-drama-storyboard` | `agent_storyboard_plan` |
| 摄影设计 | `build-drama-storyboard` | `agent_cinematographer` |
| 表演设计 | `build-drama-storyboard` | `agent_acting_direction` |
| 分镜细化 | `build-drama-storyboard` | `agent_storyboard_detail` |
| 专业故事板约束 | `build-drama-storyboard` | `professional_storyboard` |
| 插入镜头 | `revise-drama-storyboards` | `agent_storyboard_insert` |
| 镜头变体分析 | `revise-drama-storyboards` | `agent_shot_variant_analysis` |
| 镜头变体生成 | `revise-drama-storyboards` | `agent_shot_variant_generate` |
| 分镜定向编辑 | `revise-drama-storyboards` | `storyboard_edit` |
| 单格分镜图 | `generate-storyboard-images` | `single_panel_image` |
| 宫格分镜图 | `generate-storyboard-images` | `panel_grid_image` |
| 手绘故事板 | `generate-storyboard-images` | `panel_storyboard_image` |
| 宫格单格增强 | `generate-storyboard-images` | `panel_grid_enhance` |
| 图片提示词修改 | `transform-drama-media` | `image_prompt_modify` |
| 二维转真人 | `transform-drama-media` | `2d_to_live_action` |
| 宫格视频提示词 | `write-drama-video-prompts` | `panel_grid_video` |
| 故事板视频提示词 | `write-drama-video-prompts` | `panel_storyboard_video` |
| Seedance 2.0 视频提示词 | `write-drama-video-prompts` | `seedance2_video` |
| MiniMax H3 视频提示词 | `write-drama-video-prompts` | `h3_video` |
| 声音分析 | `design-drama-audio` | `voice_analysis` |
| 通用音色推荐 | `design-drama-audio` | `character_voice_recommend` |
| 自然语言音色描述 | `design-drama-audio` | `character_voice_description` |

完整机器可读归属见 `skill-map.json`。运行 `node scripts/audit-plugin.mjs` 可验证全部中英文模板、全部 Skill 和人工索引保持一致。
