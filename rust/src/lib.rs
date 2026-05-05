//! Official Rust client for [Rustbox](https://rustbox.orkait.com).
//!
//! ```no_run
//! use rustbox_sdk::{Rustbox, SubmitRequest};
//! # async fn run() -> Result<(), rustbox_sdk::RustboxError> {
//! let client = Rustbox::new(&std::env::var("RUSTBOX_API_KEY").unwrap())?;
//! let res = client.run(&SubmitRequest {
//!     language: "python".into(),
//!     code: "print('hi')".into(),
//!     stdin: "".into(),
//!     profile: None,
//! }).await?;
//! println!("{}", res["verdict"]);
//! # Ok(()) }
//! ```

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use thiserror::Error;
use tokio::time::sleep;

/// SDK version. Sent in `User-Agent`.
pub const VERSION: &str = "0.1.0";

/// Production endpoint.
pub const DEFAULT_BASE_URL: &str = "https://rustbox-api.orkait.com";

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(65);
const DEFAULT_MAX_RETRIES: u32 = 2;

/// Execution profile.
///
/// - `Profile::Judge` (default): short evaluation runs.
/// - `Profile::Agent`: longer jobs with egress proxy + per-key byte
///   budgets. Requires a non-trial API key.
#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Profile {
    Judge,
    Agent,
}

#[derive(Serialize, Debug, Clone, Default)]
pub struct SubmitRequest {
    pub language: String,
    pub code: String,
    pub stdin: String,
    /// Optional profile override. None falls back to server-side default ("judge").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile: Option<Profile>,
    /// HMAC-signed callback. Server POSTs the result to this URL when
    /// the job finishes. Requires `webhook_secret`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webhook_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webhook_secret: Option<String>,
}

/// Errors returned by the Rustbox client.
#[derive(Debug, Error)]
pub enum RustboxError {
    #[error("api_key required")]
    MissingApiKey,
    #[error("invalid base_url")]
    InvalidBaseUrl,
    #[error("invalid or missing API key (HTTP {0})")]
    Auth(u16),
    #[error("rate limit exceeded (HTTP 429)")]
    RateLimit,
    #[error("server error (HTTP {0})")]
    Server(u16),
    #[error("API error (HTTP {status}): {body}")]
    Api { status: u16, body: String },
    #[error("request timed out")]
    Timeout,
    #[error(transparent)]
    Transport(#[from] reqwest::Error),
    #[error("response decode failed: {0}")]
    Decode(String),
}

/// Optional submit-only knobs that don't belong in the request body.
#[derive(Debug, Clone, Default)]
pub struct SubmitOptions {
    /// `Idempotency-Key` header value. Safe to retry POST /api/submit when set.
    pub idempotency_key: Option<String>,
}

pub struct Rustbox {
    api_key: String,
    base_url: String,
    client: reqwest::Client,
    max_retries: u32,
}

impl Rustbox {
    /// Construct a Rustbox client. `api_key` is required (must be non-empty).
    /// Base URL defaults to `DEFAULT_BASE_URL`; override with `with_base_url`.
    pub fn new(api_key: &str) -> Result<Self, RustboxError> {
        if api_key.is_empty() {
            return Err(RustboxError::MissingApiKey);
        }
        let client = reqwest::Client::builder()
            .timeout(DEFAULT_TIMEOUT)
            .build()
            .map_err(RustboxError::Transport)?;
        Ok(Self {
            api_key: api_key.to_string(),
            base_url: DEFAULT_BASE_URL.to_string(),
            client,
            max_retries: DEFAULT_MAX_RETRIES,
        })
    }

    /// Override the API base URL. Use for staging.
    /// Trailing slashes are trimmed.
    pub fn with_base_url(mut self, base_url: &str) -> Result<Self, RustboxError> {
        if base_url.is_empty() {
            return Err(RustboxError::InvalidBaseUrl);
        }
        self.base_url = base_url.trim_end_matches('/').to_string();
        Ok(self)
    }

    /// Override the per-request timeout. Set `Duration::ZERO` to disable.
    pub fn with_timeout(mut self, timeout: Duration) -> Result<Self, RustboxError> {
        let mut builder = reqwest::Client::builder();
        if !timeout.is_zero() {
            builder = builder.timeout(timeout);
        }
        self.client = builder.build().map_err(RustboxError::Transport)?;
        Ok(self)
    }

