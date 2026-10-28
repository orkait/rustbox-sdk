use reqwest::{Response, StatusCode};

use crate::config::{process_env, ClientConfig, Options};
use crate::constants::{
    IDEMPOTENCY_KEY_LEN, PATH_HEALTH, PATH_ID, PATH_JUDGE, PATH_LANGUAGES, PATH_READY, PATH_RESULT,
    PATH_SUBMIT, QUERY_WAIT, WAIT_FALSE, WAIT_TRUE,
};
use crate::error::{Result, RustboxError};
use crate::models::{
    Accepted, Execution, Health, HealthStatus, JudgeRequest, JudgeResult, Pending, RunRequest,
};
use crate::regions::RegionSelector;
use crate::transport::{expect, json_body, Request, Transport};

const UNRESERVED: &[u8] = b"-._~";

fn is_uuid(key: &str) -> bool {
    key.len() == IDEMPOTENCY_KEY_LEN && uuid::Uuid::try_parse(key).is_ok()
}

fn encode_segment(raw: &str) -> String {
    raw.bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || UNRESERVED.contains(&byte) {
                char::from(byte).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect()
}

fn result_path(run_id: &str) -> String {
    PATH_RESULT.replace(PATH_ID, &encode_segment(run_id))
}

pub struct Rustbox {
    config: ClientConfig,
    transport: Transport,
    regions: RegionSelector,
}

impl Rustbox {
    pub fn new(api_key: &str) -> Result<Self> {
        Self::with_options(api_key, Options::default())
    }

    pub fn with_options(api_key: &str, options: Options) -> Result<Self> {
        Self::from_config(ClientConfig::load(api_key, options, process_env)?)
    }

    pub fn from_config(config: ClientConfig) -> Result<Self> {
        let transport = Transport::new(&config.api_key, config.timeout, config.retry)?;
        let regions = RegionSelector::new(config.region.clone(), config.pinned_base_url.clone());
        Ok(Self {
            config,
            transport,
            regions,
        })
    }

    pub async fn base_url(&self) -> String {
        let timeout = self.config.region.probe_timeout;
        self.regions
            .current(|base| {
                self.transport
                    .probe(format!("{base}{PATH_HEALTH}"), timeout)
            })
            .await
    }

    async fn send(&self, base: &str, request: &Request) -> Result<Response> {
        self.transport
            .send(base, request)
            .await
            .inspect_err(|error| {
                if error.is_transient() {
                    self.regions.report_failure(base);
                }
            })
    }

    async fn call(&self, request: &Request) -> Result<Response> {
        let base = self.base_url().await;
        self.send(&base, request).await
    }

    pub async fn submit(
        &self,
        run: &RunRequest,
        idempotency_key: Option<&str>,
    ) -> Result<Accepted> {
        if let Some(key) = idempotency_key.filter(|key| !is_uuid(key)) {
            return Err(RustboxError::Config(format!(
                "idempotency_key must be a UUID, got {key:?}"
            )));
        }
        let request = Request::post(PATH_SUBMIT, run)?
            .with_query(QUERY_WAIT, WAIT_FALSE)
            .with_idempotency_key(idempotency_key.map(str::to_string));
        expect(self.call(&request).await?, &[StatusCode::ACCEPTED]).await
    }

    pub async fn run(&self, run: &RunRequest) -> Result<Execution> {
        let base = self.base_url().await;
        let request = Request::post(PATH_SUBMIT, run)?
            .with_query(QUERY_WAIT, WAIT_TRUE)
            .with_idempotency_key(Some(uuid::Uuid::new_v4().to_string()));
        let response = self.send(&base, &request).await?;
        if response.status() == StatusCode::OK {
            return json_body(response).await;
        }
        let pending: Pending = expect(
            response,
            &[StatusCode::ACCEPTED, StatusCode::REQUEST_TIMEOUT],
        )
        .await?;
        self.poll(&base, &pending.id).await
    }

    async fn poll(&self, base: &str, run_id: &str) -> Result<Execution> {
        for delay in self.config.poll.delays() {
            tokio::time::sleep(delay).await;
            let execution = self.fetch(base, run_id).await?;
            if execution.is_done() {
                return Ok(execution);
            }
        }
        Err(RustboxError::StillRunning {
            run_id: run_id.to_string(),
        })
    }

    async fn fetch(&self, base: &str, run_id: &str) -> Result<Execution> {
        let response = self.send(base, &Request::get(result_path(run_id))).await?;
        expect(response, &[StatusCode::OK]).await
    }

    pub async fn get_result(&self, run_id: &str) -> Result<Execution> {
        let base = self.base_url().await;
        self.fetch(&base, run_id).await
    }

    pub async fn judge(&self, judge: &JudgeRequest) -> Result<JudgeResult> {
        let response = self.call(&Request::post(PATH_JUDGE, judge)?).await?;
        expect(response, &[StatusCode::OK]).await
    }

    pub async fn get_languages(&self) -> Result<Vec<String>> {
        let response = self.call(&Request::get(PATH_LANGUAGES)).await?;
        expect(response, &[StatusCode::OK]).await
    }

    pub async fn get_health(&self) -> Result<HealthStatus> {
        self.health(PATH_HEALTH).await
    }

    pub async fn get_ready(&self) -> Result<HealthStatus> {
        self.health(PATH_READY).await
    }

    async fn health(&self, path: &str) -> Result<HealthStatus> {
        let response = self.call(&Request::get(path)).await?;
        let health: Health = expect(response, &[StatusCode::OK]).await?;
        Ok(health.status)
    }
}
