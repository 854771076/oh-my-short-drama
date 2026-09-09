---
name: write-drama-director-book
description: 由 Codex 把已确认剧本转换为场次级导演本。用于明确戏剧目标、表演、调度、摄影、光线、声音和连续性意图并保存本地版本；不拆成最终镜头。
---

# 编写短剧导演本

读取本地已选剧本、source analysis、故事圣经和项目画幅。由 Codex 使用 `assets/prompts/director_book.{zh,en}.txt` 为每个场次输出结构化导演本：来源段落、戏剧目标、节拍、人物潜台词与表演、走位和视线、空间轴线、摄影策略、光线色彩、环境与声音、转场意图、连续性状态和资产需求。

导演本不能添加未获授权的剧情事实，也不能提前生成最终镜号或模型参数。它描述“这一场为什么这样拍”，后续 `build-drama-storyboard` 才把意图拆成可生成镜头。

输出严格 JSON，用 `project-store.mjs put-episode-document <项目目录> director-book <episode-key> <version> <文件>` 保存不可变版本，并用 `select-episode-document` 选定。涉及剧情重写、人物关系、台词含义或声音策略改变时必须让用户确认。
