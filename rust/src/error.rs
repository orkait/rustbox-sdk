use thiserror::Error;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum RustboxError {
    #[error("invalid client configuration: {0}")]
    Config(String),
    #[error("API key rejected (HTTP {status})")]
    Auth { status: u16 },
    #[error("rate limited (retry after {retry_after_secs:?}s)")]
    RateLimit { retry_after_secs: Option<u64> },
    #[error("server error (HTTP {status})")]
    Server { status: u16 },
    #[error("request timed out: {0}")]
    Timeout(String),
    #[error("run {run_id} is still running after the polling budget; call get_result later")]
    StillRunning { run_id: String },
    #[error("HTTP {status}: {message}")]
    Api { status: u16, message: String },
    #[error("transport failed: {0}")]
    Transport(String),
    #[error("response decode failed: {0}")]
    Decode(String),
}

impl RustboxError {
    pub fn status(&self) -> Option<u16> {
        match self {
            RustboxError::Auth { status }
            | RustboxError::Server { status }
            | RustboxError::Api { status, .. } => Some(*status),
            RustboxError::RateLimit { .. } => Some(reqwest::StatusCode::TOO_MANY_REQUESTS.as_u16()),
            RustboxError::Config(_)
            | RustboxError::Timeout(_)
            | RustboxError::StillRunning { .. }
            | RustboxError::Transport(_)
            | RustboxError::Decode(_) => None,
        }
    }

    pub fn is_transient(&self) -> bool {
        matches!(
            self,
            RustboxError::Server { .. } | RustboxError::Timeout(_) | RustboxError::Transport(_)
        )
    }
}

pub type Result<T> = std::result::Result<T, RustboxError>;
