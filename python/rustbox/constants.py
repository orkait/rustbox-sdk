import re
from typing import Final, Literal, TypeAlias

VERSION: Final = "0.6.0"
USER_AGENT: Final = f"rustbox-sdk-py/{VERSION}"

HEADER_API_KEY: Final = "X-API-Key"
HEADER_USER_AGENT: Final = "User-Agent"
HEADER_IDEMPOTENCY_KEY: Final = "Idempotency-Key"
HEADER_RETRY_AFTER: Final = "Retry-After"

Method: TypeAlias = Literal["GET", "POST"]
GET: Final[Method] = "GET"
POST: Final[Method] = "POST"

PATH_SUBMIT: Final = "/api/submit"
PATH_RESULT: Final = "/api/result/{id}"
PATH_JUDGE: Final = "/api/judge"
PATH_LANGUAGES: Final = "/api/languages"
PATH_HEALTH: Final = "/api/health"
PATH_READY: Final = "/api/health/ready"

UUID_PATTERN: Final = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")

QUERY_WAIT: Final = "wait"
WAIT_TRUE: Final = "true"
WAIT_FALSE: Final = "false"
ERROR_FIELD: Final = "error"
UNKNOWN: Final = "UNKNOWN"

MS_PER_SEC: Final = 1000
