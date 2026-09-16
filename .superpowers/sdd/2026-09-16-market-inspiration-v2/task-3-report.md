# Task 3 执行报告：Studio 灵感板与可视化闭环

## 实现结果

- 删除 `renderMarketLegacy`，市场页只保留 v2 渲染路径。
- API 为当前周期的未过滤报告返回 `filterOptions`；前端所有榜单、题材、受众、形式筛选项都消费该集合，筛选后不会收窄可选项。
- 题材 × 榜单矩阵覆盖当前周期榜单列，展示榜内热度百分位与有效样本数；缺失值显示为 `— (n=0)`。
- 新剧观察展示中文榜单名，题材机会和灵感候选均将置信度显示为中文高/中/低。
- 新增灵感板：最多选择 3 个题材，在本地生成候选，选择候选后登记到目标项目。
- 登记使用 `project-store.mjs` 的 `market-report-ref`、`market-inspiration` 和 `brief` 合同；不会改写项目 `creative.genre`，也不会改写 Brief 原有平台字段。
- 项目存储读取市场报告时允许项目目录使用其工作区父目录的共享市场存储，避免 Studio 复制报告或自行实现摘要校验。

## RED → GREEN

1. 修改前运行 `node scripts/studio.test.mjs`，基线 10/10 通过。
2. 先加入市场页/筛选源/灵感 API 测试后运行同一命令，11 项中 3 项按预期失败：
   - 缺少灵感板、矩阵与删除旧渲染器的页面合同；
   - 筛选 API 未返回未过滤报告的筛选项；
   - 灵感生成接口不存在（404）。
3. 实现最小 API、共享存储读取和页面交互后，Studio 11/11 通过。
4. 再加入真实 DOM 渲染测试，首次暴露灵感板模板表达式缺少闭合括号；修复模板并抽出矩阵单元格渲染后，Studio 12/12 通过。

## 修改文件

- `scripts/studio.mjs`
- `scripts/studio.test.mjs`
- `studio/app.js`
- `studio/styles.css`（仓库实际样式文件；任务简报中的 `style.css` 不存在）
- `scripts/project-store.mjs`（为 Studio 工作区的共享市场报告存储补齐读取路径，复用现有验证合同）

## 验证

- `node --input-type=module --check < studio/app.js`
- `node scripts/studio.test.mjs`：12/12 通过
- `node scripts/project-store-market-inspiration.test.mjs`：6/6 通过
- `node scripts/market/analyze.test.mjs`：25/25 通过
- `node scripts/market-research.test.mjs`：11/11 通过
- `node scripts/audit-plugin.mjs --self-check`：通过
- `node scripts/integration-self-check.mjs --self-check`：通过
- `git diff --check`：通过

## 自审与顾虑

- API 候选保存在 Studio 服务进程内，重启服务后需重新生成候选；这避免将未选创意假设写入项目。
- 目标项目必须已有 Brief 才能登记；接口返回 409 并提示先保存 Brief，避免生成不完整引用。
- 当前任务范围未触及版本清单或 Task 4 文档。

## 审查修复

- 候选 ID 改为每次生成的 UUID 命名空间加候选序号；重复生成同一报告、反向题材顺序后，旧候选仍能按自身 ID 正确登记。
- 新增 `register-market-inspiration` 共享项目存储入口。它在项目锁中先校验市场灵感、报告引用和待写 Brief 的引用一致性，再成组写入两份文档；失败注入与无效 Brief 测试均证明旧 `market-inspiration.json` 和 `brief.json` 保持不变。
- 新增 `studio/market-inspiration-state.js` 可执行状态转换：三选上限、候选选择、周期重置、请求序号与过期响应丢弃均有单测。生成期间禁用题材、候选、项目选择与生成/登记按钮。

审查修复验证额外通过：`node studio/market-inspiration-state.test.mjs`（1/1），`node scripts/project-store-market-inspiration.test.mjs`（7/7），`node scripts/studio.test.mjs`（12/12）。
