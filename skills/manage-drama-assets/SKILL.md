---
name: manage-drama-assets
description: 在短剧项目目录中管理媒体资产和不可变版本。用于复制或下载生成结果、登记哈希、候选选版、撤回和本地引用审计；不负责创作资产内容。
---

# 管理短剧资产

所有媒体资产使用稳定 key、类型、输入指纹、候选版本和 `selectedVersionId`。key 必须使用 `char-`、`scene-`、`prop-`、`board-`、`shot-`、`audio-` 或 `other-` 前缀，版本使用 `v001`。先用 `node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/asset-ledger.mjs" put <项目目录> <资产.json>` 建档；本地结果用 `import`，Provider 返回的 HTTPS URL 用 `fetch`，base64 结果文件用 `decode`。三者都会把内容保存到项目并记录本地相对路径、文件大小、SHA-256 和固定 provenance。

只读查看使用 `node "${CODEX_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-.}}/scripts/asset-ledger.mjs" list <项目目录> [资产 key]`；第一个参数必须是子命令，不能省略。

Provider 结果执行 `fetch|decode` 时必须在文件名参数后提供 provenance JSON；不自定义文件名时传 `-`。provenance 固定记录 `origin`、`created_by`、Provider、模型/工作流、任务 ID、视频提示词文档、上游资产版本和生成参数，禁止密钥。已有本地文件版本可用 `add-version` 登记，但必须携带 provenance，且 `localPath` 位于项目目录并真实存在。使用 `select`、`revert`、`list` 管理选版历史；不得直接修改 `.short-drama/assets.json`。

远程 URL 只是临时传输结果：文件未进入 `assets/{characters,scenes,props,storyboards,audio,videos,other}/` 并成功登记前，任务不得标记完成。选版后按 ID 回读，不按修改时间猜测成品；上游内容变化时标记真实下游 stale。
