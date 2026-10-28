use std::collections::{BTreeMap, VecDeque};
use std::sync::Mutex;
use std::time::Duration;

use rustbox_sdk::config::{self, ClientConfig, Options};
use rustbox_sdk::constants;
use rustbox_sdk::models::TERMINAL_STATUSES;
use rustbox_sdk::{
    Execution, HealthStatus, JudgeCase, JudgeRequest, RunRequest, Rustbox, RustboxError, Status,
    Verdict,
};
use serde::Deserialize;
use serde_json::{json, Value};
use wiremock::matchers::any;
use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate};

const CONTRACT_JSON: &str = include_str!("../../contract/contract.json");
const SCENARIOS_JSON: &str = include_str!("../../contract/scenarios.json");
const API_KEY: &str = "rb_contract_test";
const UNMATCHED: u16 = 599;

#[derive(Deserialize)]
struct Contract {
    user_agent: String,
    operations: Vec<String>,
    config_cases: Vec<ConfigCase>,
    resolution: Vec<ResolutionCase>,
    region_cases: Vec<RegionCase>,
    #[serde(flatten)]
    values: BTreeMap<String, Value>,
}

#[derive(Deserialize)]
struct ConfigCase {
    name: String,
    api_key: String,
    max_retries: Option<i64>,
    timeout_secs: Option<f64>,
    regions: Option<BTreeMap<String, String>>,
    expect_error: Option<String>,
}

#[derive(Deserialize)]
struct ResolutionCase {
    name: String,
    base_url: Option<String>,
    env_base_url: Option<String>,
    region: Option<String>,
    env_region: Option<String>,
    expect: Option<String>,
    expect_error: Option<String>,
}

#[derive(Deserialize)]
struct RegionCase {
    name: String,
    pin: Option<String>,
    regions: BTreeMap<String, RegionSpec>,
    expect: Vec<Value>,
    calls: BTreeMap<String, Counts>,
}

#[derive(Deserialize)]
struct RegionSpec {
    health: HealthSpec,
    languages: Canned,
}

#[derive(Deserialize)]
struct HealthSpec {
    status: u16,
    delay_ms: u64,
}

#[derive(Deserialize, Debug, PartialEq)]
struct Counts {
    health: usize,
    languages: usize,
}

#[derive(Deserialize)]
struct Scenarios {
    scenarios: Vec<Scenario>,
}

#[derive(Deserialize)]
struct Scenario {
    name: String,
    call: Call,
    exchanges: Vec<Exchange>,
    expect: Value,
}

#[derive(Deserialize)]
struct Call {
    op: String,
    language: Option<String>,
    code: Option<String>,
    stdin: Option<String>,
    id: Option<String>,
    idempotency_key: Option<String>,
    cases: Option<Vec<JudgeCase>>,
}

#[derive(Deserialize)]
struct Exchange {
    times: Option<usize>,
    request: ExpectedRequest,
    response: Canned,
}

#[derive(Deserialize)]
struct ExpectedRequest {
    method: String,
    path: String,
    #[serde(default)]
    query: BTreeMap<String, String>,
    body: Option<Value>,
    idempotency_key: Option<String>,
}

#[derive(Deserialize, Clone)]
struct Canned {
    status: u16,
    #[serde(default)]
    headers: BTreeMap<String, String>,
    body: Value,
}

fn contract() -> Contract {
    serde_json::from_str(CONTRACT_JSON).expect("sdk/contract/contract.json")
}

fn kind(error: &RustboxError) -> &'static str {
    match error {
        RustboxError::Config(_) => "config",
        RustboxError::Auth { .. } => "auth",
        RustboxError::RateLimit { .. } => "rate_limit",
        RustboxError::Server { .. } => "server",
        RustboxError::Timeout(_) => "timeout",
        RustboxError::StillRunning { .. } => "still_running",
        RustboxError::Api { .. } => "api",
        RustboxError::Transport(_) => "transport",
        RustboxError::Decode(_) => "decode",
    }
}

const ERROR_KINDS: [&str; 9] = [
    "config",
    "auth",
    "rate_limit",
    "server",
    "timeout",
    "still_running",
    "api",
    "transport",
    "decode",
];

