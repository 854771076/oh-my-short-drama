# 临时发布短剧参考图

仅当目标 Provider 不接受本地文件、确实需要公网 HTTPS URL 时使用。先调用 `list_media_hosts` 查看当前能力，再调用 `list_reference_uploads` 检查同一资产版本是否已有有效收据；当前可选 `tempfile`（默认）、`tmpfiles`、`uguu`、`litterbox`。这些公共服务均可能限流或临时不可用，不是永久图床；以能力目录返回的时效和大小上限为准。

上传会把文件公开交给第三方并改变外部状态。逐个文件向用户展示本地 `asset_key@version_id`、SHA-256、服务、时效、用途和接收方；只有用户确认拥有上传权、接受公开暴露并同意服务条款后，才调用 `publish_reference_image`，传 `confirmed=true`、`rights_confirmed=true`、`public_exposure_confirmed=true`、`usage_terms_confirmed=true`。`usage_scope` 必须由用户选择 `non-commercial` 或 `commercial-authorized`；后者表示已经取得 Catbox 对商业服务用途的许可，Codex 不得代填。

只允许上传 `assets.json` 中 selected、未失效的 character、scene、prop、storyboard 或 other 图片版本。Litterbox 官方服务会记录 IP，内容公开且未加密，不保证可用性，也没有匿名提前删除接口；不要上传真人隐私、未授权人脸、密钥、内部文档或最终成片。返回 URL、到期时间和本地哈希自动写入 `.short-drama/uploads/upload-<uuid>.json`。同一资产版本、服务和用途已有有效收据时默认复用；只有剩余时效不足且用户再次确认时才传 `force_reupload=true`。生成请求会按提交时间核对 URL 与收据，最终资产仍必须下载并登记在项目本地。

Litterbox 合同与限制见 [Litterbox](publish-drama-references/litterbox.md)；其他公共服务同样按返回的能力目录和服务方条款执行。
