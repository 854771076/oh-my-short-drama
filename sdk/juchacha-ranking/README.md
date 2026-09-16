# 剧查查排行榜 Python SDK

这是根据 `DataEye剧查查` 微信小程序真实运行请求恢复的纯 HTTP SDK。运行时不依赖微信、浏览器、CDP、Cookie 或登录态。

## 已验证榜单

| 类型 | 榜单 |
| --- | --- |
| `hot` | 热力榜 |
| `motion` | 动态漫榜 |
| `motion-ai` | 真人 AI 榜 |
| `motion-comedy` | 沙雕漫榜 |
| `douyin` | 抖音热播榜 |
| `kuaishou` | 快手热播榜 |
| `hongguo` | 红果榜 |
| `income` | 短剧收入榜 |

## 安装

```bash
cd sdk/juchacha-ranking
python3 -m venv .venv
.venv/bin/pip install -e .
```

## SDK 使用

```python
from juchacha_ranking import JuchachaRankingClient

client = JuchachaRankingClient()

# 不传日期时自动取该榜单最新日榜。
page = client.get_ranking("hot", page=1, page_size=30)
print(page["content"][0])

# 指定日、周或月，只能三选一。
items = client.get_ranking("douyin", day="2026-09-16")["content"]

# 查看服务端当前可用的日/周/月范围。
available = client.get_available_dates("hongguo")

# 未封装的新接口可通过原始入口请求。
raw = client.request("/actor/rank/list", params={"pageId": 1, "pageSize": 30})
```

返回值保留服务端字段，不擅自改名或丢弃字段。标准信封为 `statusCode`、`page`、`content`、`message`。

## 命令行导出

```bash
juchacha-ranking --type hot --output ./hot-latest.json
juchacha-ranking --type douyin --day 2026-09-16 --all --max-pages 3 --output ./douyin.json
juchacha-ranking --type income --all --max-pages 10 --output ./income-first-10-pages.json
```

默认只导出第一页；传入 `--all` 才会尝试继续翻页，建议同时用 `--max-pages` 控制采集规模。经真实回放，当前 8 类公开排行榜均会把 `pageId > 1` 归一为第一页，小程序界面本身也只展示 Top 30；因此 `--all` 目前通常仍得到 30 条。SDK 会检测重复页并停止，不能把响应中的 `totalRecords` 理解为匿名接口可遍历的条数。

## 协议说明

- 基础地址：`https://playlet-applet.dataeye.com`
- 动态请求头：`S = MD5(上海时区当天的 YYYY-MM-DD)`
- 匿名排行榜请求中的 `authentication` 与 `loginUserId` 为空字符串
- SDK 会对限流和 5xx 错误进行有限重试，对 HTTP、JSON 格式和业务状态错误明确抛出异常

接口属于第三方服务，字段和可用性可能随小程序版本变化。请遵守服务条款、控制请求频率，不要用 SDK 绕过付费或账号权限。

## 测试

```bash
python3 -m pip install -e '.[test]'
pytest -q
```
