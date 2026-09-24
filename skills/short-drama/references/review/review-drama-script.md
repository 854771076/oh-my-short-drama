# 复核短剧剧本

读取已选剧本、source-analysis、brief、bible、outline，并读取 [合规清单](../../../../references/writing/compliance-checklist.md)。由 Codex 使用 `../../assets/modules/review-drama-script/prompts/review_drama_script.{zh,en}.txt` 复核，不调用外部文本模型。

把结果保存为 `script-review` 不可变版本并选定。`approved` 仅在来源覆盖、开场、节奏、兑现、对白、连续性、合规与可制作性都通过，且无 P0/P1 问题时为 true。问题必须定位到场次或台词；需要修改时回到 `humanizer` 或 `write-drama-episode` 产生新剧本版本，再对新版本复核，旧报告不得复用。

使用 `project-store.mjs put-episode-document <项目目录> script-review <episode-key> <version> <JSON>` 保存，再用 `select-episode-document` 选定。导演本阶段只接受与当前 selected 剧本版本一致且已批准的报告。
