---
name: review-drama-shots
description: 验收短剧分镜图和视频镜头。用于逐镜视觉、音频、转场、字幕检查和缺陷分级。
---

# 验收短剧镜头

实际观看完整画面并听完整音轨，不以任务成功或抽帧代替。每镜记录 assetKey、versionId、visual、audio、transition、captions、P0/P1/P2 issues，以及按制作计划 `review_checks` 原顺序填写的 `criteria: [{criterion,status,observation}]`；observation 必须描述实际看见或听见的证据，缺失关键剧情点必须 failed。用 `node scripts/review-ledger.mjs put <项目目录> <验收.json>` 校验目标确为当前 selected 本地版本并保存到 `.short-drama/shot-reviews.json`。

visual 必须 passed；无声音或字幕时使用 not-applicable，不得伪造通过。P0/P1 只修复受影响镜头并重新验收；不得用字幕掩盖错误人声，用长叠化掩盖动作/轴线错误，或用外部 TTS 覆盖要求原生音频的镜头。四项通过且无 P0/P1 后才加入剪辑候选池。

H3 原生音频镜头还要核对 speech_timeline、统一 music_anchor 和相邻 transition_pair；任一对白错位、音乐断层或声音桥不成对都记为 audio/transition 缺陷，不用后配音静默掩盖。

审片不可只看首帧、联系表或任务状态：逐镜至少按 0.5–1 秒间隔抽查，并对关键动作的入点、接触点、完成点和镜尾逐帧复核；记录实际观察而非复述提示词。整集审片必须完整观看和听完，六个维度分别填写观察；“计划写了动作”不能作为“画面已经实现”的证据。

同一角色跨镜对白必须核对基础声纹、年龄感、性别、口音、音高和语速；未来来电与当前人物只能在电话带宽/空间效果上不同。声纹主体不同属于 P1，不能用“来自未来”解释通过。
