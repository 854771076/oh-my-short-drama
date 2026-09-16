from datetime import datetime
from urllib.parse import urljoin

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .errors import JuchachaApiError, JuchachaResponseError
from .output import write_json
from .rankings import RANKING_TYPES, get_ranking_definition
from .signer import SHANGHAI_TIMEZONE, date_signature

DEFAULT_BASE_URL = "https://playlet-applet.dataeye.com"


class JuchachaRankingClient:
    def __init__(
        self,
        *,
        base_url=DEFAULT_BASE_URL,
        authentication="",
        login_user_id="",
        timeout=20,
        retries=2,
        session=None,
        now=None,
    ):
        self.base_url = base_url.rstrip("/") + "/"
        self.authentication = authentication
        self.login_user_id = str(login_user_id or "")
        self.timeout = timeout
        self.session = session or self._create_session(retries)
        self._now = now

    @staticmethod
    def _create_session(retries):
        session = requests.Session()
        policy = Retry(
            total=retries,
            connect=retries,
            read=retries,
            status=retries,
            allowed_methods=frozenset({"GET", "POST"}),
            status_forcelist=(429, 500, 502, 503, 504),
            backoff_factor=0.35,
        )
        adapter = HTTPAdapter(max_retries=policy)
        session.mount("https://", adapter)
        session.mount("http://", adapter)
        return session

    def _current_time(self):
        return self._now() if callable(self._now) else self._now

    def _headers(self):
        return {
            "S": date_signature(self._current_time()),
            "loginUserId": self.login_user_id,
            "authentication": self.authentication or "",
            "Accept": "application/json",
            "User-Agent": "juchacha-ranking-python/0.1.0",
        }

    def request(self, endpoint, *, params=None, method="GET", data=None, json=None):
        if not endpoint.startswith("/"):
            raise ValueError("endpoint 必须是以 / 开头的站内路径")
        url = urljoin(self.base_url, endpoint.lstrip("/"))
        try:
            response = self.session.request(
                method.upper(),
                url,
                params=params,
                data=data,
                json=json,
                headers=self._headers(),
                timeout=self.timeout,
            )
            response.raise_for_status()
        except requests.RequestException as exc:
            raise JuchachaResponseError(f"请求失败：{exc}") from exc
        try:
            payload = response.json()
        except ValueError as exc:
            raise JuchachaResponseError("接口未返回有效 JSON") from exc
        if not isinstance(payload, dict) or "statusCode" not in payload:
            raise JuchachaResponseError("接口响应缺少 statusCode")
        if payload["statusCode"] != 200:
            raise JuchachaApiError(
                payload["statusCode"], payload.get("message"), payload
            )
        return payload

    @staticmethod
    def supported_rankings():
        return {key: definition.title for key, definition in RANKING_TYPES.items()}

    def get_available_dates(self, ranking_type):
        definition = get_ranking_definition(ranking_type)
        if definition.date_endpoint is None:
            return None
        payload = self.request(
            definition.date_endpoint, params=dict(definition.fixed_params)
        )
        content = payload.get("content")
        if not isinstance(content, (dict, list)):
            raise JuchachaResponseError("排行榜日期响应的 content 格式异常")
        return content

    @staticmethod
    def _latest_period(available_dates):
        source = available_dates[0] if isinstance(available_dates, list) else available_dates
        if not isinstance(source, dict):
            raise JuchachaResponseError("无法解析排行榜可用日期")
        for key in ("day", "week", "month"):
            if source.get(key):
                return {key: source[key]}
        raise JuchachaResponseError("排行榜日期响应中没有 day/week/month")

    def resolve_period(self, ranking_type, *, day=None, week=None, month=None):
        supplied = [("day", day), ("week", week), ("month", month)]
        selected = {key: value for key, value in supplied if value is not None}
        if len(selected) > 1:
            raise ValueError("day、week、month 只能指定一个")
        definition = get_ranking_definition(ranking_type)
        if selected or definition.date_endpoint is None:
            return selected
        return self._latest_period(self.get_available_dates(ranking_type))

    def get_ranking(
        self,
        ranking_type,
        *,
        page=1,
        page_size=30,
        day=None,
        week=None,
        month=None,
    ):
        if page < 1 or page_size < 1:
            raise ValueError("page 和 page_size 必须大于 0")
        definition = get_ranking_definition(ranking_type)
        params = dict(definition.fixed_params)
        params.update({"pageId": page, "pageSize": page_size})
        params.update(
            self.resolve_period(
                ranking_type, day=day, week=week, month=month
            )
        )
        return self.request(definition.list_endpoint, params=params)

    def iter_ranking(
        self,
        ranking_type,
        *,
        page_size=30,
        day=None,
        week=None,
        month=None,
        max_pages=None,
    ):
        if max_pages is not None and max_pages < 1:
            raise ValueError("max_pages 必须大于 0")
        definition = get_ranking_definition(ranking_type)
        period = self.resolve_period(
            ranking_type, day=day, week=week, month=month
        )
        page_number = 1
        yielded = 0
        seen_pages = set()
        while max_pages is None or page_number <= max_pages:
            params = dict(definition.fixed_params)
            params.update({"pageId": page_number, "pageSize": page_size})
            params.update(period)
            payload = self.request(definition.list_endpoint, params=params)
            items = payload.get("content")
            if not isinstance(items, list):
                raise JuchachaResponseError("排行榜响应的 content 不是数组")
            if not items:
                break
            fingerprint = repr(items)
            if fingerprint in seen_pages:
                break
            seen_pages.add(fingerprint)
            for item in items:
                yield item
                yielded += 1
            page_info = payload.get("page") or {}
            total = page_info.get("totalRecords")
            if isinstance(total, int) and yielded >= total:
                break
            if len(items) < page_size and isinstance(total, int):
                break
            page_number += 1

    def get_all_ranking(self, ranking_type, **kwargs):
        return list(self.iter_ranking(ranking_type, **kwargs))

    def export_ranking(self, ranking_type, output_path, *, all_pages=True, **kwargs):
        if all_pages:
            content = self.get_all_ranking(ranking_type, **kwargs)
        else:
            content = self.get_ranking(ranking_type, **kwargs).get("content", [])
        payload = {
            "rankingType": ranking_type,
            "rankingTitle": get_ranking_definition(ranking_type).title,
            "retrievedAt": datetime.now(tz=SHANGHAI_TIMEZONE).isoformat(),
            "content": content,
        }
        return write_json(payload, output_path)
