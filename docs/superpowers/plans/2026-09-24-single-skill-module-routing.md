# 短剧插件单 Skill 模块化实施计划

**目标：** 插件只暴露 `short-drama` 一个 Skill，把其余原子能力迁入主 Skill 的 `references/`，并以模块路由、模块凭证和渐进加载继续驱动完整短剧流程。

**架构：** 保留九阶段、项目合同、Provider、MCP、Dashboard 和媒体服务；将原 Skill 名稳定为 `module_id`。`module-map.json` 负责模块注册与提示词归属，`module-runs.json` 负责完成凭证，主 Skill 根据结构化项目事实加载必要 reference。旧 `skill-runs.json` 只读、校验后幂等迁移。

**技术栈：** Node.js ESM、原生 `node:test`、JSON 合同、Markdown reference、现有文件锁与 SHA-256 工具。

**设计：** `docs/superpowers/specs/2026-09-24-single-skill-module-routing-design.md`

## 全局约束

- 默认中文沟通；新增注释只用中文，并解释业务意图、边界或兼容原因。
- 不修改用户项目目录和客户端插件缓存，只修改本仓库源码与测试夹具。
- 先写失败测试，再做最小实现；每项任务结束时留下可独立运行的检查。
- 不重写九阶段、Provider、MCP、Dashboard 或媒体生成协议。
- 不引入新依赖；复用现有文件锁、哈希、原子写入和项目校验实现。
- 仓库当前已有未提交改动，执行时必须逐文件核对，只提交本重构可明确归属的改动。
- 旧 Skill 目录只在模块路由、迁移和审计全部通过后删除。
- 发布前必须运行插件自检、集成自检、全量测试和三清单版本一致性检查。

---

### Task 1：建立模块注册表与结构审计

**Files:**
- Create: `references/module-map.json`
- Create: `scripts/module-map.mjs`
- Create: `scripts/module-map.test.mjs`
- Modify: `scripts/audit-plugin.mjs`

**Interfaces:**
- Produces: `readModuleMap()`、`moduleById()`、`modulesForStage()`。
- Produces: 原 Skill 名到 module ID 的 `legacy_skill_map`。
- Consumes later: 模块路由、提示词渲染、凭证迁移和插件审计。

- [ ] **Step 1：写模块注册表失败测试**

覆盖唯一 module ID、九阶段顺序、目标 reference 路径唯一、依赖无环、提示词 owner 有效、旧 Skill 全覆盖。此阶段只验证目标路径格式和唯一性；实际文件存在性在 Task 4 搬迁后启用。测试先引用尚不存在的 `module-map.json` 和读取器。

- [ ] **Step 2：验证红灯**

Run: `node --test scripts/module-map.test.mjs`

Expected: 因模块注册表或导出缺失而失败。

- [ ] **Step 3：实现最小注册表与读取器**

从现有 `skill-map.json` 平移阶段、提示词、完成提示词和质量门禁；增加模块路径、分类、条件、依赖与 `legacy_skill_map`。读取器只负责严格校验和确定性查询，不实现第二套路由 DSL。

- [ ] **Step 4：把结构检查接入插件审计**

先把模块注册表的 schema、依赖和提示词 owner 检查接入审计。旧入口与目标 reference 存在性检查作为显式 `final-layout` 模式加入，并在 Task 5 删除旧目录时转为默认；生产发布检查不得跳过最终模式。

- [ ] **Step 5：验证绿灯**

Run: `node --test scripts/module-map.test.mjs`

Expected: PASS。

---

### Task 2：实现模块路由和条件触发

**Files:**
- Create: `scripts/module-runs.mjs`
- Create: `scripts/module-routing.test.mjs`
- Modify: `scripts/workflow-gates.mjs`
- Modify: `scripts/recreation-workflow.test.mjs`

**Interfaces:**
- Produces: `requiredModules(root, stage)`。
- Consumes: `project.json`、selected 文档、资产账本、制作计划、任务和审核状态。
- Preserves: 现有阶段顺序与复刻项目的 Hypit 前置关系。

