# Hypit 复刻唯一事实源与 Dashboard 集成设计

日期：2026-09-21  
状态：已完成方案确认，待实施计划

## 1. 背景

当前 `viral-recreation` 流程只把 Hypit 当作参考视频分析的中间理解器。插件随后又生成 `reference-video-analysis.json`、`recreation-workflow` 和 `recreation-compiled`，并由自己的剧本、导演本、分镜、音频和剪辑文档继续编排。这形成了 Hypit 工程与插件五层工作流两套事实源，增加同步、失效传播和恢复成本。

本设计将复刻项目改为：除媒体生成和媒体处理的具体执行外，参考片理解、创作决策、脚本、语义时间线、镜头、字幕、声音、特效、剪辑和最终编排全部由 Hypit 表达。现有 Dashboard 继续作为统一入口，并承载 Hypit Studio、Provider 配置、任务、资产、审核和交付状态。

## 2. 目标

- Hypit 工程成为新建复刻项目唯一的创作事实源。
- Dashboard 保持统一入口，并在项目内嵌 Hypit Studio。
- 图片、视频、音频、Blender 白模、口型、超分、媒体修复及最终编码继续复用现有执行能力。
- Dashboard 与 Hypit Studio 发起的生成统一进入同一条 Hypit Build 和 Provider 通道。
- 保留权利、预算、凭据、并发、资产身份和审片门禁。
- 支持现有复刻项目以预览、确认、切换的方式迁移，迁移前不改变旧事实源。
- 非 `viral-recreation` 项目保持现有流程不变。

## 3. 非目标

- 不把现有生成 Provider 的全部协议重新实现在 Hypit 工程中。
- 不保留一套可写的旧五层复刻工作流与 Hypit 双向同步。
- 不允许 Hypit 在未确认账号、费用或权利范围时自动切换服务或提交付费任务。
- 不在本次改造中重写普通原创、小说改编或市场调研流程。
- 不把 Cookie、API Key、签名媒体 URL 或浏览器令牌写入 Hypit Source、Run、Build Result 或项目文件。

## 4. 核心原则

### 4.1 唯一事实源

新复刻项目的创作事实仅存在于 Hypit 工程：Reference notes、Brief、Treatment、Script、SVML、SVS、SVRun、Build Results 和显式 Candidates。Dashboard 读取并投影这些状态，不维护第二套可编辑的复刻文档。

插件任务账本和资产账本属于执行与审计证据，不是创作时间线。它们可以记录底层任务、文件版本、哈希、费用和审核结论，但不能改变 Hypit Author Source 或 Run 的创作意图。

### 4.2 编排与执行分离

Hypit 决定生成什么、输入是什么、何时执行、如何进入时间线以及哪些既有 Output 被复用。现有短剧执行器只负责完成具体请求：

- 图片、视频、语音和音乐生成；
- Blender 白模生成与渲染；
- 口型、超分、局部修复、音轨替换；
- FFmpeg/Remotion 编码和最终交付文件生成。

执行器不得创建独立的镜头编排、字幕时间线或剪辑决策。

### 4.3 失败关闭

Hypit、Studio、Runtime、Provider 或执行器不可用时，复刻流程必须停在可恢复状态，不得静默回退到旧五层工作流，也不得重复提交付费任务。

## 5. 总体架构

```text
Dashboard（统一入口）
├── 项目、Provider、凭据引用、预算与并发配置
├── 参考视频导入、权利确认、资产与审核
├── Hypit Run / Plan / Build / Output 状态
└── 内嵌 Hypit Studio
              │
              ▼
Hypit 工程（复刻唯一创作事实源）
├── Reference notes / Brief / Treatment / Script
├── SVML / SVS / SVRun
├── Timeline / Captions / Speech / Film
└── Build Results / Candidates
              │
              ▼
short-drama Hypit Provider
              │
              ▼
共享生成执行层
├── RunningHub 与其他图片、视频、音频 Provider
├── Blender 白模
├── 口型、超分和媒体修复
└── FFmpeg / Remotion
              │
              ▼
插件任务账本 + 资产账本 + Hypit Output
```

## 6. 项目布局与身份绑定

