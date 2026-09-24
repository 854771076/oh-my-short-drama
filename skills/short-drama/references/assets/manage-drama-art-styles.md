# 管理短剧艺术风格

读取项目当前画风和已有候选；创建新画风时路由到 `generate-drama-art-style`。选择画风时检查 prompt、visualBible、预览图和适用题材，风格不得包含具体人物身份、剧情事件或与场景冲突的地点事实。

生成预览前确认模型、尺寸和费用；使用同一中性测试内容比较候选。预览图下载到本地资产库并记录 provenance，选定的结构化风格配置写入 `.short-drama/project.json` 的 `creative.art_style`。

画风库由系统画风库 `manage-drama-art-styles/art-styles.json` 与统一工作区根目录下的 `art-styles.custom.json`（或 `SHORT_DRAMA_CUSTOM_ART_STYLES_FILE`）合并组成。选择或确认自定义画风后，必须保存完整 style 对象到自定义库并按 `id` upsert；系统画风只读，不得被自定义对象覆盖。自定义画风必须包含 `id`、`name`、`description`、`prompt` 和完整 v1 `visualBible`，未确认或不完整的候选不得登记。

`update-project` 会把既有人物、场景、道具、故事板和视频版本标记为 stale 并取消选版；重新生成使用新版本，不得清除旧版失效记录。