- [ ] **Step 1：写普通项目、打斗/白模、Hypit 复刻路由失败测试**

断言普通镜头不加载打斗和白模；结构化复杂动作加载 `design-fight-video`、连续性及白模模块；图片与白模分镜按策略选择；`viral-recreation` 按顺序加载 Dashboard、Provider、Hypit、参考分析和复刻设计模块。

- [ ] **Step 2：验证红灯**

Run: `node --test scripts/module-routing.test.mjs scripts/recreation-workflow.test.mjs`

Expected: `requiredModules()` 尚不存在或条件路由不符合合同。

- [ ] **Step 3：从现有 requiredSkills 提取最小路由实现**

复用现有项目读取和动态条件，不增加通用规则引擎。把无条件的 `design-fight-video` 改为只读取显式 `action_complexity=choreographed`、动作设计引用或制作计划结构化动作事实；不能用自由文本关键词作为长期事实。

- [ ] **Step 4：门禁改为消费 requiredModules**

保持现有证据、分镜、白模、原生音频和复刻检查，只把 Skill 身份改为 module ID，并验证依赖模块运行凭证。

- [ ] **Step 5：验证绿灯**

Run: `node --test scripts/module-routing.test.mjs scripts/recreation-workflow.test.mjs`

Expected: PASS。

---

### Task 3：实现 module-run 凭证与旧账本幂等迁移

**Files:**
- Modify: `scripts/module-runs.mjs`
- Create: `scripts/module-runs.test.mjs`
- Modify: `scripts/invalidate-workflow.mjs`
- Modify: `scripts/workflow.mjs`
- Modify: `scripts/validate-project.mjs`

**Interfaces:**
- Produces: `.short-drama/module-runs.json` version 1。
- Reads legacy: `.short-drama/skill-runs.json`，永不原地修改。
- Produces: `readModuleRuns()`、`recordModuleRun()`、`migrateSkillRuns()`、`clearModuleRunsFrom()`。

- [ ] **Step 1：写凭证和迁移失败测试**

覆盖 reference、输入、输出与 prompt-run 哈希；reference 或 selected 输入变化后的最小失效；有效旧记录迁移；过期、缺失、篡改或不等价旧记录拒绝；重复迁移无重复项。

- [ ] **Step 2：验证红灯**

Run: `node --test scripts/module-runs.test.mjs`

Expected: 新账本接口或迁移能力缺失。

- [ ] **Step 3：复用现有 Skill 凭证校验实现**

将现有证据模式、Provider/Dashboard/Hypit 特殊校验、prompt-run 绑定和文件锁迁入 module-run；新增 reference 路径与 SHA-256。删除重复逻辑，不保留两套可写账本。

- [ ] **Step 4：实现只读旧账本迁移**

通过 `legacy_skill_map` 转换旧名；迁移记录写入来源 ID 和旧记录哈希。无法证明 reference 等价时保持模块未完成，不伪造通过凭证。

- [ ] **Step 5：阶段失效和项目校验切换到 module-run**

失效范围由阶段和模块依赖共同决定；项目校验允许旧账本作为待迁移输入，但阶段完成只认可有效 module-run。

- [ ] **Step 6：验证绿灯**

Run: `node --test scripts/module-runs.test.mjs scripts/module-routing.test.mjs`

Expected: PASS。

---

### Task 4：迁移 reference 正文、提示词和专用资源

**Files:**
- Create/Modify: `skills/short-drama/references/{workflow,creation,assets,storyboard,generation,review,editing,recreation,market,operations}/**`
- Create/Modify: `skills/short-drama/assets/modules/**`
- Modify: `references/module-map.json`
- Modify: `scripts/render-prompt.mjs`
- Modify: `references/prompt-skill-index.md`
- Extend: `scripts/module-map.test.mjs`

