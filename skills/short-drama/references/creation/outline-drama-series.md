# 规划分集目录

读取本地 `brief.json`、`bible.json`，按需读取 [节奏曲线](../../../../references/writing/rhythm-curve.md)、[满足矩阵](../../../../references/writing/satisfaction-matrix.md) 和 [卡点设计](../../../../references/writing/paywall-design.md)，用 `episode_split` 模板生成 `outline.json`。每集记录稳定 key、标题、核心事件、爽点/信息增量、开场承接、结尾钩子、关键资产和预计时长；预计时长是策划中心值而非精确截止，默认允许约 ±15% 自然浮动，超出时记录叙事原因并请用户重新确认。用 `project-store.mjs put-document` 保存，并逐集 `put-episode` 建档。

检查总集数、三幕配额、伏笔回收、连续重复与无推进集。用户通读确认完整目录前，不批量写单集剧本。
