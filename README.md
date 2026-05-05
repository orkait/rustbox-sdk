<div align="center">

# 🦀 Rustbox SDKs

**Run untrusted code in a kernel-enforced sandbox. From any language.**

<br />

[![Python](https://img.shields.io/badge/Python-3.9%2B-blue?logo=python&logoColor=white)](./python/README.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-3178C6?logo=typescript&logoColor=white)](./typescript/README.md)
[![Go](https://img.shields.io/badge/Go-1.21%2B-00ADD8?logo=go&logoColor=white)](./go/README.md)
[![Rust](https://img.shields.io/badge/Rust-2021-f74c00?logo=rust&logoColor=white)](./rust/README.md)

</div>

---

Official API clients for the [Rustbox](https://rustbox.orkait.com) cloud execution engine. Built for AI agents, judging platforms, and any tool that needs to run code it didn't write.

One-line client. One method (`run`) for the 95% case.

## 🚀 Install

```bash
# TypeScript
bun add rustbox

# Python
pip install rustbox

# Rust
cargo add rustbox-sdk

# Go
go get github.com/orkait/rustbox-sdk/go@v0.1.0
```

## ⚡ At a glance

```python
# Python
client = Rustbox(api_key)
result = await client.run(language="python", code="print(1)")
print(result["verdict"])  # AC
```

```typescript
// TypeScript
const client = new Rustbox(apiKey);
const result = await client.run({
  language: "python",
  code: "print(1)",
});
console.log(result.verdict);  // AC
```

```go
// Go
client := rustbox.New(apiKey)
result, _ := client.Run(rustbox.SubmitRequest{
    Language: "python",
    Code:     "print(1)",
})
fmt.Println(result["verdict"])  // AC
```

```rust
// Rust
let client = Rustbox::new(&api_key)?;
let result = client.run(&SubmitRequest {
    language: "python".into(),
    code:     "print(1)".into(),
    ..Default::default()
}).await?;
println!("{}", result["verdict"]);  // AC
```

## 📚 Per-language docs

| SDK | Package | Docs |
|---|---|---|
| 📘 TypeScript | [`rustbox` on npm](https://www.npmjs.com/package/rustbox) | [`./typescript/README.md`](./typescript/README.md) |
| 🐍 Python | [`rustbox` on PyPI](https://pypi.org/project/rustbox/) | [`./python/README.md`](./python/README.md) |
| 🦫 Go | [`github.com/orkait/rustbox-sdk/go`](https://pkg.go.dev/github.com/orkait/rustbox-sdk/go) | [`./go/README.md`](./go/README.md) |
| 🦀 Rust | [`rustbox-sdk` on crates.io](https://crates.io/crates/rustbox-sdk) | [`./rust/README.md`](./rust/README.md) |

## 🎯 Verdicts

Every result has a `verdict` field. What each one means and whether to retry:

| Code | Meaning | Retry? |
|---|---|---|
| `AC` | Accepted - exit 0, no limits hit | n/a |
| `RE` | Runtime error - non-zero exit (exception, syntax, etc.) | no |
| `TLE` | Time limit exceeded | no - your code is too slow |
| `MLE` | Memory limit exceeded | no - your code uses too much RAM |
| `SIG` | Killed by signal - SIGSEGV / SIGKILL / OOM-killer | no |
| `PLE` | Process limit exceeded - tried to fork beyond cap | no |
| `FSE` | File size limit exceeded - wrote too much to disk | no |
| `IE` | Internal error - sandbox failure on our side | yes, with backoff |

## 📏 Limits

| Limit | Value |
|---|---|
| Code size | 64 KB |
| Stdin size | 256 KB |
| Sync wait timeout | 30s (SDK polls beyond this) |
| Webhook delivery timeout | 10s |

## 🚦 Rate limits

| Profile | Per minute | Per day |
|---|---|---|
| Judge | 60 | 1,000 |
| Agent | 1 | 20 |

Hit a 429? Back off and retry; the SDK does this automatically up to 3 attempts. Need higher limits? See your account dashboard.

## 🔒 Error handling

TS and Python SDKs throw typed exceptions:

| Status | TypeScript | Python |
|---|---|---|
| 401 / 403 | `RustboxAuthError` | `RustboxAuthError` |
| 429 | `RustboxRateLimitError` | `RustboxRateLimitError` |
| 5xx | `RustboxServerError` | `RustboxServerError` |
| other | `Error` | `RustboxError` |

Go and Rust currently return generic errors. See [`./ROADMAP.md`](./ROADMAP.md).

## 🪝 Webhooks

Skip polling - have Rustbox POST the result to your endpoint with an HMAC signature. See [`./WEBHOOKS.md`](./WEBHOOKS.md).

## ⚙️ Base URL

Every SDK points at the production endpoint by default. No configuration needed.

```text
https://rustbox-api.orkait.com
```

## 🛣️ Roadmap

Planned features per language: [`./ROADMAP.md`](./ROADMAP.md).

## 🔗 Links

- 🌐 [rustbox.orkait.com](https://rustbox.orkait.com)
- 📚 [API docs](https://rustbox.orkait.com/docs)
- 🐛 [Issue tracker](https://github.com/orkait/rustbox-sdk/issues)
- 🔓 [Source code](https://github.com/orkait/rustbox-sdk)
