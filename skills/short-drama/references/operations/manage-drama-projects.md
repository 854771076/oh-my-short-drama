# 管理短剧项目

先确认交付语言、画幅和目标集。用户未明确指定其他绝对路径时，新项目统一初始化到 `~/darma_project/<project-key>`；相对项目目录也按该根目录解析。新项目按 [项目规范 v1](../../../../references/project-spec-v1.md) 准备元数据，再用 `node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/project-store.mjs" init <project-key|绝对目录> [项目元数据.json]` 初始化；默认根目录中的项目初始化成功后会自动启动并打开 Dashboard，方便用户浏览。初始化会运行环境预检并保存 `.short-drama/environment.json`，未确认字段保持 `null`。既有项目先用 `project` 回读，不得覆盖；旧版配置显式执行 `migrate-project-config`，脚本会保留备份。项目配置统一使用 snake_case，修改用 `update-project`，完成后运行 `validate-project-config`。

初始化必须同时产生空的 `assets.json`、`tasks.json`、`shot-reviews.json` 和 `module-runs.json`；任一缺失都视为初始化失败，不能手工补文件后继续。`aspect_ratio` 必须与 `resolution` 的宽高方向一致，例如 16:9 使用 `1920x1080`；Provider 参数必须来自所选模型枚举。切换模型时通过 `update-project` 提交完整的新 `parameters`，脚本会替换旧参数，避免残留其他模型字段。

原小说、梗概和授权资料先用 `put-source <项目目录> src-xxx v001 <文件>` 归档并 `select-source`，不得只记录原机器绝对路径。项目 key 使用小写 kebab-case，分集为 `ep-001`，文档和素材版本为 `v001`；各类资产 key 前缀遵循项目规范。

原始材料分析、简报、故事圣经和分集目录用 `put-document` 保存；分集用 `put-episode`、`update-episode` 和 `list-episodes`；剧本用 `put-script`、`select-script` 和 `script` 保存不可变版本；导演本、资产计划、制作计划、分镜和模型专属视频提示词用 `put-episode-document`、`select-episode-document` 和 `episode-document` 管理。文本由 Codex 按 [原生合同](../../../../references/codex-contracts.md) 完成后，用 `render-prompt.mjs ... --codex-output <实际产物> --project-root <项目>` 留存合同、变量和产物；媒体模型模板才使用 `--output`。所有文件都留在项目目录，写后立即回读；阶段结束运行 `node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/validate-project.mjs" <项目目录>`。禁止把令牌写入项目数据。

批量减少往返时，`put-episode-document <项目目录> <类型> <episode key> <版本> <JSON> --select` 可在写入后立即选定版本；不传 `--select` 时保持仅写入。
