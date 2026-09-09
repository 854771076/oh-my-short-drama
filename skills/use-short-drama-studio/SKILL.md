---
name: use-short-drama-studio
description: 使用本地标准短剧插件的总入口。用于了解每个 Skill 的用途、场景、关联、制作顺序和用户确认参数，或从小说开始/继续一个完整本地短剧项目；不直接替代原子 Skill。
---

# 使用本地短剧工厂

开始前完整读取 [使用手册](../../references/usage-guide.md) 和 [Codex 原生合同说明](../../references/codex-contracts.md)；创建、复制、迁移或修复项目时读取 [项目规范 v1](../../references/project-spec-v1.md)，需要查看状态机时再读取 [本地生产合同](../../references/pipeline.md)，需要核对与原项目的能力边界时读取 [能力审计](../../references/feature-completeness.md)。

新项目先确认最少必要配置；用户未指定其他绝对路径时，项目目录固定为 `~/darma_project/<project-key>`。未确认项保留 `null`，再调用 `manage-drama-projects` 初始化；原始小说或要求必须复制进 `source/` 并选定明确版本。既有项目先运行 `node scripts/validate-project.mjs <项目目录>`，再读取 `.short-drama/project.json`、`state.json`、`tasks.json` 和 `assets.json`，只路由当前阶段所需的原子 Skill。

标准顺序是：初始化与环境预检 → Codex 分析小说与要求 → `short-drama` 方法论 + 剧本初稿 → `humanizer` 自然化新版本 → 剧本复核批准 → 导演本落盘 → 资产分析 → 资产生成落盘 → 制作规划（分镜、拍摄计划、模型和提示词协议）→ Seedance 2.0/H3/通用逐镜提示词落盘 → 素材视频与按需配音 → `remotion-best-practices` + Remotion 剪辑 → 成片交付。每阶段必须先用 `skill-runs.mjs required` 获取原子 Skill，完整读取并执行，再用 `skill-runs.mjs record` 记录项目内产物；仅生成文件但没有 Skill 凭证不能通过阶段门禁。

文本资产全部由 Codex 直接创作和校验，不调用任何文本生成 Provider；媒体生成统一交给 `drama-generation-service`，由用户选择 Provider。Provider 只接受公网 URL 时，另行路由 `publish-drama-references`；Litterbox 免费但公开、临时且受用途条款约束。任何付费、上传、选版、覆盖、删除、回退或切换 Provider 前，按使用手册一次汇总最少必要参数并等待确认；阶段交付前再次运行项目校验。

若任务未暴露插件 MCP 工具，不得降级为占位素材或声称已生成；必须让用户使用 `⌘Q` 完全退出 Codex 后重新打开，使 `drama-generation` MCP 重新加载。安装、更新或修改 Provider 环境后，仅新建任务不够。
