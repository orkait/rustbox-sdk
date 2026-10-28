pub const VERSION: &str = env!("CARGO_PKG_VERSION");
pub const LANG: &str = "rust";

pub const HEADER_API_KEY: &str = "X-API-Key";
pub const HEADER_USER_AGENT: &str = "User-Agent";
pub const HEADER_IDEMPOTENCY_KEY: &str = "Idempotency-Key";
pub const HEADER_RETRY_AFTER: &str = "Retry-After";
pub const IDEMPOTENCY_KEY_LEN: usize = 36;
pub const CONTENT_TYPE_JSON: &str = "application/json";

pub const PATH_SUBMIT: &str = "/api/submit";
pub const PATH_RESULT: &str = "/api/result/{id}";
pub const PATH_JUDGE: &str = "/api/judge";
pub const PATH_LANGUAGES: &str = "/api/languages";
pub const PATH_HEALTH: &str = "/api/health";
pub const PATH_READY: &str = "/api/health/ready";
pub const PATH_ID: &str = "{id}";

pub const QUERY_WAIT: &str = "wait";
pub const WAIT_TRUE: &str = "true";
pub const WAIT_FALSE: &str = "false";
pub const ERROR_FIELD: &str = "error";
pub const UNKNOWN: &str = "UNKNOWN";

pub fn user_agent() -> String {
    format!("rustbox-sdk-{LANG}/{VERSION}")
}
