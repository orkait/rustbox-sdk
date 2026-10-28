use std::collections::BTreeMap;
use std::time::Duration;

use crate::error::{Result, RustboxError};

pub const ENV_BASE_URL: &str = "RUSTBOX_BASE_URL";
pub const ENV_REGION: &str = "RUSTBOX_REGION";
const URL_SCHEMES: [&str; 2] = ["http://", "https://"];

pub const REGIONS: [(&str, &str); 1] = [("in", "https://api.rustbox.sh")];
pub const DEFAULT_REGION: &str = "in";
pub const PROBE_TIMEOUT: Duration = Duration::from_millis(1500);
pub const REGION_CACHE_TTL: Duration = Duration::from_secs(21_600);
pub const FAILOVER_PENALTY: Duration = Duration::from_secs(300);

pub const TIMEOUT: Duration = Duration::from_secs(65);
pub const MAX_RETRIES: u32 = 2;
pub const BACKOFF_BASE: Duration = Duration::from_millis(100);
pub const BACKOFF_CAP: Duration = Duration::from_millis(5000);

pub const POLL_MAX: u32 = 45;
pub const POLL_FIRST_DELAY: Duration = Duration::from_millis(40);
pub const POLL_GROWTH: f64 = 1.5;
pub const POLL_CAP: Duration = Duration::from_millis(600);

pub fn default_regions() -> BTreeMap<String, String> {
    REGIONS
        .iter()
        .map(|(name, url)| (name.to_string(), url.to_string()))
        .collect()
}

pub fn process_env(key: &str) -> Option<String> {
    std::env::var(key).ok()
}

#[derive(Debug, Clone, PartialEq)]
pub struct Options {
    pub base_url: Option<String>,
    pub region: Option<String>,
    pub regions: BTreeMap<String, String>,
    pub timeout: Duration,
    pub max_retries: u32,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            base_url: None,
            region: None,
            regions: default_regions(),
            timeout: TIMEOUT,
            max_retries: MAX_RETRIES,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RetryPolicy {
    pub max_retries: u32,
    pub backoff_base: Duration,
    pub backoff_cap: Duration,
}

impl RetryPolicy {
    pub fn delay(&self, attempt: u32) -> Duration {
        2u32.checked_pow(attempt)
            .map_or(self.backoff_cap, |factor| {
                self.backoff_base.saturating_mul(factor)
            })
            .min(self.backoff_cap)
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PollPolicy {
    pub max_polls: u32,
    pub first_delay: Duration,
    pub growth: f64,
    pub cap: Duration,
}

impl PollPolicy {
    pub fn delays(&self) -> impl Iterator<Item = Duration> + '_ {
        std::iter::successors(Some(self.first_delay), |delay| {
            Some(delay.mul_f64(self.growth).min(self.cap))
        })
        .take(self.max_polls as usize)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct RegionPolicy {
    pub regions: BTreeMap<String, String>,
    pub fallback: String,
    pub probe_timeout: Duration,
    pub cache_ttl: Duration,
    pub failover_penalty: Duration,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ClientConfig {
    pub api_key: String,
    pub pinned_base_url: Option<String>,
    pub timeout: Duration,
    pub retry: RetryPolicy,
    pub poll: PollPolicy,
    pub region: RegionPolicy,
}

fn url(value: &str, what: &str) -> Result<String> {
    if !URL_SCHEMES.iter().any(|scheme| value.starts_with(scheme)) {
        return Err(RustboxError::Config(format!(
            "{what} must start with http:// or https://, got {value:?}"
        )));
    }
    Ok(value.trim_end_matches('/').to_string())
}

fn known_region(regions: &BTreeMap<String, String>, name: &str) -> Result<String> {
    regions.get(name).cloned().ok_or_else(|| {
        let known: Vec<&str> = regions.keys().map(String::as_str).collect();
        RustboxError::Config(format!(
            "unknown region {name:?}; known regions: {}",
            known.join(", ")
        ))
    })
}

fn non_empty(value: Option<String>) -> Option<String> {
    value.filter(|v| !v.is_empty())
}

pub fn pinned_base_url(
    base_url: Option<&str>,
    region: Option<&str>,
    env: impl Fn(&str) -> Option<String>,
    regions: &BTreeMap<String, String>,
) -> Result<Option<String>> {
    if let Some(base_url) = base_url {
        return url(base_url, "base_url").map(Some);
    }
    if let Some(env_base_url) = non_empty(env(ENV_BASE_URL)) {
        return url(&env_base_url, ENV_BASE_URL).map(Some);
    }
    if let Some(region) = region {
        return known_region(regions, region).map(Some);
    }
    non_empty(env(ENV_REGION))
        .map(|region| known_region(regions, &region))
        .transpose()
}

impl ClientConfig {
    pub fn load(
        api_key: &str,
        options: Options,
        env: impl Fn(&str) -> Option<String>,
    ) -> Result<Self> {
        if api_key.is_empty() || !api_key.bytes().all(|byte| byte.is_ascii_graphic()) {
            return Err(RustboxError::Config(
                "api_key is required and must be visible ASCII without spaces".into(),
            ));
        }
        if options.timeout.is_zero() {
            return Err(RustboxError::Config("timeout must be positive".into()));
        }
        let regions = options
            .regions
            .iter()
            .map(|(name, base)| Ok((name.clone(), url(base, &format!("region {name}"))?)))
            .collect::<Result<BTreeMap<String, String>>>()?;
        let fallback = regions
            .get(DEFAULT_REGION)
            .or_else(|| regions.values().next())
            .cloned()
            .ok_or_else(|| RustboxError::Config("regions must not be empty".into()))?;
        let pinned_base_url = pinned_base_url(
            options.base_url.as_deref(),
            options.region.as_deref(),
            env,
            &regions,
        )?;
        Ok(Self {
            api_key: api_key.to_string(),
            pinned_base_url,
            timeout: options.timeout,
            retry: RetryPolicy {
                max_retries: options.max_retries,
                backoff_base: BACKOFF_BASE,
                backoff_cap: BACKOFF_CAP,
            },
            poll: PollPolicy {
                max_polls: POLL_MAX,
                first_delay: POLL_FIRST_DELAY,
                growth: POLL_GROWTH,
                cap: POLL_CAP,
            },
            region: RegionPolicy {
                regions,
                fallback,
                probe_timeout: PROBE_TIMEOUT,
                cache_ttl: REGION_CACHE_TTL,
                failover_penalty: FAILOVER_PENALTY,
            },
        })
    }
}
