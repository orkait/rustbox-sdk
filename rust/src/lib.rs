use serde::Serialize;
use std::time::Duration;
use tokio::time::sleep;

pub const DEFAULT_BASE_URL: &str = "https://rustbox-api.orkait.com";

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

#[derive(Serialize)]
pub struct SubmitRequest {
    pub language: String,
    pub code: String,
    pub stdin: String,
    /// Optional profile override. None falls back to server-side default ("judge").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile: Option<Profile>,
}

pub struct Rustbox {
    api_key: String,
    base_url: String,
    client: reqwest::Client,
}

impl Rustbox {
    /// Construct a Rustbox client. `api_key` is required (must be non-empty).
    /// Base URL defaults to `DEFAULT_BASE_URL`; override with `with_base_url`.
    pub fn new(api_key: &str) -> Self {
        assert!(!api_key.is_empty(), "rustbox: api_key required");
        Self {
            api_key: api_key.to_string(),
            base_url: DEFAULT_BASE_URL.to_string(),
            client: reqwest::Client::new(),
        }
    }

    /// Override the API base URL. Use for self-hosted Rustbox or staging.
    /// Trailing slashes are trimmed. Empty string panics.
    pub fn with_base_url(mut self, base_url: &str) -> Self {
        assert!(!base_url.is_empty(), "rustbox: base_url cannot be empty");
        self.base_url = base_url.trim_end_matches('/').to_string();
        self
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    async fn handle(&self, req: reqwest::RequestBuilder) -> Result<serde_json::Value, String> {
        let resp = req
            .header("X-API-Key", &self.api_key)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let status = resp.status();
        if !status.is_success() && status.as_u16() != 408 {
            return Err(format!("API Error: {}", status));
        }
        resp.json().await.map_err(|e| e.to_string())
    }

    pub async fn submit(
        &self,
        req: &SubmitRequest,
        wait: bool,
    ) -> Result<serde_json::Value, String> {
        let url = format!("{}/api/submit?wait={}", self.base_url, wait);
        self.handle(self.client.post(&url).json(req)).await
    }

    pub async fn get_result(&self, id: &str) -> Result<serde_json::Value, String> {
        let url = format!("{}/api/result/{}", self.base_url, id);
        self.handle(self.client.get(&url)).await
    }

    pub async fn get_languages(&self) -> Result<Vec<String>, String> {
        let url = format!("{}/api/languages", self.base_url);
        let val = self.handle(self.client.get(&url)).await?;
        serde_json::from_value(val).map_err(|e| e.to_string())
    }

    pub async fn get_health(&self) -> Result<serde_json::Value, String> {
        let url = format!("{}/api/health", self.base_url);
        self.handle(self.client.get(&url)).await
    }

    pub async fn get_ready(&self) -> Result<serde_json::Value, String> {
        let url = format!("{}/api/health/ready", self.base_url);
        self.handle(self.client.get(&url)).await
    }

    pub async fn run(&self, req: &SubmitRequest) -> Result<serde_json::Value, String> {
        let mut res = self.submit(req, true).await?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[tokio::test]
    async fn new_should_default_base_url_to_production() {
        let client = Rustbox::new("k");
        assert_eq!(client.base_url(), DEFAULT_BASE_URL);
    }

    #[tokio::test]
    async fn new_should_panic_when_api_key_empty() {
        let r = std::panic::catch_unwind(|| Rustbox::new(""));
        assert!(r.is_err());
    }

    #[tokio::test]
    async fn with_base_url_should_override_default_and_trim_slash() {
        let client = Rustbox::new("k").with_base_url("https://custom.example.com/");
        assert_eq!(client.base_url(), "https://custom.example.com");
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

        let client = Rustbox::new("test").with_base_url(&mock_server.uri());

        let req = SubmitRequest {
            language: "python".into(),
            code: "print(1)".into(),
            stdin: "".into(),
            profile: None,
        };
        let res = client.run(&req).await.unwrap();
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

        let client = Rustbox::new("test").with_base_url(&mock_server.uri());

        let req = SubmitRequest {
            language: "python".into(),
            code: "while True: pass".into(),
            stdin: "".into(),
            profile: Some(Profile::Agent),
        };
        let res = client.run(&req).await.unwrap();
        assert_eq!(res.get("verdict").unwrap().as_str().unwrap(), "TLE");
    }
}
