# 授权音乐目录与导入边界

配乐有两条独立能力：`music.generate` 生成新曲，`music.catalog` 从已有授权目录选曲。先把 `dramatic_function`、pace、对白密度和目标时长编译成检索词，再由用户试听；不能用曲名热度代替剧情功能。网络热曲若没有同步权和母带权凭证，只能作为风格参考。禁止解析或提取普通 YouTube 视频，禁止抓取付费页面，也不得把未授权商业热曲登记为项目资产。

## 目录

- `local-licensed`：只列项目 `.short-drama/music-licenses/` 已有收据；适合跨集复用前先重新核对 allowed uses、署名和平台范围。
- `pixabay`：返回 [Pixabay Music 官方搜索](https://pixabay.com/music/)；通常可直接浏览。官方许可摘要允许免费使用、一般无需署名并可修改，但禁止把素材基本原样单独销售或分发；仍需逐曲保存来源页、[许可证摘要](https://pixabay.com/service/license-summary/) 和下载证据。官方 FAQ 明确部分音乐可能登记 Content ID，因此每次都要记录 `content_id_risk`，有盾牌/证书时保存证明。
- `youtube-audio-library`：打开 [YouTube Audio Library](https://www.youtube.com/audiolibrary)，需要登录 YouTube Studio。按曲目检查 Standard Audio Library 或 Creative Commons；后者必须复制站点提供的署名文本。YouTube 只对其 Audio Library 内下载内容作平台内说明，并提醒站外使用自行核权，所以客户项目、广告、广播或非 YouTube 平台不能自动推断为已覆盖。
- `uppbeat`：返回 [Uppbeat 官方曲库](https://uppbeat.io/browse/music)，需要登录。许可证取决于下载当时的 Free/Essentials/Creator/Pro/Business 计划；免费使用通常要求当次 credit。Uppbeat Basic 当前不覆盖 paid advertisements、broadcast television、VOD、radio 或 cinema，不能把 Basic 收据扩成这些用途。保存实际计划许可证、单次下载证据、署名/credit 与 Content ID claim release 或 safelist 信息。

## 登记与使用

用户在官方站点完成试听和下载后，调用 `register_licensed_music`，同时传本地真实音频、完整收据、`rights_confirmed=true` 和使用范围。收据至少记录来源 URL、许可证 URL、下载时间、标题、作者、署名文本、`content_id_risk`、allowed uses 和项目内 proof。插件先保存不可覆盖的收据，再把音频登记为未选候选；导入失败也保留收据作为发生过的权利审查证据。

audio-plan 的目录曲使用 `source_mode=catalog`，以 `source_asset` 和 `license_receipt` 绑定具体版本，并明确 `intended_use:{commercial,paid_ad,client_project,broadcast,platform?}`。试听、响度、剪辑适配和权利检查通过后才能选版。时间线通过 `audio_plan:{episode_key,version_id,track_key}` 再次核对同一资产、同一收据和用途；不满足时停止，不靠补署名推定获得缺失权利。
