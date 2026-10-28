use std::time::{Duration, Instant};

use reqwest::header::{HeaderMap, HeaderValue};
use reqwest::{Method, Response, StatusCode};
use serde::de::DeserializeOwned;
use serde::Deserialize;

use crate::config::RetryPolicy;
use crate::constants::{
    user_agent, CONTENT_TYPE_JSON, HEADER_API_KEY, HEADER_IDEMPOTENCY_KEY, HEADER_RETRY_AFTER,
    HEADER_USER_AGENT,
};
use crate::error::{Result, RustboxError};

#[derive(Debug, Clone)]
pub(crate) struct Request {
    pub method: Method,
    pub path: String,
    pub query: Vec<(&'static str, &'static str)>,
    pub body: Option<Vec<u8>>,
    pub idempotency_key: Option<String>,
}

impl Request {
    pub fn get(path: impl Into<String>) -> Self {
        Self {
            method: Method::GET,
            path: path.into(),
            query: Vec::new(),
            body: None,
            idempotency_key: None,
        }
    }

    pub fn post(path: impl Into<String>, body: &impl serde::Serialize) -> Result<Self> {
        let body = serde_json::to_vec(body).map_err(|e| RustboxError::Decode(e.to_string()))?;
        Ok(Self {
            method: Method::POST,
            path: path.into(),
            query: Vec::new(),
            body: Some(body),
            idempotency_key: None,
        })
    }

    pub fn with_query(mut self, key: &'static str, value: &'static str) -> Self {
        self.query.push((key, value));
        self
    }

    pub fn with_idempotency_key(mut self, key: Option<String>) -> Self {
        self.idempotency_key = key;
        self
    }

    fn retryable(&self) -> bool {
        self.method == Method::GET || self.idempotency_key.is_some()
    }
}

#[derive(Deserialize)]
struct ErrorBody {
    error: String,
}

fn header(value: &str) -> Result<HeaderValue> {
    HeaderValue::from_str(value).map_err(|e| RustboxError::Config(e.to_string()))
}

fn failure(error: &reqwest::Error) -> RustboxError {
    if error.is_timeout() {
        RustboxError::Timeout(error.to_string())
    } else {
        RustboxError::Transport(error.to_string())
    }
}

pub(crate) struct Transport {
    client: reqwest::Client,
    retry: RetryPolicy,
}

impl Transport {
    pub fn new(api_key: &str, timeout: Duration, retry: RetryPolicy) -> Result<Self> {
        let mut headers = HeaderMap::new();
        headers.insert(HEADER_API_KEY, header(api_key)?);
        headers.insert(HEADER_USER_AGENT, header(&user_agent())?);
        let client = reqwest::Client::builder()
            .default_headers(headers)
            .timeout(timeout)
            .build()
            .map_err(|e| RustboxError::Config(e.to_string()))?;
        Ok(Self { client, retry })
    }

    pub async fn send(&self, base: &str, request: &Request) -> Result<Response> {
        let retries = if request.retryable() {
            self.retry.max_retries
        } else {
            0
        };
        let mut attempt = 0;
        loop {
            let last = attempt >= retries;
            match self.attempt(base, request).await {
                Ok(response) if !response.status().is_server_error() => return Ok(response),
                Ok(response) if last => {
                    return Err(RustboxError::Server {
                        status: response.status().as_u16(),
                    })
                }
                Err(error) if last => return Err(failure(&error)),
                _ => tokio::time::sleep(self.retry.delay(attempt)).await,
            }
            attempt += 1;
        }
    }

    pub async fn probe(&self, url: String, timeout: Duration) -> Option<Duration> {
        let started = Instant::now();
        let response = self.client.get(url).timeout(timeout).send().await.ok()?;
        response.status().is_success().then(|| started.elapsed())
    }

    async fn attempt(&self, base: &str, request: &Request) -> reqwest::Result<Response> {
        let mut builder = self
            .client
            .request(request.method.clone(), format!("{base}{}", request.path))
            .query(&request.query);
        if let Some(body) = &request.body {
            builder = builder
                .header(reqwest::header::CONTENT_TYPE, CONTENT_TYPE_JSON)
                .body(body.clone());
        }
        if let Some(key) = &request.idempotency_key {
            builder = builder.header(HEADER_IDEMPOTENCY_KEY, key);
        }
        builder.send().await
    }
}

fn retry_after_secs(response: &Response) -> Option<u64> {
    response
        .headers()
        .get(HEADER_RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse().ok())
}

async fn error_for(response: Response) -> RustboxError {
    let status = response.status();
    if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
        return RustboxError::Auth {
            status: status.as_u16(),
        };
    }
    if status == StatusCode::TOO_MANY_REQUESTS {
        return RustboxError::RateLimit {
            retry_after_secs: retry_after_secs(&response),
        };
    }
    let raw = response.text().await.unwrap_or_default();
    let message = serde_json::from_str::<ErrorBody>(&raw)
        .map(|body| body.error)
        .unwrap_or(raw);
    RustboxError::Api {
        status: status.as_u16(),
        message,
    }
}

pub(crate) async fn json_body<T: DeserializeOwned>(response: Response) -> Result<T> {
    let bytes = response.bytes().await.map_err(|e| failure(&e))?;
    serde_json::from_slice(&bytes).map_err(|e| RustboxError::Decode(e.to_string()))
}

pub(crate) async fn expect<T: DeserializeOwned>(
    response: Response,
    statuses: &[StatusCode],
) -> Result<T> {
    if !statuses.contains(&response.status()) {
        return Err(error_for(response).await);
    }
    json_body(response).await
}
