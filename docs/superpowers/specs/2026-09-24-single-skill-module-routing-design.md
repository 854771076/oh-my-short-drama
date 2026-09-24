# 短剧插件单 Skill 与 Reference 模块化设计

日期：2026-09-24  
状态：设计已确认，待实施计划

## 1. 背景

当前插件向 Codex 暴露 47 个 Skill。它们覆盖项目管理、创作、资产、分镜、白模、生成、审核、剪辑、复刻和市场流程。能力边界虽然细致，但入口数量过多，容易造成 Skill 不易发现、相似 Skill 误选、阶段顺序依赖聊天判断，以及同一流程加载过多说明。

Hypit 已采用一个主 Skill 配合 `references/` 渐进披露的结构。本设计将短剧插件调整为相同模式：只暴露 `short-drama` 一个主 Skill，所有原子流程改为主 Skill 按项目状态和内容条件加载的 reference 模块。

本设计只改变 Skill 的发现、路由和凭证组织，不重写现有生成服务、项目文件、资产账本、媒体格式或外部 Provider。

## 2. 目标

- 插件清单只暴露一个 `short-drama` Skill。
- 主 Skill 根据项目、阶段、内容和失败状态选择必要 reference 模块。
- 每次只加载当前动作需要的模块，不把全部流程文档放入上下文。
- 原 Skill 名作为稳定 `module_id` 保留，减少状态机、提示词和旧项目迁移成本。
- 模块执行继续留下可验证的输入、输出、reference 哈希和提示词凭证。
- 普通短剧、Hypit 参考视频复刻、市场调研、白模和打斗流程继续工作。
- 旧项目可以从现有 `skill-runs.json` 安全恢复。

## 3. 非目标

- 不把全部子 Skill 正文直接合并进主 `SKILL.md`。
- 不在此次改造中重写九阶段业务流程。
- 不改变 MCP 工具名称、Provider API、资产路径或媒体生成协议。
- 不复制 Hypit 官方 references；短剧模块只负责何时调用 Hypit。
- 不保留 47 个隐藏或显式子 Skill 作为双入口。
- 不用模糊关键词扫描替代已有结构化项目事实。

## 4. 目标目录

```text
skills/
└── short-drama/
    ├── SKILL.md
    ├── agents/
    │   └── openai.yaml
    ├── references/
    │   ├── workflow/
    │   ├── creation/
    │   ├── assets/
    │   ├── storyboard/
    │   ├── generation/
    │   ├── review/
    │   ├── editing/
    │   ├── recreation/
    │   ├── market/
    │   └── operations/
    ├── assets/
    └── scripts/
```

分类职责：

- `workflow/`：初始化、九阶段编排、恢复、推进和回退。
- `creation/`：来源分析、Brief、故事圣经、分集、剧本、自然化、剧本审核和导演本。
- `assets/`：画风、人物档案、人物图、场景和道具。
- `storyboard/`：分镜、修订、制作计划、打斗、白模编导和连续性。
- `generation/`：Provider、图片、视频、音频、音乐、媒体变换和任务监控。
- `review/`：人物、图片分镜、白模、视频、声音和全片审核。
- `editing/`：时间线、剪辑、字幕、修复、超分和交付。
- `recreation/`：参考视频导入、Hypit、复刻迁移和权利边界。
- `market/`：市场报告和市场灵感。
- `operations/`：Dashboard、项目管理、资产管理和故障恢复。

## 5. 主 Skill

`skills/short-drama/SKILL.md` 是唯一被发现的入口，只保留：

- 能力范围和触发描述；
- 项目识别与恢复入口；
- 九阶段状态机；
- reference 路由规则；
- 权利、付费、版本、选版、凭据和媒体真实性等全局门禁；
- 模块执行和凭证记录协议；
- 阻断、恢复和交付边界。

主 Skill 不重复各模块的专业内容。路由表必须给出“何时读取”和“读哪个文件”，不能只列文件名。

## 6. Reference 模块

每个原 Skill 转换为一个或少量聚焦 reference。默认一项业务责任对应一个稳定 `module_id`，模块文件包含：

- 适用条件和排除条件；
- 必需输入和事实优先级；
- 输出合同与保存入口；
- 失败关闭条件；
- 所需脚本、提示词、资产或其他 reference；
- 验收和凭证要求。

