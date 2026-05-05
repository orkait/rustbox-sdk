# 🛣️ SDK Roadmap

Tracks the gaps each SDK has today. Open an issue at [`orkait/rustbox-sdk#issues`](https://github.com/orkait/rustbox-sdk/issues) if you need one of these sooner.

## Coming soon

| Feature | Status | Lang | Why |
|---|---|---|---|
| Typed errors | planned | go, rust | Today these return generic `error` / `Result<_, String>`. TS + Python already typed (`RustboxAuthError`, `RustboxRateLimitError`, `RustboxServerError`). |
| First-class webhook fields | planned | all | `submit({ webhook_url, webhook_secret, ... })` instead of underlying-client workaround. |
| Streaming stdout/stderr | exploring | all | For long-running jobs, surface output line-by-line instead of one final blob. Server-side support not built yet. |
| Cancel / abort | exploring | all | `client.cancel(id)` to terminate an in-flight job. Server endpoint TBD. |
| Synchronous wrappers | not planned | python | The SDK is async-only by design. Wrap with `asyncio.run()` from sync code. |
| Browser usage | not planned | typescript | Direct browser submission would expose API keys. Use a server proxy. |

## Published packages

| SDK | Registry |
|---|---|
| TypeScript | [npm](https://www.npmjs.com/package/rustbox) |
| Python | [PyPI](https://pypi.org/project/rustbox/) |
| Go | [pkg.go.dev](https://pkg.go.dev/github.com/orkait/rustbox-sdk/go) |
| Rust | [crates.io](https://crates.io/crates/rustbox-sdk) |

## SDK source

The source code for all SDKs is available at [`orkait/rustbox-sdk`](https://github.com/orkait/rustbox-sdk). Issues and feature requests are tracked on the [issue tracker](https://github.com/orkait/rustbox-sdk/issues).
