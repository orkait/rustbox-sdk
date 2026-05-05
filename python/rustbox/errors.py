class RustboxError(Exception):
    """Base class for all Rustbox SDK errors."""
    pass


class RustboxAuthError(RustboxError):
    """401 / 403 - bad or missing API key."""
    pass


class RustboxRateLimitError(RustboxError):
    """429 - per-key or per-IP rate limit exceeded."""
    pass


class RustboxServerError(RustboxError):
    """5xx - service-side error. Retried automatically up to max_retries."""
    pass


class RustboxTimeoutError(RustboxError):
    """Request timed out after the client's configured timeout_secs."""
    pass
