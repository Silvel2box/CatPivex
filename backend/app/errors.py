"""Application error carrying a contract ErrorCode, rendered as ErrorResponse by main.py."""

from app.models import ErrorCode

STATUS_BY_CODE: dict[str, int] = {
    "invalid_symbol": 400,
    "invalid_interval": 400,
    "validation_error": 422,
    "not_found": 404,
    "rate_limited": 503,
    "upstream_error": 502,
    "internal_error": 500,
}


class ApiError(Exception):
    def __init__(self, code: ErrorCode, message: str):
        super().__init__(message)
        self.code = code
        self.message = message

    @property
    def status_code(self) -> int:
        return STATUS_BY_CODE[self.code]
