from datetime import datetime
from hashlib import md5
from zoneinfo import ZoneInfo

SHANGHAI_TIMEZONE = ZoneInfo("Asia/Shanghai")


def shanghai_date(now=None):
    current = now or datetime.now(tz=SHANGHAI_TIMEZONE)
    if current.tzinfo is None:
        current = current.replace(tzinfo=SHANGHAI_TIMEZONE)
    else:
        current = current.astimezone(SHANGHAI_TIMEZONE)
    return current.strftime("%Y-%m-%d")


def date_signature(now=None):
    source = shanghai_date(now)
    return md5(source.encode("utf-8")).hexdigest()

