class JuchachaError(Exception):
    """剧查查 SDK 基础异常。"""


class JuchachaResponseError(JuchachaError):
    """HTTP 或响应格式不符合预期。"""


class JuchachaApiError(JuchachaError):
    """服务端返回业务错误。"""

    def __init__(self, status_code, message=None, payload=None):
        self.status_code = status_code
        self.message = message or "剧查查接口返回业务错误"
        self.payload = payload
        super().__init__(f"{self.message} (statusCode={status_code})")

