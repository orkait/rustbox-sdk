<div align="center">

# 🦀 Rustbox SDKs

**Run and judge untrusted code through the Rustbox judge API, from Python, TypeScript, Rust or Go.**

<br />

[![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)](./python/README.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-Node%2020%2B%20%7C%20Bun-3178C6?logo=typescript&logoColor=white)](./typescript/README.md)
[![Rust](https://img.shields.io/badge/Rust-1.82%2B-f74c00?logo=rust&logoColor=white)](./rust/README.md)
[![Go](https://img.shields.io/badge/Go-1.21%2B-00ADD8?logo=go&logoColor=white)](./go/README.md)

</div>

---

Four official clients for the [Rustbox](https://rustbox.sh) judge API. They share one version and one contract: [`contract/contract.json`](./contract/contract.json) fixes the constants, response shapes and error kinds, and [`contract/scenarios.json`](./contract/scenarios.json) fixes the HTTP exchanges. Every SDK replays both in its test suite, so a change in one SDK that the others lack fails CI.

## 🚀 Install

| SDK | Install | Package |
|---|---|---|
| 🐍 Python | `uv add rustbox` | [`rustbox` on PyPI](https://pypi.org/project/rustbox/) |
| 📘 TypeScript | `bun add rustbox` | [`rustbox` on npm](https://www.npmjs.com/package/rustbox) |
| 🦀 Rust | `cargo add rustbox-sdk` | [`rustbox-sdk` on crates.io](https://crates.io/crates/rustbox-sdk) |
| 🦫 Go | `go get github.com/orkait/rustbox-sdk/go@v0.6.0` | [`pkg.go.dev`](https://pkg.go.dev/github.com/orkait/rustbox-sdk/go) |

## ⚡ At a glance

```python
async with Rustbox(os.environ["RUSTBOX_API_KEY"]) as client:
    execution = await client.run("python", "print(1)")
    print(execution.result.verdict, execution.output.stdout)
```

```typescript
const client = new Rustbox(process.env.RUSTBOX_API_KEY ?? "");
const execution = await client.run("python", "print(1)");
console.log(execution.result.verdict, execution.output.stdout);
```

```rust
let client = Rustbox::new(&std::env::var("RUSTBOX_API_KEY").unwrap_or_default())?;
let execution = client
    .run(&RunRequest { language: "python".into(), code: "print(1)".into(), stdin: String::new() })
    .await?;
println!("{:?} {:?}", execution.result.verdict, execution.output.stdout);
```

```go
client, err := rustbox.New(os.Getenv("RUSTBOX_API_KEY"))
if err != nil {
    return err
}
execution, err := client.Run(ctx, rustbox.RunRequest{Language: "python", Code: "print(1)"})
```

## 🧰 Operations

Every SDK exposes the same seven operations, named in each language's style.

| Operation | Python | TypeScript | Rust | Go |
|---|---|---|---|---|
| Queue a run, return at once | `submit` | `submit` | `submit` | `Submit` |
| Run and wait for a terminal result | `run` | `run` | `run` | `Run` |
| Read a run | `get_result` | `getResult` | `get_result` | `GetResult` |
| Run code against test cases | `judge` | `judge` | `judge` | `Judge` |
| List languages | `get_languages` | `getLanguages` | `get_languages` | `GetLanguages` |
| Liveness and readiness | `get_health`, `get_ready` | `getHealth`, `getReady` | `get_health`, `get_ready` | `GetHealth`, `GetReady` |

## 🔁 Behaviour every SDK shares

| Rule | Detail |
|---|---|
| Retries | Reads and idempotent submits retry 5xx, timeouts and network errors twice, backing off 100 ms, 200 ms (cap 5 s). `judge` and a `submit` without an idempotency key are never retried, so a run is never executed twice |
| `run` | Submits with a fresh `Idempotency-Key` and waits. If the server answers before the run ends, it polls (40 ms, growing 1.5x to 600 ms, 45 polls) on the region that accepted the run, until the status is `completed` or `error`. If the budget runs out it raises a timeout error, and `get_result` can pick the run up later |
| Unknown values | A verdict, status or health value the SDK does not know decodes as `UNKNOWN` instead of failing |
| Errors | `config`, `auth` (401/403), `rate_limit` (429, with `Retry-After` seconds), `server` (5xx after retries), `timeout`, `api` (other 4xx, with the server's message), `transport`, `decode` |

## 🌍 Regions

The SDKs resolve the endpoint in this order: an explicit base URL, `RUSTBOX_BASE_URL`, an explicit region, `RUSTBOX_REGION`, then automatic selection. Today there is one region, `in` (`https://api.rustbox.sh`), so nothing is probed.

When more regions exist, automatic selection probes `GET /api/health` on every healthy region in parallel (1.5 s timeout), picks the fastest, and shares that pick across every client in the process for 6 hours. A region that fails a request is skipped for 5 minutes by later calls. Backends in a known location should set `RUSTBOX_REGION`, which skips probing entirely.

## 🎯 Verdicts

| Code | Meaning |
|---|---|
| `AC` | Exited 0 within every limit |
| `WA` | `judge` only: the output did not match the case's expected output |
| `RE` | Exited non-zero |
| `TLE` | Time limit exceeded |
| `MLE` | Memory limit exceeded |
| `OLE` | Output limit exceeded |
| `PLE` | Process limit exceeded |
| `FSE` | File size limit exceeded |
| `SIG` | Killed by a signal |
| `SV` | Security violation (reserved, not produced today) |
| `ABUSE` | Abuse block (reserved, not produced today) |
| `IE` | Internal error on the Rustbox side; safe to retry |
| `TIMEOUT` | `judge` only: the case did not finish within the wait |

## 📏 Limits

| Limit | Value |
|---|---|
| Code | 64 KB |
| Stdin | 256 KB |
| Server-side wait before `run` starts polling | 30 s |

## 🪝 Webhooks

Webhooks are configured per project in the dashboard, not per request. See [`./WEBHOOKS.md`](./WEBHOOKS.md).

## 🔗 Links

- 🌐 [rustbox.sh](https://rustbox.sh)
- 📚 [API docs](https://rustbox.sh/docs)
- 🛣️ [Roadmap](./ROADMAP.md)
- 🐛 [Issues](https://github.com/orkait/rustbox-sdk/issues)