**Interfaces:**
- Each module reference declares: 适用/排除条件、输入事实、输出合同、失败关闭、资源和验收凭证。
- Prompt owner becomes module ID；模板内容和变量合同保持不变。

- [ ] **Step 1：补迁移完整性失败测试**

为当前全部 46 个非入口 Skill 建立固定迁移清单；断言每个旧 Skill 正文、内嵌 references、提示词和必要资源有唯一目标，且不存在 basename 冲突和悬空相对链接。

- [ ] **Step 2：验证红灯**

Run: `node --test scripts/module-map.test.mjs`

Expected: reference 或资源尚未迁移。

- [ ] **Step 3：按分类搬迁模块正文**

把原 `SKILL.md` 去除 frontmatter 后迁为模块 reference；保留原业务合同和专业门禁，不做顺手重写。原 Skill 内部 references 迁入对应模块子目录，避免同名文件碰撞。

- [ ] **Step 4：搬迁提示词和模块专用资源**

提示词统一放入 `skills/short-drama/assets/modules/<module_id>/prompts/`；其他必要资源按 module ID 隔离。仓库级共享脚本、公共模型和生产运行资源保持原位。

- [ ] **Step 5：提示词渲染切换到 module map**

渲染器从 module map 解析 owner 与模板绝对位置；旧 prompt-run owner 仅在迁移读取时转换。中英文变量一致性和 Codex/Provider 执行模式检查保持不变。

- [ ] **Step 6：验证绿灯**

Run: `node --test scripts/module-map.test.mjs scripts/character-appeal-prompts.test.mjs scripts/character-identity-binding.test.mjs`

Expected: PASS。

---

### Task 5：重写唯一主 Skill 并删除旧入口

**Files:**
- Modify: `skills/short-drama/SKILL.md`
- Modify: `skills/short-drama/agents/openai.yaml`
- Delete: `skills/<46 个非 short-drama 目录>/**`
- Delete: `references/skill-map.json`
- Delete: `scripts/skill-runs.mjs`
- Extend: `scripts/module-map.test.mjs`

**Interfaces:**
- Exposes: only `short-drama` Skill。
- Main loop: 恢复项目 → 校验 → 查询 required modules → 渐进读取 references → 执行 → 记录 module-run → 阶段门禁。

- [ ] **Step 1：写唯一入口失败测试**

扫描 `skills/`，断言只有 `skills/short-drama/SKILL.md` 含 Skill frontmatter，只有它拥有 `agents/openai.yaml`；主 Skill 必须包含九阶段、路由循环、全局门禁和关键模块读取规则。

- [ ] **Step 2：验证红灯**

Run: `node --test scripts/module-map.test.mjs`

Expected: 仍发现旧 Skill 入口。

- [ ] **Step 3：重写主 Skill 为路由入口**

将原主 Skill 的具体脚本创作内容迁入 `references/creation/short-drama/`，入口仅保留能力描述、恢复步骤、状态机、路由表、全局门禁和 module-run 协议。

- [ ] **Step 4：删除已完成迁移的旧目录和旧注册表**

删除前由迁移完整性测试证明每项内容已有唯一目标。现有插件清单已经指向 `./skills/`，保持不变，不新增硬编码单文件发现机制。

- [ ] **Step 5：移除旧可写运行脚本**

所有调用方切换后删除 `scripts/skill-runs.mjs`；旧项目数据兼容只保留在 `module-runs.mjs` 的只读迁移器中。

- [ ] **Step 6：验证绿灯**

Run: `node --test scripts/module-map.test.mjs scripts/module-routing.test.mjs scripts/module-runs.test.mjs`

Expected: PASS，且只发现一个 Skill。

---

### Task 6：更新恢复入口、Dashboard、文档和集成审计

**Files:**
- Modify: `scripts/project-store.mjs`
- Modify: `scripts/integration-self-check.mjs`
- Modify: `scripts/audit-plugin.mjs`
- Modify: `scripts/studio.mjs`
- Modify: `scripts/studio.test.mjs`
- Modify: `README.md`
- Modify: `references/project-spec-v1.md`
- Modify: `references/pipeline.md`
- Modify: `references/usage-guide.md`
- Modify: `references/feature-completeness.md`