Reference 不包含 YAML Skill frontmatter，也不拥有 `agents/openai.yaml`。其文件名可以比旧 Skill 名更贴合领域，但 `module-map.json` 必须保留旧名到新路径的唯一映射。

示例：

```json
{
  "design-fight-video": {
    "path": "skills/short-drama/references/storyboard/fight-direction.md",
    "stage": "production-plan",
    "condition": "structured-action-required"
  }
}
```

## 7. 路由模型

主 Skill 执行固定控制循环：

```text
读取 RESUME、project、state 和账本
→ validate-project
→ workflow status
→ required-modules
→ 按返回顺序读取 reference
→ 执行模块合同
→ record module-run
→ workflow check
→ advance / rewind / 等待外部任务
```

模块路由以结构化事实为主：项目类型、当前阶段、selected 文档、制作计划字段、任务和审核状态。只有尚无结构化字段且必须判定时，才读取当前选版剧本或导演本形成显式决策；该决策必须落盘，后续不能重复依赖关键词猜测。

### 7.1 打斗模块示例

`design-fight-video` 不再是 `production-plan` 的无条件模块。满足以下任一条件时进入：

- 导演本或制作决策明确声明 `action_complexity=choreographed`；
- 场次包含兵器对抗、追逐、擒抱、跌倒、多人攻防或能力战；
- 明确身体接触需要跨镜动作连续性、受力结果或空间路线设计。

普通争吵、静态对峙、普通行走、握手、推门和简单拿放道具不触发。扇耳光、推搡和短暂拉扯只有被导演本标为 `choreographed` 才触发。

触发后，分镜、制作计划、连续性、白模和视频提示词必须绑定 fight design 的模块运行 ID、输出路径和 SHA-256；未触发时不得制造空 fight design 作为凭证。

## 8. Module Map

`references/skill-map.json` 迁移为 `references/module-map.json`，成为模块注册、阶段顺序、提示词归属和质量门禁的唯一索引。至少包含：

- `modules`：module ID、reference 路径、阶段、条件和依赖；
- `stages`：每阶段基础模块的确定顺序；
- `prompts`：提示词到 module ID 的归属；
- `completion_prompts`：模块完成需要的提示词集合；
- `quality_gates`：跨模块审核链；
- `legacy_skill_map`：旧 Skill 名到 module ID 的迁移映射。

审计必须拒绝：重复 module ID、缺失 reference、未登记 reference、循环依赖、未知提示词 owner，以及已删除 Skill 的残留引用。

## 9. Module Run 凭证

新项目使用 `.short-drama/module-runs.json`。每条运行记录至少包含：

- `stage`、`module_id` 和完成状态；
- reference 相对路径和 SHA-256；
- 输入选版、输入文件和 SHA-256；
- 输出证据路径和 SHA-256；
- 绑定的 prompt runs；
- 完成时间和失效边界。

`requiredModules()` 计算当前模块，`recordModuleRun()` 校验 reference、输入和输出后写入凭证。`workflow check` 只接受当前阶段、当前输入版本和当前 reference 哈希对应的有效运行。

Reference 内容更新会使依赖它的 module-run 失效，但不应无差别使所有阶段失效。`module-map.json` 的依赖边决定最小回退范围。

## 10. 旧项目迁移

旧 `.short-drama/skill-runs.json` 保留只读，不删除也不原地改写。项目首次由新版恢复时：

1. 读取旧运行记录。
2. 通过 `legacy_skill_map` 找到 module ID。
3. 重新验证旧证据文件、SHA-256、选版和失效时间。
4. 能证明等价的记录写入新的 `module-runs.json`，并标记 `migrated_from_skill_run`。
5. 无法证明等价的模块保持未完成，由主 Skill重新执行。

迁移必须幂等。重复恢复不能生成重复记录，也不能把已经失效的旧凭证恢复为有效。

## 11. Prompt 与资源迁移

原 Skill 下的 `assets/prompts`、references 和专用脚本迁入主 Skill 对应目录。所有相对路径必须重新计算；生产代码读取资源时不得依赖旧 Skill 文件夹存在。

Prompt run 中的 owner 改为 module ID。旧 owner 通过迁移映射只读解析。提示词文本、输入变量和 Provider 行为不因目录迁移而改变。

