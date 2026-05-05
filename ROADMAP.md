# 🛣️ SDK Roadmap

Tracks the gaps each SDK has today. Open an issue at [`orkait/rustbox#issues`](https://github.com/orkait/rustbox/issues) if you need one of these sooner.

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

| SDK | Status | Registry |
|---|---|---|
| TypeScript | source ready, not published | [npm](https://www.npmjs.com/) |
| Python | source ready, not published | [PyPI](https://pypi.org/) |
| Go | source ready, not published | [pkg.go.dev](https://pkg.go.dev/) |
| Rust | source ready, not published | [crates.io](https://crates.io/) |

The first publish round will land once `0.1.0` is tagged and a per-language CI workflow exists.

## SDK source

A read-only public mirror at [`orkait/rustbox-sdk`](https://github.com/orkait/rustbox-sdk) is auto-synced from `sdk/` on every push to `main`, so customers can read the SDK source they install. Issues and feedback go to [`orkait/rustbox#issues`](https://github.com/orkait/rustbox/issues).