fn bindings() -> Vec<(&'static str, Value)> {
    vec![
        ("version", json!(constants::VERSION)),
        ("regions", json!(config::default_regions())),
        ("default_region", json!(config::DEFAULT_REGION)),
        (
            "region_selection",
            json!({
                "probe_path": constants::PATH_HEALTH,
                "probe_timeout_ms": config::PROBE_TIMEOUT.as_millis(),
                "cache_ttl_secs": config::REGION_CACHE_TTL.as_secs(),
                "failover_penalty_secs": config::FAILOVER_PENALTY.as_secs(),
            }),
        ),
        (
            "env",
            json!({ "base_url": config::ENV_BASE_URL, "region": config::ENV_REGION }),
        ),
        (
            "headers",
            json!({
                "api_key": constants::HEADER_API_KEY,
                "user_agent": constants::HEADER_USER_AGENT,
                "idempotency_key": constants::HEADER_IDEMPOTENCY_KEY,
                "retry_after": constants::HEADER_RETRY_AFTER,
            }),
        ),
        ("timeout_secs", json!(config::TIMEOUT.as_secs())),
        (
            "retry",
            json!({
                "max_retries": config::MAX_RETRIES,
                "backoff_base_ms": config::BACKOFF_BASE.as_millis(),
                "backoff_cap_ms": config::BACKOFF_CAP.as_millis(),
            }),
        ),
        (
            "poll",
            json!({
                "max_polls": config::POLL_MAX,
                "first_delay_ms": config::POLL_FIRST_DELAY.as_millis(),
                "growth": config::POLL_GROWTH,
                "cap_ms": config::POLL_CAP.as_millis(),
            }),
        ),
        (
            "paths",
            json!({
                "submit": constants::PATH_SUBMIT,
                "result": constants::PATH_RESULT,
                "judge": constants::PATH_JUDGE,
                "languages": constants::PATH_LANGUAGES,
                "health": constants::PATH_HEALTH,
                "ready": constants::PATH_READY,
            }),
        ),
        (
            "verdicts",
            json!(Verdict::KNOWN
                .iter()
                .map(|v| v.as_str())
                .collect::<Vec<_>>()),
        ),
        (
            "statuses",
            json!(Status::KNOWN.iter().map(|s| s.as_str()).collect::<Vec<_>>()),
        ),
        (
            "terminal_statuses",
            json!(TERMINAL_STATUSES
                .iter()
                .map(|s| s.as_str())
                .collect::<Vec<_>>()),
        ),
        (
            "health_statuses",
            json!(HealthStatus::KNOWN
                .iter()
                .map(|h| h.as_str())
                .collect::<Vec<_>>()),
        ),
        ("unknown", json!(constants::UNKNOWN)),
        ("errors", json!(ERROR_KINDS)),
    ]
}

fn no_env(_: &str) -> Option<String> {
    None
}

fn client(options: Options) -> Rustbox {
    Rustbox::from_config(ClientConfig::load(API_KEY, options, no_env).expect("config"))
        .expect("client")
}

fn arg(value: &Option<String>) -> String {
    value.clone().expect("scenario call argument")
}

fn run_request(call: &Call) -> RunRequest {
    RunRequest {
        language: arg(&call.language),
        code: arg(&call.code),
        stdin: arg(&call.stdin),
    }
}

fn observe_execution(execution: Execution) -> Value {
    json!({ "result": {
        "id": execution.id,
        "status": execution.status.as_str(),
        "verdict": execution.result.verdict.map(Verdict::as_str),
        "stdout": execution.output.stdout,
        "exit_code": execution.result.exit_code,
    }})
}

