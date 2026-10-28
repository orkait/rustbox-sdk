from http import HTTPStatus
from typing import Final


class RustboxError(Exception):
    pass


class RustboxConfigError(RustboxError):
    pass


class RustboxAuthError(RustboxError):
    def __init__(self, status: int) -> None:
        super().__init__(f"API key rejected (HTTP {status})")
        self.status = status


class RustboxRateLimitError(RustboxError):
    status = HTTPStatus.TOO_MANY_REQUESTS

    def __init__(self, retry_after_secs: int | None) -> None:
        super().__init__(f"rate limited (retry after {retry_after_secs}s)")
        self.retry_after_secs = retry_after_secs


class RustboxServerError(RustboxError):
    def __init__(self, status: int) -> None:
        super().__init__(f"server error (HTTP {status})")
        self.status = status


class RustboxApiError(RustboxError):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(f"HTTP {status}: {message}")
        self.status = status
        self.message = message


class RustboxTimeoutError(RustboxError):
    pass


class RustboxStillRunningError(RustboxError):
    def __init__(self, run_id: str) -> None:
        super().__init__(f"run {run_id} is still running after the polling budget; call get_result later")
        self.run_id = run_id


class RustboxTransportError(RustboxError):
    pass


class RustboxDecodeError(RustboxError):
    pass


TRANSIENT_ERRORS: Final = (RustboxServerError, RustboxTimeoutError, RustboxTransportError)
