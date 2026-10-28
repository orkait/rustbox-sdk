# 🛣️ SDK Roadmap

What the SDKs do not do yet. Open an issue at [`orkait/rustbox-sdk`](https://github.com/orkait/rustbox-sdk/issues) if you need one of these sooner. Anything added lands in all four SDKs at once, through [`contract/`](./contract).

| Feature | Status | Why |
|---|---|---|
| Receipts and `/api/verify` | not in the SDKs | The judge API serves them; the SDKs will add them when the contract does |
| Streaming stdout and stderr | exploring | Needs server-side support first |
| Cancel a run | exploring | Needs a server endpoint first |
| Synchronous Python client | not planned | The Python SDK is async; wrap calls in `asyncio.run()` |
| Browser use of the TypeScript SDK | not planned | It would expose the API key; call it from a server |
