# 可扩展画风

`art-styles.json` 是 Dashboard 的内置画风目录。每个数组元素都是一个画风对象，至少需要包含：

- `id`、`name`、`description`、`prompt`
- `visualBible.version`（必须为 `1`）
- `visualBible.palette`、`baseline`、`lighting`、`narrative_arc`、`motion_language`、`negative_constraints`

复制一个现有对象修改即可新增画风。保存后重启 Dashboard，新的画风会出现在「生成配置」中；画风内容会原样写入项目的 `creative.art_style`。

通过插件生成并确认的自定义画风，会自动追加到统一工作区根目录下的 `art-styles.custom.json`，下次启动自动与系统画风合并。也可用环境变量 `SHORT_DRAMA_CUSTOM_ART_STYLES_FILE` 指定自定义库路径。