fn observe_error(error: &RustboxError, wanted: &Value) -> Value {
    let seen = json!({
        "kind": kind(error),
        "status": error.status(),
        "retry_after_secs": match error {
            RustboxError::RateLimit { retry_after_secs } => json!(retry_after_secs),
            _ => Value::Null,
        },
        "message": match error {
            RustboxError::Api { message, .. } => json!(message),
            _ => Value::Null,
        },
        "run_id": match error {
            RustboxError::StillRunning { run_id } => json!(run_id),
            _ => Value::Null,
        },
    });
    let keys = wanted
        .as_object()
        .map(|o| o.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    json!({ "error": keys.into_iter().map(|key| (key.clone(), seen[&key].clone())).collect::<serde_json::Map<_, _>>() })
}

async fn invoke(client: &Rustbox, call: &Call) -> rustbox_sdk::Result<Value> {
    Ok(match call.op.as_str() {
        "submit" => {
            let accepted = client
                .submit(&run_request(call), call.idempotency_key.as_deref())
                .await?;
            json!({ "accepted": { "id": accepted.id, "status": accepted.status.as_str() } })
        }
        "run" => observe_execution(client.run(&run_request(call)).await?),
        "get_result" => observe_execution(client.get_result(&arg(&call.id)).await?),
        "judge" => {
            let judged = client
                .judge(&JudgeRequest {
                    language: arg(&call.language),
                    code: arg(&call.code),
                    cases: call.cases.clone().unwrap_or_default(),
                })
                .await?;
            json!({ "judge": {
                "all_passed": judged.all_passed,
                "verdicts": judged.results.iter().map(|r| r.verdict.map(Verdict::as_str)).collect::<Vec<_>>(),
                "passed": judged.results.iter().map(|r| r.passed).collect::<Vec<_>>(),
            }})
        }
        "languages" => json!({ "languages": client.get_languages().await? }),
        "health" => json!({ "health": client.get_health().await?.as_str() }),
        "ready" => json!({ "health": client.get_ready().await?.as_str() }),
        other => panic!("no SDK operation for {other}"),
    })
}

async fn outcome(client: &Rustbox, call: &Call, wanted: &Value) -> Value {
    match invoke(client, call).await {
        Ok(value) => value,
        Err(error) => observe_error(&error, &wanted["error"]),
    }
}

struct Replay(Mutex<VecDeque<Canned>>);

impl Respond for Replay {
    fn respond(&self, _: &Request) -> ResponseTemplate {
        let next = self.0.lock().expect("replay queue").pop_front();
        next.map_or_else(
            || ResponseTemplate::new(UNMATCHED),
            |canned| {
                canned
                    .headers
                    .iter()
                    .fold(
                        ResponseTemplate::new(canned.status),
                        |template, (name, value)| {
                            template.insert_header(name.as_str(), value.as_str())
                        },
                    )
                    .set_body_json(canned.body)
            },
        )
    }
}

fn check_request(
    name: &str,
    request: &Request,
    expected: &ExpectedRequest,
    previous_key: Option<String>,
) -> Option<String> {
    assert_eq!(request.method.as_str(), expected.method, "{name}");
    assert_eq!(request.url.path(), expected.path, "{name}");
    let query: BTreeMap<String, String> = request.url.query_pairs().into_owned().collect();
    assert_eq!(query, expected.query, "{name}");
    let header = |key: &str| {
        request
            .headers
            .get(key)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string)
    };
    assert_eq!(
        header(constants::HEADER_API_KEY).as_deref(),
        Some(API_KEY),
        "{name}"
    );
    assert_eq!(
        header(constants::HEADER_USER_AGENT),
        Some(constants::user_agent()),
        "{name}"
    );
    match &expected.body {
        Some(body) => assert_eq!(
            &serde_json::from_slice::<Value>(&request.body).expect("json body"),
            body,
            "{name}"
        ),
        None => assert!(request.body.is_empty(), "{name}"),
    }
    let key = header(constants::HEADER_IDEMPOTENCY_KEY);
    match expected.idempotency_key.as_deref().unwrap_or("absent") {
        "absent" => assert_eq!(key, None, "{name}"),
        "uuid" => assert!(key.as_deref().is_some_and(uuid_like), "{name}"),
        "repeat" => assert!(key.is_some() && key == previous_key, "{name}"),
        literal => assert_eq!(key.as_deref(), Some(literal), "{name}"),
    }
    key
}

fn uuid_like(value: &str) -> bool {
    let groups: Vec<usize> = value.split('-').map(str::len).collect();
    groups == [8, 4, 4, 4, 12] && value.chars().all(|c| c == '-' || c.is_ascii_hexdigit())
}

#[test]
fn sdk_matches_the_contract() {
    let contract = contract();
    for (key, value) in bindings() {
        assert_eq!(contract.values.get(key), Some(&value), "{key}");
    }
    assert_eq!(
        constants::user_agent(),
        contract
            .user_agent
            .replace("{lang}", constants::LANG)
            .replace("{version}", constants::VERSION)
    );
}

#[test]
fn every_contract_operation_is_exercised() {
    let contract = contract();
    let scenarios: Scenarios = serde_json::from_str(SCENARIOS_JSON).expect("scenarios");
    let mut ops: Vec<String> = scenarios
        .scenarios
        .iter()
        .map(|s| s.call.op.clone())
        .collect();
    ops.sort();
    ops.dedup();
    let mut expected = contract.operations.clone();
    expected.sort();
    assert_eq!(ops, expected);
}

