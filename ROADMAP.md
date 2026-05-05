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

| SDK | Status | Registry | Tag |
|---|---|---|---|
| TypeScript | pipeline ready, awaiting first tag | [npm](https://www.npmjs.com/) | `sdk/ts/v0.1.0` |
| Python | pipeline ready, awaiting first tag | [PyPI](https://pypi.org/) | `sdk/py/v0.1.0` |
| Go | pipeline ready, awaiting first tag | [pkg.go.dev](https://pkg.go.dev/) | `sdk/go/v0.1.0` |
| Rust | pipeline ready, awaiting first tag | [crates.io](https://crates.io/) | `sdk/rust/v0.1.0` |

Tag-driven workflows in `.github/workflows/publish-sdk-{ts,py,go,rust}.yml` run automatically when the corresponding tag is pushed. Setup steps + token requirements: [`PUBLISHING.md`](./PUBLISHING.md).

## SDK source

A read-only public mirror at [`orkait/rustbox-sdk`](https://github.com/orkait/rustbox-sdk) is auto-synced from `sdk/` on every push to `main`, so customers can read the SDK source they install. Issues and feedback go to [`orkait/rustbox#issues`](https://github.com/orkait/rustbox/issues).
