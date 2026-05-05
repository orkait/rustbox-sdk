<div align="center">

# 🦀 Rustbox Rust SDK

[![Crates.io](https://img.shields.io/crates/v/rustbox-sdk?logo=rust&color=f74c00)](https://crates.io/crates/rustbox-sdk)
[![docs.rs](https://img.shields.io/docsrs/rustbox-sdk?logo=docsdotrs)](https://docs.rs/rustbox-sdk)

</div>

Async via `tokio` + `reqwest`. Builder-style configuration.

## 🚀 Install

```bash
cargo add rustbox-sdk tokio --features tokio/macros,tokio/rt-multi-thread
```

> ⏳ First release (v0.1.0) ships once `sdk/rust/v0.1.0` tag is pushed. Pipeline ready: see [`PUBLISHING.md`](../PUBLISHING.md). Until then, depend via git: `rustbox-sdk = { git = "https://github.com/orkait/rustbox-sdk", branch = "main" }`.

## ⚡ Quickstart

```rust
use rustbox_sdk::{Rustbox, SubmitRequest};

#[tokio::main]
async fn main() -> Result<(), String> {
    let client = Rustbox::new(&std::env::var("RUSTBOX_API_KEY").unwrap());
    let req = SubmitRequest {
        language: "python".into(),
        code: "print('hello')".into(),
        stdin: "".into(),
    };
    let result = client.run(&req).await?;
    println!("{} {}", result["verdict"], result["stdout"]);  // AC hello
    Ok(())
}
```

`run()` submits, waits for sync completion, polls if needed, returns the verdict.

### Profiles

```rust
use rustbox_sdk::{Rustbox, SubmitRequest, Profile};

// Judge profile (default) - short evaluation runs, no egress proxy.
client.run(&SubmitRequest {
    language: "python".into(), code: "print(1)".into(),
    stdin: "".into(), profile: None,
}).await?;

// Agent profile - longer jobs, egress proxy on, per-key byte budget.
// Requires a non-trial API key.
client.run(&SubmitRequest {
    language: "python".into(), code: "...".into(),
    stdin: "".into(), profile: Some(Profile::Agent),
}).await?;
```

## ⚠️ Errors

Today the Rust SDK returns `Result<_, String>`:

```rust
match client.run(&req).await {
    Ok(result) => { /* result["verdict"] */ }
    Err(msg) => { /* "API Error: 401 Unauthorized" or transport error */ }
}
```

A `RustboxError` enum (via `thiserror`) is planned. See [`../ROADMAP.md`](../ROADMAP.md). For now, treat any error as transient and back off.

<details>
<summary><strong>🧰 Full API</strong></summary>

| Method | Returns | Notes |
|---|---|---|
| `Rustbox::new(api_key)` | `Rustbox` | empty `api_key` panics |
| `.with_base_url(url)` | `Rustbox` | builder method, trims trailing slash |
| `client.run(&req).await` | `Result<Value, String>` | Submit + wait + auto-poll |
| `client.submit(&req, wait).await` | `Result<Value, String>` | Low-level, no polling |
| `client.get_result(id).await` | `Result<Value, String>` | Poll a job by id |
| `client.get_languages().await` | `Result<Vec<String>, String>` | Available runtimes |
| `client.get_health().await` | `Result<Value, String>` | Service health |
| `client.get_ready().await` | `Result<Value, String>` | K8s-style readiness |

```rust
pub struct SubmitRequest {
    pub language: String,
    pub code: String,
    pub stdin: String,
}
```

`Value` is `serde_json::Value`. Pull fields with `result["verdict"]` or deserialize via `serde_json::from_value` into your own struct.

</details>

<details>
<summary><strong>🧪 Tests</strong></summary>

```bash
cd sdk/rust && cargo test
```

`wiremock` mocks. No network.

</details>

## 🔗

- 📦 [crates.io: rustbox-sdk](https://crates.io/crates/rustbox-sdk)
- 📚 [docs.rs](https://docs.rs/rustbox-sdk)
- 🪝 [Webhooks](../WEBHOOKS.md)
- 🛣️ [Roadmap](../ROADMAP.md)
- 🦀 [SDK index](../README.md)
