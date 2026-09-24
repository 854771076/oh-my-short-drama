# Litterbox 临时托管合同

- 官方入口：`https://litterbox.catbox.moe/resources/internals/api.php`
- 请求：multipart POST，`reqtype=fileupload`、`time=1h|12h|24h|72h`、`fileToUpload=<文件>`。
- 免费匿名使用，不需要账号或 API Key；官方首页当前声明临时文件上限 1 GB。
- 返回值必须是 `https://litter.catbox.moe/...`；适配器拒绝重定向和其他域名。
- 文件公开、未加密，服务记录上传 IP；禁止文件类型和内容以 Litterbox FAQ、Catbox AUP/ToS 为准。
- Catbox 明确禁止未经许可将服务用于商业服务。商业短剧或组织用途只有在用户确认已取得相应许可后才能上传。
- 匿名免费接口没有提前删除能力。到期时间是清理预期，不是可用性承诺；URL 只作 Provider 间临时传输。

来源：[官方 API](https://litterbox.catbox.moe/tools.php)、[官方 FAQ](https://litterbox.catbox.moe/faq.php)、[Catbox 条款与隐私](https://catbox.moe/legal.php)。
