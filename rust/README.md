<div align="center">

# 🦀 rustbox-sdk for Rust

**Async client for the Rustbox judge API, on tokio and reqwest.**

[![crates.io](https://img.shields.io/crates/v/rustbox-sdk?logo=rust&logoColor=white)](https://crates.io/crates/rustbox-sdk)
[![docs.rs](https://img.shields.io/docsrs/rustbox-sdk?logo=docs.rs)](https://docs.rs/rustbox-sdk)
[![MSRV](https://img.shields.io/badge/MSRV-1.82-f74c00?logo=rust&logoColor=white)](./Cargo.toml)

</div>

---

`rustbox-sdk` runs untrusted code on Rustbox and returns typed results. Behaviour shared with the other SDKs (retries, regions, verdicts) is described in the [SDK index](../README.md).

## 🚀 Quickstart

```bash
cargo add rustbox-sdk
cargo add tokio --features macros,rt-multi-thread
```

```rust
use rustbox_sdk::{RunRequest, Rustbox, Verdict};

#[tokio::main]
async fn main() -> rustbox_sdk::Result<()> {
    let client = Rustbox::new(&std::env::var("RUSTBOX_API_KEY").unwrap_or_default())?;
    let execution = client
        .run(&RunRequest {
            language: "python".into(),
            code: "print(6 * 7)".into(),
            stdin: String::new(),
        })
        .await?;
    if execution.result.verdict == Some(Verdict::Accepted) {
        println!("{:?}", execution.output.stdout);
    }
    Ok(())
}
```

## ⚖️ Judge against test cases

```rust
use rustbox_sdk::{JudgeCase, JudgeRequest};

let judged = client
    .judge(&JudgeRequest {
        language: "python".into(),
        code: "a, b = map(int, input().split())\nprint(a + b)".into(),
        cases: vec![
            JudgeCase { stdin: "1 2".into(), expected: "3".into() },
            JudgeCase { stdin: "2 2".into(), expected: "4".into() },
        ],
    })
    .await?;
println!("{}", judged.all_passed);
```

## 📨 Queue now, read later

```rust
let accepted = client.submit(&run, Some("6a0e7c1d-2b3f-4a5e-8d9c-0b1a2c3d4e5f")).await?;
let execution = client.get_result(&accepted.id).await?;
```

A `submit` with an idempotency key is retried on transient failures; with `None` it is sent once.

## ⚙️ Configuration

```rust
use rustbox_sdk::{Options, Rustbox};

let client = Rustbox::with_options(&api_key, Options { region: Some("in".into()), ..Options::default() })?;
```

| Field | Default | Meaning |
|---|---|---|
| `base_url` | `None` | Fixed endpoint; wins over everything else |
| `region` | `None` | A key of `regions`; `RUSTBOX_REGION` is read when unset |
| `regions` | `{"in": "https://api.rustbox.sh"}` | Region table |
| `timeout` | 65 s | Per-request timeout |
| `max_retries` | 2 | Retries for reads and idempotent submits |

`RUSTBOX_BASE_URL` and `RUSTBOX_REGION` are the only environment variables read. `ClientConfig::load` takes the environment as a function, for callers that want to control it.

## 🔒 Errors

`RustboxError` has one variant per kind: `Config`, `Auth { status }`, `RateLimit { retry_after_secs }`, `Server { status }`, `Timeout`, `StillRunning { run_id }` (when `run` uses up its polling budget; fetch `run_id` later with `get_result`), `Api { status, message }`, `Transport` and `Decode`. `status()` returns the HTTP status where there is one.

## 🧪 Development

```bash
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

The tests replay [`../contract`](../contract), shared with the other SDKs.
