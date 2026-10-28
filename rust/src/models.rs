use serde::{Deserialize, Deserializer, Serialize};

use crate::constants::UNKNOWN;

macro_rules! wire_enum {
    ($name:ident { $($variant:ident = $wire:literal),+ $(,)? }) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
        pub enum $name {
            $($variant,)+
            Unknown,
        }

        impl $name {
            pub const KNOWN: &'static [$name] = &[$($name::$variant),+];

            pub fn as_str(self) -> &'static str {
                match self {
                    $($name::$variant => $wire,)+
                    $name::Unknown => UNKNOWN,
                }
            }

            pub fn from_wire(raw: &str) -> Self {
                Self::KNOWN
                    .iter()
                    .copied()
                    .find(|known| known.as_str() == raw)
                    .unwrap_or($name::Unknown)
            }
        }

        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
                Ok(Self::from_wire(&String::deserialize(deserializer)?))
            }
        }
    };
}

wire_enum!(Verdict {
    Accepted = "AC",
    WrongAnswer = "WA",
    RuntimeError = "RE",
    TimeLimit = "TLE",
    MemoryLimit = "MLE",
    OutputLimit = "OLE",
    ProcessLimit = "PLE",
    FileSizeLimit = "FSE",
    Signaled = "SIG",
    SecurityViolation = "SV",
    Abuse = "ABUSE",
    InternalError = "IE",
    WaitTimeout = "TIMEOUT",
});

wire_enum!(Status {
    Pending = "pending",
    Running = "running",
    Completed = "completed",
    Error = "error",
});

wire_enum!(HealthStatus {
    Ok = "ok",
    Ready = "ready",
    NotReady = "not_ready",
});

pub const TERMINAL_STATUSES: [Status; 2] = [Status::Completed, Status::Error];

fn nullable<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    deserializer: D,
) -> Result<Option<T>, D::Error> {
    Option::<T>::deserialize(deserializer)
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Timestamps {
    pub created_at: String,
    #[serde(deserialize_with = "nullable")]
    pub started_at: Option<String>,
    #[serde(deserialize_with = "nullable")]
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Outcome {
    #[serde(deserialize_with = "nullable")]
    pub verdict: Option<Verdict>,
    #[serde(deserialize_with = "nullable")]
    pub exit_code: Option<i32>,
    #[serde(deserialize_with = "nullable")]
    pub signal: Option<i32>,
    #[serde(deserialize_with = "nullable")]
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Output {
    #[serde(deserialize_with = "nullable")]
    pub stdout: Option<String>,
    #[serde(deserialize_with = "nullable")]
    pub stderr: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Metrics {
    #[serde(deserialize_with = "nullable")]
    pub cpu_time_secs: Option<f64>,
    #[serde(deserialize_with = "nullable")]
    pub wall_time_secs: Option<f64>,
    #[serde(deserialize_with = "nullable")]
    pub memory_peak_bytes: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Execution {
    pub id: String,
    pub language: String,
    pub status: Status,
    pub timestamps: Timestamps,
    pub result: Outcome,
    pub output: Output,
    pub metrics: Metrics,
    #[serde(default)]
    pub evidence: Option<serde_json::Map<String, serde_json::Value>>,
}

impl Execution {
    pub fn is_done(&self) -> bool {
        TERMINAL_STATUSES.contains(&self.status) || self.result.verdict.is_some()
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Accepted {
    pub id: String,
    pub status: Status,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub(crate) struct Pending {
    pub id: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub(crate) struct Health {
    pub status: HealthStatus,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RunRequest {
    pub language: String,
    pub code: String,
    pub stdin: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JudgeCase {
    pub stdin: String,
    pub expected: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct JudgeRequest {
    pub language: String,
    pub code: String,
    pub cases: Vec<JudgeCase>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct CaseResult {
    #[serde(deserialize_with = "nullable")]
    pub verdict: Option<Verdict>,
    pub passed: bool,
    #[serde(deserialize_with = "nullable")]
    pub stdout: Option<String>,
    #[serde(deserialize_with = "nullable")]
    pub stderr: Option<String>,
    pub expected: String,
    #[serde(deserialize_with = "nullable")]
    pub exit_code: Option<i32>,
    #[serde(deserialize_with = "nullable")]
    pub wall_time_secs: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct JudgeResult {
    pub results: Vec<CaseResult>,
    pub all_passed: bool,
}