共享的仓库级 `scripts/`、`references/` 和运行时资源不为追求目录整齐而搬迁；只有真正属于 Skill 指令包且不会被生产代码直接依赖的资源进入 `skills/short-drama/`。这避免无价值的大规模路径改写。

## 12. 支持能力的收拢

以下能力也不再独立显示为 Skill：

- Dashboard 与项目管理；
- Provider 配置和生成服务；
- 任务监控、资产管理和失败恢复；
- Hypit 复刻入口；
- 市场调研与灵感。

它们作为 references 由主 Skill 条件加载。MCP Server、CLI 和 Dashboard 本身仍保留独立运行入口，因为它们是工具而非 Skill。

## 13. 删除策略

迁移完成且所有引用通过审计后，删除其余 46 个 Skill 目录和各自的 `agents/openai.yaml`。不保留转发型 SKILL.md，因为它们仍会被发现并违背单入口目标。

删除前必须证明：

- module map 覆盖全部原 Skill；
- 所有正文、references、提示词和必要资产已有唯一新位置；
- 代码、测试、README、插件审计和 Skill 索引不再引用旧目录；
- 安装后的 Skill 列表只有 `short-drama`。

## 14. Dashboard 与工具边界

Dashboard 继续显示九阶段和真实项目数据，不显示 47 个 Skill。需要解释当前工作时，显示模块名称、状态和来源 reference。

MCP、Provider、RunningHub 并发、Blender、Hypit、资产账本和媒体审核继续复用现有实现。模块化只改变编排说明和完成凭证，不增加第二套任务系统。

## 15. 工作区保护

实施开始时若仓库已有未提交改动：

- 先记录完整状态；
- 不清理、不覆盖、不回退用户改动；
- 同一文件上的改动基于现状做最小增量；
- 每个提交只包含可明确归属于本重构的文件；
- 无法安全区分的重叠改动停止并请求用户处理。

## 16. 测试与验收

### 16.1 结构测试

- 插件清单只发现 `skills/short-drama/SKILL.md`。
- `module-map.json` 中每个 reference 存在且唯一。
- 除主 Skill 外不存在其他 Skill frontmatter 或 `agents/openai.yaml`。
- 所有相对链接和资源路径有效。
- 已删除 Skill 名只允许出现在 `legacy_skill_map` 和历史迁移测试中。

### 16.2 路由测试

- 每个九阶段返回确定、去重、有序的模块列表。
- 普通镜头不加载打斗、白模或修复模块。
- 复杂打斗加载 fight direction、连续性、适用的白模/动作审核模块。
- 图片与白模分镜按制作策略互斥加载。
- 原生音频通过时不加载配音兜底；失败区间才加载对应模块。
- `viral-recreation` 加载 Hypit references，但普通项目不加载。
- 市场模块只在用户请求或项目已绑定市场输入时加载。

### 16.3 凭证与迁移测试

- module-run 绑定 reference、输入和输出哈希。
- reference 或输入换版后只有受影响模块及下游失效。
- 有效旧 skill-run 能幂等迁移。
- 过期、缺失、篡改或不等价旧凭证不能迁移。
- 阶段门禁拒绝缺失 required module 的项目。

### 16.4 回归与端到端测试

- 全量现有测试通过。
- 插件自检和 Skill 验证通过。
- 普通短剧 smoke 完成九阶段路由。
- 含打斗和 Blender 白模的短剧 smoke 证明条件触发及下游绑定。
- Hypit 参考视频复刻 smoke 证明主 Skill 能路由下载、Hypit、生成、审核和交付。
- Dashboard、MCP、Provider、资产和交付路径保持兼容。

## 17. 实施顺序

1. 增加 module map、读取器、路由测试和 module-run 合同，不删除旧系统。
2. 建立主 Skill references 目录并迁移模块内容和资源。
3. 主 Skill 接管路由，状态机和门禁切换到 modules。
4. 实现旧 skill-run 到 module-run 的幂等迁移。
5. 更新 Dashboard、文档、审计和安装验证。
6. 在全部测试通过后删除 46 个子 Skill 入口。
7. 执行三条端到端 smoke，再发布新版本。

每一步必须采用测试先行并保留可独立回退的提交边界。删除动作只在新路由、凭证和迁移均已验证后执行。