#[test]
fn client_config() {
    for case in contract().config_cases {
        let loaded = u32::try_from(case.max_retries.unwrap_or(i64::from(config::MAX_RETRIES)))
            .map_err(|e| RustboxError::Config(e.to_string()))
            .and_then(|max_retries| {
                ClientConfig::load(
                    &case.api_key,
                    Options {
                        regions: case.regions.clone().unwrap_or_else(config::default_regions),
                        timeout: case
                            .timeout_secs
                            .map_or(config::TIMEOUT, Duration::from_secs_f64),
                        max_retries,
                        ..Options::default()
                    },
                    no_env,
                )
            });
        match case.expect_error {
            Some(_) => assert!(
                matches!(loaded, Err(RustboxError::Config(_))),
                "{}",
                case.name
            ),
            None => assert!(loaded.is_ok(), "{}", case.name),
        }
    }
}

#[test]
fn base_url_resolution() {
    let regions = config::default_regions();
    for case in contract().resolution {
        let env = |key: &str| match key {
            config::ENV_BASE_URL => case.env_base_url.clone(),
            config::ENV_REGION => case.env_region.clone(),
            _ => None,
        };
        let resolved = config::pinned_base_url(
            case.base_url.as_deref(),
            case.region.as_deref(),
            env,
            &regions,
        )
        .map(|pinned| pinned.or_else(|| regions.get(config::DEFAULT_REGION).cloned()));
        match case.expect_error {
            Some(_) => assert!(
                matches!(resolved, Err(RustboxError::Config(_))),
                "{}",
                case.name
            ),
            None => assert_eq!(resolved, Ok(case.expect.clone()), "{}", case.name),
        }
    }
}

#[tokio::test]
async fn scenarios() {
    let scenarios: Scenarios = serde_json::from_str(SCENARIOS_JSON).expect("scenarios");
    for scenario in scenarios.scenarios {
        let server = MockServer::builder().start().await;
        let exchanges: Vec<&Exchange> = scenario
            .exchanges
            .iter()
            .flat_map(|e| std::iter::repeat_n(e, e.times.unwrap_or(1)))
            .collect();
        let queue = exchanges.iter().map(|e| e.response.clone()).collect();
        Mock::given(any())
            .respond_with(Replay(Mutex::new(queue)))
            .mount(&server)
            .await;
        let rustbox = client(Options {
            base_url: Some(server.uri()),
            ..Options::default()
        });
        assert_eq!(
            outcome(&rustbox, &scenario.call, &scenario.expect).await,
            scenario.expect,
            "{}",
            scenario.name
        );
        let requests = server.received_requests().await.expect("recording");
        assert_eq!(requests.len(), exchanges.len(), "{}", scenario.name);
        let mut key = None;
        for (request, exchange) in requests.iter().zip(&exchanges) {
            key = check_request(&scenario.name, request, &exchange.request, key);
        }
    }
}

#[tokio::test]
async fn region_selection() {
    for case in contract().region_cases {
        let run = uuid::Uuid::new_v4().simple().to_string();
        let mut servers = BTreeMap::new();
        for (name, spec) in &case.regions {
            let server = MockServer::builder().start().await;
            Mock::given(wiremock::matchers::path(format!(
                "/{run}{}",
                constants::PATH_HEALTH
            )))
            .respond_with(
                ResponseTemplate::new(spec.health.status)
                    .set_delay(Duration::from_millis(spec.health.delay_ms))
                    .set_body_json(json!({ "status": "ok" })),
            )
            .mount(&server)
            .await;
            Mock::given(wiremock::matchers::path(format!(
                "/{run}{}",
                constants::PATH_LANGUAGES
            )))
            .respond_with(
                ResponseTemplate::new(spec.languages.status).set_body_json(&spec.languages.body),
            )
            .mount(&server)
            .await;
            servers.insert(name.clone(), server);
        }
        let regions: BTreeMap<String, String> = servers
            .iter()
            .map(|(name, server)| (name.clone(), format!("{}/{run}", server.uri())))
            .collect();
        let languages = Call {
            op: "languages".into(),
            language: None,
            code: None,
            stdin: None,
            id: None,
            idempotency_key: None,
            cases: None,
        };
        for wanted in &case.expect {
            let rustbox = client(Options {
                region: case.pin.clone(),
                regions: regions.clone(),
                ..Options::default()
            });
            assert_eq!(
                &outcome(&rustbox, &languages, wanted).await,
                wanted,
                "{}",
                case.name
            );
        }
        let mut calls = BTreeMap::new();
        for (name, server) in &servers {
            let requests = server.received_requests().await.expect("recording");
            let count = |path: &str| {
                requests
                    .iter()
                    .filter(|r| r.url.path().ends_with(path))
                    .count()
            };
            calls.insert(
                name.clone(),
                Counts {
                    health: count(constants::PATH_HEALTH),
                    languages: count(constants::PATH_LANGUAGES),
                },
            );
        }
        assert_eq!(calls, case.calls, "{}", case.name);
    }
}
