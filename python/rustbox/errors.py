class RustboxError(Exception):
    pass

class RustboxAuthError(RustboxError):
    pass

class RustboxRateLimitError(RustboxError):
    pass

class RustboxServerError(RustboxError):
    pass
