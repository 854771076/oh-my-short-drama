# 使用本地短剧工厂

开始前完整读取 [使用手册](../../../../references/usage-guide.md) 和 [Codex 原生合同说明](../../../../references/codex-contracts.md)；创建、复制、迁移或修复项目时读取 [项目规范 v1](../../../../references/project-spec-v1.md)，需要查看状态机时再读取 [本地生产合同](../../../../references/pipeline.md)，需要核对与原项目的能力边界时读取 [能力审计](../../../../references/feature-completeness.md)。

新项目先确认最少必要配置；用户未指定其他绝对路径时，项目目录固定为 `~/darma_project/<project-key>`。未确认项保留 `null`，再调用 `manage-drama-projects` 初始化；原始小说或要求必须复制进 `source/` 并选定明确版本。既有项目先运行 `node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/validate-project.mjs" <项目目录>`，再读取 `.short-drama/project.json`、`state.json`、`tasks.json` 和 `assets.json`，只路由当前阶段所需的原子 Skill。无论项目位于默认工作区还是用户指定的绝对路径，初始化或恢复后都必须运行 `node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/studio.mjs" open-project <项目目录>`，打开该项目的 Dashboard 精确路由并生成 `.short-drama/dashboard.json`；不能把“服务器已启动”当成“项目 Dashboard 已打开”。

用户提供本地短视频并要求复刻时，将 `project.json.workflow.type` 设为 `viral-recreation`，用 `project-store.mjs put-source|select-source` 将 mp4、mov、webm 或 mkv 原片归档为 `reference-video`。复刻 analysis 的固定顺序是：打开项目 Dashboard → 引导用户在 Dashboard 配置图片、视频、音频 Provider → 运行 `provider-setup.mjs` 探活并留凭证 → 导入、选中并准备参考视频 → 用 Hypit 做中间理解并登记 handoff → 生成正式 `reference-video-analysis` → 生成 Script、Media、Caption、Speech、Film 五层 `recreation-workflow`。`analyze-reference-video` 因而分为“导入/准备”和“Hypit 后正式分析”两段执行，不能跳过或把 Hypit 推迟到正式分析之后。默认只做 `structure-only`；近似复刻必须由用户明确提供权利依据和范围。原片始终属于 source，不能登记成正式视频资产。

`viral-recreation` 自动且必须路由 `use-hypit-video` 做中间理解；无需用户再次点名 Hypit。只有完整运行时、SVML/SVS/SVRun、Hypit Studio、Build 或批量视频变体仍要求用户明确提出。该 Skill 首次使用会检查并按需安装官方 Hypit Skill 与 `@hypit/hypit`，安装后再交给已安装的官方 Skill 执行；不要把 Hypit 源码复制进本插件。

项目 `automation_mode` 默认开启；开启后 agent 自主处理常规确认，不重复打断用户，但不能伪造权限、素材权利或绕过安全门禁。

标准顺序是：初始化与环境预检 → 打开项目 Dashboard → Codex 分析小说与要求 → `short-drama` 方法论 + 剧本初稿 → `humanizer` 自然化新版本 → 剧本复核批准 → 导演本落盘 → 资产分析 → 人物吸引力/儿童保护审核与资产生成落盘 → 制作规划（逐镜选择图片或 Blender 白模分镜、拍摄计划、模型和提示词协议）→ 图片镜头生成/选版/八维审计，白模镜头编导/生成/评分 → 空间连续性与可选尾帧承接 → Seedance 2.0/H3/通用逐镜提示词落盘 → 原生声音生成和复听 → 仅对失败区间兜底、按需口型 → 授权配乐与媒体修复 → 对已选视频按需超分并复审 → `remotion-best-practices` + Remotion 剪辑 → 成片交付。新项目默认推荐白模，但静态特写、细腻表演和画风确认仍优先图片。每阶段必须先用 `skill-runs.mjs required` 获取原子 Skill，完整读取并执行，再用 `skill-runs.mjs record` 记录项目内产物；仅生成文件但没有 Skill 凭证不能通过阶段门禁。

文本资产全部由 Codex 直接创作和校验，不调用任何文本生成 Provider；媒体生成统一交给 `drama-generation-service`，由用户选择 Provider。Provider 只接受公网 URL 时，另行路由 `publish-drama-references`；Litterbox 免费但公开、临时且受用途条款约束。项目 `automation_mode=true` 时，已配置范围内的生成、上传、选版、覆盖、回退和切换按合同自动继续，不为常规步骤重复询问；`false` 时才逐项等待确认。真实付费、素材权利、安全事实和删除项目仍需明确确认，不能由 agent 代替授权；缺少这些条件时一次说明缺口并停在安全边界。阶段交付前再次运行项目校验。

若任务未暴露插件 MCP 工具，不得降级为占位素材或声称已生成；必须让用户使用 `⌘Q` 完全退出 Codex 后重新打开，使 `drama-generation` MCP 重新加载。安装、更新或修改 Provider 环境后，仅新建任务不够。