每个复刻项目在项目根目录下拥有独立、可编辑的 `hypit/` 工作区：

```text
<project>/
├── hypit/
│   ├── package.json
│   ├── package-lock.json
│   ├── reference/
│   ├── brief.md
│   ├── treatment.md
│   ├── main.svml
│   ├── recipes.svs
│   ├── build.svrun
│   └── hypit.runtime.json
└── .short-drama/hypit/
    ├── integration.json
    ├── ready.json
    └── migration.json
```

`integration.json` 只保存集成身份与投影信息：Hypit 版本、workspace 相对路径、当前 Author Source、Run、Runtime Profile、参考视频 source key/version/SHA-256、最近 Plan/Build ID，以及插件任务与 Hypit Operation 的映射。它不能保存创作内容或凭据。

参考视频仍由插件受控导入并登记在 `source/manifest.json`。Hypit Reference notes 必须绑定所选来源版本和 SHA-256；来源变化会使当前 Hypit 分析、Run 和下游 Build 失效，要求显式创建修订版本。

## 7. 复刻流程

```text
初始化或恢复复刻项目
→ 打开 Dashboard 精确项目路由
→ 配置并探测 Provider、预算与并发
→ 导入、校验并选择参考视频
→ 检查或安装 Hypit Skill、CLI 与固定版本
→ 初始化独立 Hypit workspace 和 Runtime Profile
→ Hypit 分析参考视频
→ 生成 Reference notes、Brief、Treatment、Script、SVML、SVS、SVRun
→ 在 Dashboard 内嵌 Studio 中预览和修改
→ hypit plan 展示能力、调用、费用、依赖和复用情况
→ 用户授权后执行 hypit build
→ short-drama Provider 调用现有执行器
→ 结果写入 Hypit Build Result 并登记插件资产版本
→ Studio 完成时间线、字幕、声音、特效与剪辑调整
→ 插件执行权利与质量审核
→ Hypit 发起最终编码 Operation
→ 交付文件和 manifest
```

只有 `hypit build` 可以提交生成或媒体处理。`check`、`plan`、Dashboard 浏览和 Studio 预览不得产生付费任务。

## 8. Dashboard 集成

### 8.1 导航和页面

- 将“复刻工作流”改为“Hypit 工程”。
- 显示 Hypit Skill、CLI、Distribution、Runtime、workspace 和 Studio 的可用状态。
- 显示当前 Author Source、Run、Plan、Build、Output、Candidate 和复用关系。
- 保留 Provider 配置、任务监控、资产库、白模、审核和交付页面。
- 旧 `reference-video-analysis` 和五层工作流仅在旧项目迁移页以只读方式展示。

### 8.2 Studio 内嵌

Dashboard 启动所选项目的 `hypit studio --run ... --runtime ... --workspace ...`，并通过仅监听 loopback 的受控代理嵌入项目页面。代理必须：

- 只代理当前项目登记的 Studio 进程；
- 支持 Studio 所需的 HTTP、资源和 WebSocket 请求；
- 使用不可预测的项目会话令牌；
- 限制 workspace 和可访问文件范围；
- 不记录凭据、签名 URL 或媒体请求头；
- 在项目切换、进程退出或 Dashboard 关闭后清理会话。

被固定的 Hypit 版本必须通过内嵌兼容性测试；若该版本无法安全内嵌，则发布阻断，不以新标签页冒充完成 A 方案。

### 8.3 状态投影

现有九阶段 UI 可以保留，但复刻项目的完成条件改为读取 Hypit 和执行证据：

- analysis：参考来源、Reference notes、Brief 和 Treatment 有效；
- script：Hypit Script 已形成且无阻断项；
- director-book：Treatment、视觉与表演方向已形成；
- asset-analysis：Run 所需资产与身份槽明确；
- asset-generation：所需 Candidate 已生成、登记并审核；
- production-plan：目标 SVRun 通过 `hypit plan`；
- media-production：目标 Build 的必要 Outputs 完成并审核；
- editing：Film、Timeline、Caption、Speech 与最终编码目标有效；
- delivery：交付 Output、manifest 和全片审核完成。

这些阶段是 Dashboard 视图，不是另一套作者文档。

