# 仓库协作约定

- 默认使用中文沟通；新增注释必须使用中文，并说明业务意图、边界或权限约束。
- 修改前先运行与改动范围匹配的自检；不要修改用户项目目录或客户端插件缓存。
- 插件版本统一使用三段式 SemVer，例如 `0.4.0`，不再新增 `+codex.<时间戳>` 构建元数据。
- 发布 tag 使用 `v` 前缀并与清单版本一致，例如版本 `0.4.0` 对应 tag `v0.4.0`。
- `.codex-plugin/plugin.json`、`.claude-plugin/plugin.json` 和 `.claude-plugin/marketplace.json` 的版本必须同步。
- 发布前运行 `node scripts/audit-plugin.mjs --self-check` 及相关集成自检；不要提交密钥、临时文件或生成媒体缓存。
