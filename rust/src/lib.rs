mod client;
pub mod config;
pub mod constants;
mod error;
pub mod models;
mod regions;
mod transport;

pub use client::Rustbox;
pub use config::{ClientConfig, Options, DEFAULT_REGION, REGIONS};
pub use constants::VERSION;
pub use error::{Result, RustboxError};
pub use models::{
    Accepted, CaseResult, Execution, HealthStatus, JudgeCase, JudgeRequest, JudgeResult, Metrics,
    Outcome, Output, RunRequest, Status, Timestamps, Verdict,
};