## 9. short-drama Hypit Provider

### 9.1 包边界

插件提供一个项目可安装的 Hypit Provider 包。该包使用 Hypit 的 Model、Generation、Endpoint 和 Runtime SDK，只负责请求映射与任务生命周期，不复制底层 Provider 实现。

现有 MCP、Dashboard 和 Hypit Provider 共同调用从当前生成 MCP 中提取的共享执行模块。Provider 不通过 MCP stdio 自调用，也不要求 Dashboard HTTP 服务持续运行。

### 9.2 能力映射

- 标准图片、视频、语音和音乐优先使用 Hypit 已有 Model 定义。
- Blender 白模、口型、超分、局部修复、音轨替换和最终编码使用插件拥有的最小自定义 Model 定义。
- 每项能力声明精确输入端口、参考素材角色、参数范围、输出类型、费用信息和并发限制。
- Runtime Profile 把能力绑定到明确 Endpoint；失败不能授权改走另一账号或服务。

### 9.3 生命周期

Provider 实现 `supports/pricing/start/poll/collect` 对应生命周期：

- `supports` 在上传和付费前校验模型、参数、时长、分辨率与引用类型；
- `pricing` 返回可获得的价格或明确标记未知费用；
- `start` 以 Hypit Build/Operation ID 作为幂等键，先持久化插件任务 ID 再返回；
- `poll` 从任务账本恢复状态，不因进程重启重新提交；
- `collect` 下载或读取真实结果，校验媒体后登记不可变资产版本和 SHA-256，再交给 Hypit Resource Store。

RunningHub 单 Key 最大并发 2 继续由共享执行层强制控制。Hypit Runtime 可以进一步限制容量，但不能放宽底层限制。

### 9.4 双账本关系

Hypit Build Result 是编排结果；插件任务账本是底层执行证据；插件资产账本是文件身份和审核事实。三者通过稳定 ID 映射，职责不重叠：

```text
Hypit Build ID + Operation ID
↔ plugin task ID
↔ asset key + version + SHA-256
↔ Hypit public Output
```

Dashboard 从该映射生成统一视图，不复制任务状态。

## 10. 资产复用与审核

- 已完成且可复用的素材通过 Hypit `build-record` 和 `satisfy` 显式选择。
- 用户上传或插件已有资产以文件 Candidate 进入 Run，不伪装成新生成结果。
- Output 必须先完成媒体探测、哈希和资产登记，才能成为可选 Candidate。
- 权利、人物身份、儿童保护、连续性、原生声音、口型、音乐授权、超分和全片审核继续作为插件门禁。
- 审核结论只批准或拒绝具体 Output/资产版本；需要改变创作内容时必须修改 Hypit Source/Run 并创建新 Build。
- 旧 Result 不覆盖、不删除，新的 Run 显式决定是否复用其中的合格 Output。

## 11. 凭据、预算与安全

- Dashboard 保存 Provider 配置和不含秘密的参数；密钥仍进入本机私有凭据存储或环境变量。
- Hypit Runtime Profile只保存 Endpoint 和 credential reference，不保存明文密钥。
- `hypit plan` 必须在 Build 前展示账号、能力、预计调用、可得费用、未知费用和复用 Output。
- 账号、服务、范围或预算变化必须重新确认。
- 参考视频导入继续执行当前 `yt-dlp → 用户 Chrome 登录重试 → 现有播放会话兜底` 流程。
- 项目路径、Hypit workspace、Provider 输出和 Studio 代理均执行真实路径与符号链接边界校验。

## 12. 失败与恢复

- Hypit 安装或版本不匹配：阻止初始化或 Build，保留项目原状态。
- Studio 启动或代理失败：报告精确诊断，不伪造 Dashboard 已打开。
- Provider 能力不匹配：在 Plan 阶段失败，不上传参考素材。
- 远端提交响应不确定：读取已持久化幂等键和任务 ID，禁止盲目重试提交。
- Build 中断：从 Hypit Build 和插件任务映射恢复轮询；已完成 Outputs 保留。
- 单个 Operation 失败：Build 保留失败证据，修订后创建新 Run/Build。
- 资产校验失败：不得登记资产或向 Hypit 返回完成 Output。
- 审核失败：保留 Result，修改 Source/Run 或生成替代 Candidate。
- 最终编码失败：复用已完成上游 Outputs，只重新运行受影响的编码路径。