**Interfaces:**
- New projects initialize `module-runs.json` and RESUME references `module-runs.mjs required`。
- Dashboard displays module name/status/reference without exposing many Skills。
- Existing MCP tool names and Dashboard routes stay unchanged。

- [ ] **Step 1：写初始化和 Dashboard 失败测试**

断言新项目不创建 `skill-runs.json`；旧项目打开时触发安全迁移；Dashboard 阶段详情使用 module 数据；恢复文档只引导主 Skill 和 module CLI。

- [ ] **Step 2：验证红灯**

Run: `node --test scripts/studio.test.mjs scripts/module-runs.test.mjs`

Expected: 初始化或 Dashboard 仍依赖 Skill 账本。

- [ ] **Step 3：切换项目初始化与恢复入口**

基于当前 `project-store.mjs` 的用户改动做最小增量；不覆盖无关修改。新项目只创建 module 账本，旧账本由恢复流程按需迁移。

- [ ] **Step 4：切换 Dashboard 展示与集成自检**

只调整数据标签和读取源，不改变路由或功能。集成自检覆盖普通项目、打斗/Blender 白模项目和 Hypit 复刻项目。

- [ ] **Step 5：更新用户文档和开发审计**

统一使用“主 Skill / 模块 / reference / module-run”，仅在迁移说明中保留旧 Skill 名。更新安装后能力发现示例为单入口。

- [ ] **Step 6：验证绿灯**

Run: `node --test scripts/studio.test.mjs && node scripts/integration-self-check.mjs --self-check`

Expected: PASS。

---

### Task 7：全量回归、版本与发布前验收

**Files:**
- Modify only files required by failures and within this refactor scope.
- Modify version manifests only when the user explicitly requests release/tag.

- [ ] **Step 1：运行模块化定向测试**

Run: `node --test scripts/module-map.test.mjs scripts/module-routing.test.mjs scripts/module-runs.test.mjs scripts/recreation-workflow.test.mjs scripts/studio.test.mjs`

- [ ] **Step 2：运行全部离线测试**

Run: `node --test scripts/*.test.mjs scripts/market/*.test.mjs scripts/generation/*.test.mjs scripts/media-hosting/*.test.mjs`

- [ ] **Step 3：运行插件与集成自检**

Run: `node scripts/audit-plugin.mjs --self-check && node scripts/integration-self-check.mjs --self-check`

- [ ] **Step 4：运行 CI 同款专项检查**

Run: `node scripts/composition-vocabulary.test.mjs && node scripts/studio.test.mjs`

- [ ] **Step 5：校验三清单版本一致**

Run: `node -e "const fs=require('fs'); const v=JSON.parse(fs.readFileSync('.codex-plugin/plugin.json')).version; if (JSON.parse(fs.readFileSync('.claude-plugin/plugin.json')).version!==v || JSON.parse(fs.readFileSync('.claude-plugin/marketplace.json')).plugins[0].version!==v) process.exit(1)"`

- [ ] **Step 6：验证安装产物只有一个 Skill**

在临时目录安装/打包插件并扫描 Skills，断言只暴露 `short-drama`；运行普通短剧、打斗/白模和 Hypit 复刻三条 smoke，不执行付费媒体生成。

- [ ] **Step 7：检查工作区边界**

Run: `git status --short && git diff --check && git diff --stat`

确认未提交密钥、临时项目、媒体缓存或客户端插件缓存；当前用户已有改动没有被清理、覆盖或误纳入提交。

## 提交边界

建议按 Task 1–7 分别提交。Task 4 的纯移动与 Task 5 的删除入口可各自独立提交，便于审查 rename 与真实内容改动；任何提交都不得夹带开始实施前已有的无关工作区修改。
