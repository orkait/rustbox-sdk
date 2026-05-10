<div align="center">

# 🦀 Rustbox Rust SDK

[![Crates.io](https://img.shields.io/crates/v/rustbox-sdk?logo=rust&color=f74c00)](https://crates.io/crates/rustbox-sdk)
[![docs.rs](https://img.shields.io/docsrs/rustbox-sdk?logo=docsdotrs)](https://docs.rs/rustbox-sdk)

</div>

Async via `tokio` + `reqwest`. Builder-style configuration. Typed errors via `thiserror`.

## 🚀 Install

```bash
cargo add rustbox-sdk tokio --features tokio/macros,tokio/rt-multi-thread
```

## ⚡ Quickstart

```rust
use rustbox_sdk::{Rustbox, SubmitRequest};

#[tokio::main]
async fn main() -> Result<(), rustbox_sdk::RustboxError> {
    let client = Rustbox::new(&std::env::var("RUSTBOX_API_KEY").unwrap())?;
    let result = client.run(&SubmitRequest {
        language: "python".into(),
        code:     "print('hello')".into(),
        ..Default::default()
    }).await?;
    println!("{} {}", result["verdict"], result["stdout"]);  // AC hello
    Ok(())
}
```

`run()` submits, waits for sync completion, polls if needed, returns the verdict.

### Profiles

```rust
use rustbox_sdk::{Profile, SubmitRequest};

// Judge profile (default) - short evaluation runs, no egress proxy.
client.run(&SubmitRequest {
    language: "python".into(),
    code: "print(1)".into(),
    ..Default::default()
}).await?;

// Agent profile - longer jobs, egress proxy on, per-key byte budget.
// Requires a non-trial API key.
client.run(&SubmitRequest {
    language: "python".into(),
    code: "...".into(),
    profile: Some(Profile::Agent),
    ..Default::default()
}).await?;
```

## 🔒 Errors

```rust
use rustbox_sdk::RustboxError;

match client.run(&req).await {
    Ok(result) => { /* result["verdict"] */ }
    Err(RustboxError::Auth(_))    => { /* 401/403 - check api_key */ }
    Err(RustboxError::RateLimit)  => { /* 429 - back off */ }
    Err(RustboxError::Server(_))  => { /* 5xx - SDK already retried */ }
    Err(RustboxError::Timeout)    => { /* request exceeded timeout */ }
    Err(e)                        => { /* Transport, Decode, Api, ... */ }
}
```

<details>
<summary><strong>🧰 Full API</strong></summary>

| Method | Returns |
|---|---|
| `Rustbox::new(api_key)` | `Result<Rustbox, RustboxError>` |
| `.with_base_url(url)` | `Result<Rustbox, RustboxError>` (builder) |
| `.with_timeout(d)` | `Result<Rustbox, RustboxError>` (builder) |
| `.with_max_retries(n)` | `Rustbox` (builder) |
| `client.run(&req).await` | `Result<Value, RustboxError>` |
| `client.submit(&req, wait, opts).await` | `Result<Value, RustboxError>` |
| `client.get_result(id).await` | `Result<Value, RustboxError>` |
| `client.get_languages().await` | `Result<Vec<String>, RustboxError>` |
| `client.get_health().await` | `Result<Value, RustboxError>` |
| `client.get_ready().await` | `Result<Value, RustboxError>` |

```rust
pub struct SubmitRequest {
    pub language: String,
    pub code: String,
    pub stdin: String,
    pub profile: Option<Profile>,         // judge | agent
}
// Implements Default - use `..Default::default()` to omit optionals.
```

`Value` is `serde_json::Value`. Pull fields with `result["verdict"]` or `serde_json::from_value` into your own struct.

</details>

<details>
<summary><strong>🧪 Tests</strong></summary>

```bash
cd rust && cargo test
```

`wiremock` mocks. No network.

</details>

## 🔗

- 📦 [crates.io: rustbox-sdk](https://crates.io/crates/rustbox-sdk)
- 📚 [docs.rs](https://docs.rs/rustbox-sdk)
- 🪝 [Webhooks](../WEBHOOKS.md)
- 🛣️ [Roadmap](../ROADMAP.md)
- 🦀 [SDK index](../README.md)