## 13. 旧项目迁移

迁移分为预览和确认两步：

1. 读取 selected 参考来源、prepared、旧分析、selected recreation workflow、剧本、导演本、分镜、制作计划、资产和时间线。
2. 生成一个隔离的 Hypit workspace 预览：旧分析作为 Reference notes 的带来源上下文，旧创作内容转为初始 Brief、Treatment、Script、Author Source 和 Candidates。
3. 运行 Hypit `check` 和 `plan`，展示无法映射、权利不明或丢失身份的内容。
4. 用户确认后写入 `migration.json`，将项目事实源切换为 Hypit。
5. 原文件保留为只读历史，不参与后续门禁，也不与 Hypit 双向同步。

迁移失败或未确认时，旧项目保持原工作方式。新项目不创建旧五层复刻产物。

## 14. 代码和 Skill 调整范围

- `use-hypit-video`：从“中间理解器”改为复刻全流程编排器。
- `analyze-reference-video`：只保留受控导入、准备、权利确认和向 Hypit 交接。
- `design-video-recreation`：停止进入新项目主链，改为旧项目迁移入口。
- `orchestrate-short-drama`、`use-short-drama-studio` 和阶段门禁：复刻模式改读 Hypit 投影。
- 剧本、导演本、分镜、制作计划、视频提示词、音频和剪辑 Skill：复刻模式不再生成独立作者文档，由 Hypit Source/Run 驱动；普通项目行为不变。
- Dashboard：增加 Hypit 工程页面、Studio 代理、Run/Plan/Build/Output/任务映射视图。
- 生成 MCP：提取共享执行模块，保留现有 MCP 工具兼容性。
- 新增 Hypit Provider 包、Model 定义、Runtime Profile 生成和集成状态校验。

## 15. 测试与验收

### 15.1 自动测试

- Hypit 环境检查、版本锁定和 workspace 初始化测试。
- Runtime Profile 不含凭据且能力绑定正确。
- Provider `supports/pricing/start/poll/collect` 合同测试。
- Build/Operation、插件任务、资产和 Output 映射的幂等与恢复测试。
- RunningHub 单 Key 并发 2 的跨 MCP/Hypit 共用限制测试。
- Dashboard Studio 进程、代理、会话隔离和项目切换测试。
- Dashboard 阶段投影与 Hypit 状态一致性测试。
- 图片、视频、语音、白模、口型、超分和最终编码的无付费模拟测试。
- 旧项目迁移预览、确认、失败回滚和只读历史测试。
- 新复刻项目拒绝旧 `recreation-workflow` 主链的门禁测试。
- 普通项目完整回归测试。

### 15.2 集成验收

使用一个短参考镜头完成真实小闭环：

```text
导入参考视频
→ Hypit 分析并生成可打开工程
→ Dashboard 内嵌 Studio 预览
→ Plan 展示生成与费用
→ Build 生成至少一个媒体 Output
→ Output 同时登记 Hypit Result 和插件资产
→ Studio 选用 Output 并调整时间线
→ 插件审核
→ Hypit 发起最终编码
→ Dashboard 交付并可恢复查看完整证据链
```

验收时必须证明 Studio 与 Dashboard 对同一生成请求只产生一个底层任务，进程重启不会重复提交。

## 16. 实施顺序

1. 建立 Hypit 工程身份、状态投影和强制环境门禁。
2. 提取共享生成执行层，保持现有 MCP 行为不变。
3. 实现 short-drama Hypit Provider 与最小能力集。
4. 实现 Dashboard Hypit 页面和 Studio 安全代理。
5. 将新复刻项目切换为 Hypit 唯一事实源。
6. 接入白模、口型、超分、修复和最终编码能力。
7. 实现旧项目迁移预览与确认。
8. 完成真实小镜头集成验收后再移除旧主链入口。

每一步均须保持普通项目和已发布 MCP 工具兼容；未通过对应测试时不得进入下一步。
