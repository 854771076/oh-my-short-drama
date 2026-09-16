from datetime import datetime, timezone

import pytest

from juchacha_ranking import (
    JuchachaApiError,
    JuchachaRankingClient,
    date_signature,
)


class FakeResponse:
    def __init__(self, payload, status=200):
        self.payload = payload
        self.status_code = status

    def raise_for_status(self):
        if self.status_code >= 400:
            import requests

            raise requests.HTTPError(f"HTTP {self.status_code}")

    def json(self):
        return self.payload


class FakeSession:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.calls = []

    def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        return FakeResponse(next(self.responses))


FIXED_NOW = datetime(2026, 9, 16, 8, 0, tzinfo=timezone.utc)


def test_fixed_signature_sample():
    assert date_signature(FIXED_NOW) == "0cdf73ff2b30ed7aa6206fde112bee77"


def test_auto_resolves_latest_day_and_sends_verified_headers():
    session = FakeSession(
        [
            {
                "statusCode": 200,
                "page": None,
                "content": {"day": "2026-09-14", "week": "2026-09-08~2026-09-14"},
                "message": None,
            },
            {
                "statusCode": 200,
                "page": {"pageId": 1, "pageSize": 30, "totalRecords": 1},
                "content": [{"ranking": 1, "playletName": "测试剧"}],
                "message": None,
            },
        ]
    )
    client = JuchachaRankingClient(session=session, now=lambda: FIXED_NOW)

    payload = client.get_ranking("hot")

    assert payload["content"][0]["playletName"] == "测试剧"
    assert session.calls[1][2]["params"]["day"] == "2026-09-14"
    assert session.calls[1][2]["headers"]["S"] == "0cdf73ff2b30ed7aa6206fde112bee77"
    assert session.calls[1][2]["headers"]["authentication"] == ""
    assert session.calls[1][2]["headers"]["loginUserId"] == ""


def test_motion_ai_adds_rank_type():
    session = FakeSession(
        [
            {
                "statusCode": 200,
                "page": {"pageId": 1, "pageSize": 30, "totalRecords": 0},
                "content": [],
                "message": None,
            }
        ]
    )
    client = JuchachaRankingClient(session=session, now=FIXED_NOW)

    client.get_ranking("motion-ai", day="2026-09-16")

    assert session.calls[0][2]["params"]["rankType"] == 2


def test_pagination_stops_at_total_records():
    session = FakeSession(
        [
            {
                "statusCode": 200,
                "page": {"pageId": 1, "pageSize": 2, "totalRecords": 3},
                "content": [{"id": 1}, {"id": 2}],
                "message": None,
            },
            {
                "statusCode": 200,
                "page": {"pageId": 2, "pageSize": 2, "totalRecords": 3},
                "content": [{"id": 3}],
                "message": None,
            },
        ]
    )
    client = JuchachaRankingClient(session=session, now=FIXED_NOW)

    result = client.get_all_ranking("income", page_size=2)

    assert result == [{"id": 1}, {"id": 2}, {"id": 3}]
    assert len(session.calls) == 2


def test_business_error_is_not_silenced():
    session = FakeSession(
        [{"statusCode": 401, "page": None, "content": None, "message": "未授权"}]
    )
    client = JuchachaRankingClient(session=session, now=FIXED_NOW)

    with pytest.raises(JuchachaApiError, match="未授权"):
        client.get_ranking("income")


def test_repeated_server_page_stops_pagination():
    repeated = {
        "statusCode": 200,
        "page": {"pageId": 1, "pageSize": 30, "totalRecords": 123},
        "content": [{"ranking": 1, "playletId": 1}],
        "message": None,
    }
    session = FakeSession([repeated, repeated])
    client = JuchachaRankingClient(session=session, now=FIXED_NOW)

    result = client.get_all_ranking("hot", day="2026-09-14", page_size=1)

    assert result == [{"ranking": 1, "playletId": 1}]
    assert len(session.calls) == 2