    /// Override the retry budget on transient (5xx, network) failures.
    pub fn with_max_retries(mut self, n: u32) -> Self {
        self.max_retries = n;
        self
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    fn backoff_delay(&self, attempt: u32) -> Duration {
        Duration::from_millis((100u64 * (1u64 << attempt.min(8))).min(5_000))
    }

    async fn send_with_retry(
        &self,
        build: impl Fn() -> reqwest::RequestBuilder,
    ) -> Result<reqwest::Response, RustboxError> {
        let mut last_err: Option<RustboxError> = None;
        for attempt in 0..=self.max_retries {
            let req = build()
                .header("X-API-Key", &self.api_key)
                .header("User-Agent", format!("rustbox-sdk-rust/{VERSION}"));
            match req.send().await {
                Ok(resp) => {
                    if resp.status().as_u16() >= 500 && attempt < self.max_retries {
                        sleep(self.backoff_delay(attempt)).await;
                        continue;
                    }
                    return Ok(resp);
                }
                Err(e) => {
                    let is_timeout = e.is_timeout();
                    last_err = Some(if is_timeout {
                        RustboxError::Timeout
                    } else {
                        RustboxError::Transport(e)
                    });
                    if attempt >= self.max_retries {
                        return Err(last_err.unwrap());
                    }
                    sleep(self.backoff_delay(attempt)).await;
                }
            }
        }
        Err(last_err.unwrap_or(RustboxError::Decode("retry exhausted".into())))
    }

    async fn handle(&self, resp: reqwest::Response) -> Result<serde_json::Value, RustboxError> {
        let status = resp.status();
        let code = status.as_u16();
        if status.is_success() || code == 408 {
            return resp
                .json()
                .await
                .map_err(|e| RustboxError::Decode(e.to_string()));
        }
        match code {
            401 | 403 => Err(RustboxError::Auth(code)),
            429 => Err(RustboxError::RateLimit),
            500..=599 => Err(RustboxError::Server(code)),
            _ => {
                let body = resp.text().await.unwrap_or_default();
                Err(RustboxError::Api { status: code, body })
            }
        }
    }

    pub async fn submit(
        &self,
        req: &SubmitRequest,
        wait: bool,
        opts: SubmitOptions,
    ) -> Result<serde_json::Value, RustboxError> {
        let url = format!("{}/api/submit?wait={}", self.base_url, wait);
        let body = serde_json::to_vec(req).map_err(|e| RustboxError::Decode(e.to_string()))?;

        let resp = self
            .send_with_retry(|| {
                let mut rb = self
                    .client
                    .post(&url)
                    .header("Content-Type", "application/json")
                    .body(body.clone());
                if let Some(ref key) = opts.idempotency_key {
                    rb = rb.header("Idempotency-Key", key);
                }
                rb
            })
            .await?;
        self.handle(resp).await
    }

    pub async fn get_result(&self, id: &str) -> Result<serde_json::Value, RustboxError> {
        let url = format!("{}/api/result/{}", self.base_url, id);
        let resp = self.send_with_retry(|| self.client.get(&url)).await?;
        self.handle(resp).await
    }

    pub async fn get_languages(&self) -> Result<Vec<String>, RustboxError> {
        let url = format!("{}/api/languages", self.base_url);
        let resp = self.send_with_retry(|| self.client.get(&url)).await?;
        let val = self.handle(resp).await?;
        serde_json::from_value(val).map_err(|e| RustboxError::Decode(e.to_string()))
    }

    pub async fn get_health(&self) -> Result<serde_json::Value, RustboxError> {
        let url = format!("{}/api/health", self.base_url);
        let resp = self.send_with_retry(|| self.client.get(&url)).await?;
        self.handle(resp).await
    }

    pub async fn get_ready(&self) -> Result<serde_json::Value, RustboxError> {
        let url = format!("{}/api/health/ready", self.base_url);
        let resp = self.send_with_retry(|| self.client.get(&url)).await?;
        self.handle(resp).await
    }

    /// Submit + wait (sync) + auto-poll fallback. Auto-generates an
    /// Idempotency-Key so the underlying POST is safe to retry.
    pub async fn run(&self, req: &SubmitRequest) -> Result<serde_json::Value, RustboxError> {
        let opts = SubmitOptions {
            idempotency_key: Some(idempotency_id()),
        };
        let mut res = self.submit(req, true, opts).await?;
        if res.get("verdict").is_some() {
            return Ok(res);
        }

        let id = match res.get("id").and_then(|v| v.as_str()) {
            Some(i) => i.to_string(),
            None => return Ok(res),
        };

        for i in 0..45 {
            let delay_ms = (40.0 * (1.5_f64).powi(i)).min(600.0) as u64;
            sleep(Duration::from_millis(delay_ms)).await;

            res = self.get_result(&id).await?;
            if res.get("verdict").is_some() {
                return Ok(res);
            }
        }
        Ok(res)
    }
}

// Idempotency key: nanosecond timestamp + process-local atomic counter.
// Unique across concurrent calls within one process; cheap; no deps.
static COUNTER: AtomicU64 = AtomicU64::new(0);
fn idempotency_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{nanos:016x}-{n:016x}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn req() -> SubmitRequest {
        SubmitRequest {
            language: "python".into(),
            code: "print(1)".into(),
            stdin: "".into(),
            profile: None,
            webhook_url: None,
            webhook_secret: None,
        }
    }

