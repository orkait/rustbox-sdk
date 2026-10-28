export const ABSENT = null;

export const VERSION = "0.6.0";
export const USER_AGENT = `rustbox-sdk-ts/${VERSION}`;

export const HEADER_API_KEY = "X-API-Key";
export const HEADER_USER_AGENT = "User-Agent";
export const HEADER_CONTENT_TYPE = "Content-Type";
export const HEADER_IDEMPOTENCY_KEY = "Idempotency-Key";
export const HEADER_RETRY_AFTER = "Retry-After";
export const CONTENT_TYPE_JSON = "application/json";

export const GET = "GET";
export const POST = "POST";
export type Method = typeof GET | typeof POST;

export const PATH_SUBMIT = "/api/submit";
export const PATH_RESULT = "/api/result/{id}";
export const PATH_JUDGE = "/api/judge";
export const PATH_LANGUAGES = "/api/languages";
export const PATH_HEALTH = "/api/health";
export const PATH_READY = "/api/health/ready";
export const PATH_ID = "{id}";

export const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const QUERY_WAIT = "wait";
export const WAIT_TRUE = "true";
export const WAIT_FALSE = "false";
export const ERROR_FIELD = "error";
export const UNKNOWN = "UNKNOWN";

export const MS_PER_SEC = 1000;

export const HTTP_OK = 200;
export const HTTP_ACCEPTED = 202;
export const HTTP_UNAUTHORIZED = 401;
export const HTTP_FORBIDDEN = 403;
export const HTTP_REQUEST_TIMEOUT = 408;
export const HTTP_TOO_MANY_REQUESTS = 429;
export const HTTP_SERVER_ERROR = 500;
