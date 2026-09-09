---
name: manage-drama-projects
description: 在本地目录创建和管理短剧项目、分集、剧本与分镜版本。用于初始化、更新项目配置和维护剧集结构；不连接业务系统或执行内容生成。
---

# 管理短剧项目

先确认交付语言、画幅和目标集。用户未明确指定其他绝对路径时，新项目统一初始化到 `~/darma_project/<project-key>`；相对项目目录也按该根目录解析。新项目按 [项目规范 v1](../../references/project-spec-v1.md) 准备元数据，再用 `node scripts/project-store.mjs init <project-key|绝对目录> [项目元数据.json]` 初始化；默认根目录中的项目初始化成功后会自动启动并打开 Dashboard，方便用户浏览。初始化会运行环境预检并保存 `.short-drama/environment.json`，未确认字段保持 `null`。既有项目先用 `project` 回读，不得覆盖；旧版配置显式执行 `migrate-project-config`，脚本会保留备份。项目配置统一使用 snake_case，修改用 `update-project`，完成后运行 `validate-project-config`。

原小说、梗概和授权资料先用 `put-source <项目目录> src-xxx v001 <文件>` 归档并 `select-source`，不得只记录原机器绝对路径。项目 key 使用小写 kebab-case，分集为 `ep-001`，文档和素材版本为 `v001`；各类资产 key 前缀遵循项目规范。

原始材料分析、简报、故事圣经和分集目录用 `put-document` 保存；分集用 `put-episode`、`update-episode` 和 `list-episodes`；剧本用 `put-script`、`select-script` 和 `script` 保存不可变版本；导演本、资产计划、制作计划、分镜和模型专属视频提示词用 `put-episode-document`、`select-episode-document` 和 `episode-document` 管理。文本由 Codex 按 [原生合同](../../references/codex-contracts.md) 完成后，用 `render-prompt.mjs ... --codex-output <实际产物> --project-root <项目>` 留存合同、变量和产物；媒体模型模板才使用 `--output`。所有文件都留在项目目录，写后立即回读；阶段结束运行 `node scripts/validate-project.mjs <项目目录>`。禁止把令牌写入项目数据。
