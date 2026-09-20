---
name: use-hypit-video
description: 在用户需要 Hypit 的完整视频编排、SVML/SVS/SVRun、Studio 或可复用变体时，按需安装并调用官方 Hypit Skill 与可执行程序。
---

# 使用 Hypit 完整视频工作流

当用户明确要求 Hypit、SVML、Studio、完整视频变体或需要 Hypit 的运行时能力时使用。本插件不复制 Hypit 源码，而是从官方发布渠道安装并复用当前机器已有版本。

在 `viral-recreation` 复刻链路中，Hypit 的角色固定为中间理解器：它读取参考视频并形成 Brief、Analysis、Timeline、Treatment 等可回读项目文件；本插件随后把这些内容翻译为自己的 `reference-video-analysis` 和 `recreation-workflow`。此模式禁止调用 Hypit Build，最终图片、视频、音频、时间线和交付必须继续走本插件的 Provider、资产账本、审片和 Remotion 门禁。

首次使用先执行：

```bash
node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/ensure-hypit.mjs" check
```

若缺少任一组件，按用户已提出的使用请求执行一次：

```bash
node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/ensure-hypit.mjs" ensure --project-root <项目目录>
```

安装范围是当前用户的全局环境：

- 官方 Skill：固定到插件脚本中的 Hypit Git 提交；可用 `SHORT_DRAMA_HYPIT_SKILL_SOURCE` 覆盖
- 官方可执行程序：默认固定 `@hypit/hypit@0.2.10`；可用 `SHORT_DRAMA_HYPIT_VERSION` 覆盖

安装完成后必须执行 `hypit version` 和 `hypit paths`，确认实际生效的版本、Distribution 和项目路径。复刻项目完成中间分析后，再运行 `record-hypit-handoff.mjs` 登记实际 Hypit 文件及 SHA-256，生成 `.short-drama/hypit/handoff.json` 作为阶段证据。Skill 安装与可执行程序安装是两个独立生命周期；不要因为已有其中一个就假定另一个存在，也不要在没有缺失证据时重复安装。

```bash
node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/record-hypit-handoff.mjs" --project-root <项目目录> --hypit-root <Hypit 项目目录> --source-key <src-reference-video> --source-version <v001> --files Analysis.json Timeline.json Treatment.md
```

该命令会把指定中间文件复制到当前项目 `.short-drama/hypit/inputs/` 并登记哈希；后续 `skill-runs.mjs record` 会重新校验文件未被替换。

然后读取已安装的官方 `hypit` Skill。复刻模式只把用户项目边界和参考视频交给 Hypit 做中间分析；普通 Hypit 模式才把 Brief、变体目标、费用/凭据选择交给 Hypit 做完整视频编排、组件、运行时和 Studio。两边共享文件时只通过明确的导入/导出路径和版本记录，不直接修改对方的项目内部状态。

安装、模型服务连接、凭据配置和付费生成分别处理：安装成功不代表已有模型账号、额度或 Provider。任何新凭据、联网下载和付费 Build 都必须沿用用户当前授权与项目权限门禁。