    #[tokio::test]
    async fn new_should_default_base_url_to_production() {
        let client = Rustbox::new("k").unwrap();
        assert_eq!(client.base_url(), DEFAULT_BASE_URL);
    }

    #[tokio::test]
    async fn new_should_return_err_when_api_key_empty() {
        let r = Rustbox::new("");
        assert!(matches!(r, Err(RustboxError::MissingApiKey)));
    }

    #[tokio::test]
    async fn with_base_url_should_override_default_and_trim_slash() {
        let client = Rustbox::new("k")
            .unwrap()
            .with_base_url("https://custom.example.com/")
            .unwrap();
        assert_eq!(client.base_url(), "https://custom.example.com");
    }

    #[tokio::test]
    async fn with_base_url_should_return_err_when_empty() {
        let r = Rustbox::new("k").unwrap().with_base_url("");
        assert!(matches!(r, Err(RustboxError::InvalidBaseUrl)));
    }

    #[tokio::test]
    async fn run_should_return_verdict_on_first_response_when_complete() {
        let mock_server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/submit"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(serde_json::json!({"id": "1", "verdict": "AC"})),
            )
            .mount(&mock_server)
            .await;

        let client = Rustbox::new("test")
            .unwrap()
            .with_base_url(&mock_server.uri())
            .unwrap();
        let res = client.run(&req()).await.unwrap();
        assert_eq!(res.get("verdict").unwrap().as_str().unwrap(), "AC");
    }

    #[tokio::test]
    async fn run_should_poll_until_verdict_when_initial_returns_408() {
        let mock_server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/submit"))
            .respond_with(ResponseTemplate::new(408).set_body_json(serde_json::json!({"id": "1"})))
            .mount(&mock_server)
            .await;

        Mock::given(method("GET"))
            .and(path("/api/result/1"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(serde_json::json!({"id": "1", "verdict": "TLE"})),
            )
            .mount(&mock_server)
            .await;

        let client = Rustbox::new("test")
            .unwrap()
            .with_base_url(&mock_server.uri())
            .unwrap();
        let res = client.run(&req()).await.unwrap();
        assert_eq!(res.get("verdict").unwrap().as_str().unwrap(), "TLE");
    }

    #[tokio::test]
    async fn submit_should_return_auth_err_on_401() {
        let mock_server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/submit"))
            .respond_with(ResponseTemplate::new(401))
            .mount(&mock_server)
            .await;

        let client = Rustbox::new("test")
            .unwrap()
            .with_base_url(&mock_server.uri())
            .unwrap();
        let err = client
            .submit(&req(), false, SubmitOptions::default())
            .await
            .unwrap_err();
        assert!(matches!(err, RustboxError::Auth(401)));
    }

    #[tokio::test]
    async fn submit_should_return_rate_limit_on_429() {
        let mock_server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/submit"))
            .respond_with(ResponseTemplate::new(429))
            .mount(&mock_server)
            .await;

        let client = Rustbox::new("test")
            .unwrap()
            .with_base_url(&mock_server.uri())
            .unwrap();
        let err = client
            .submit(&req(), false, SubmitOptions::default())
            .await
            .unwrap_err();
        assert!(matches!(err, RustboxError::RateLimit));
    }

    #[tokio::test]
    async fn submit_should_return_server_err_on_503_after_retries() {
        let mock_server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/submit"))
            .respond_with(ResponseTemplate::new(503))
            .mount(&mock_server)
            .await;

        let client = Rustbox::new("test")
            .unwrap()
            .with_base_url(&mock_server.uri())
            .unwrap()
            .with_max_retries(1);
        let err = client
            .submit(&req(), false, SubmitOptions::default())
            .await
            .unwrap_err();
        assert!(matches!(err, RustboxError::Server(503)));
    }

    #[tokio::test]
    async fn submit_should_send_user_agent_header() {
        let mock_server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/submit"))
            .and(wiremock::matchers::header_regex(
                "user-agent",
                r"^rustbox-sdk-rust/",
            ))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(serde_json::json!({"id": "1", "verdict": "AC"})),
            )
            .mount(&mock_server)
            .await;

        let client = Rustbox::new("test")
            .unwrap()
            .with_base_url(&mock_server.uri())
            .unwrap();
        let res = client
            .submit(&req(), false, SubmitOptions::default())
            .await
            .unwrap();
        assert_eq!(res.get("verdict").unwrap().as_str().unwrap(), "AC");
    }
}
