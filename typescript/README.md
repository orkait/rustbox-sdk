<div align="center">

# 📘 rustbox for TypeScript

**Client for the Rustbox judge API, for Node 20+ and Bun.**

[![npm](https://img.shields.io/npm/v/rustbox?logo=npm&logoColor=white)](https://www.npmjs.com/package/rustbox)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](./tsconfig.json)

</div>

---

`rustbox` runs untrusted code on Rustbox and returns typed results. It uses the platform `fetch` and has no runtime dependencies. Behaviour shared with the other SDKs (retries, regions, verdicts) is described in the [SDK index](../README.md).

## 🚀 Quickstart

```bash
bun add rustbox
```

```typescript
import { Rustbox } from "rustbox";

const client = new Rustbox(process.env.RUSTBOX_API_KEY ?? "");
const execution = await client.run("python", "print(6 * 7)");
if (execution.result.verdict === "AC") console.log(execution.output.stdout);
```

## ⚖️ Judge against test cases

```typescript
const judged = await client.judge("python", "a, b = map(int, input().split())\nprint(a + b)", [
  { stdin: "1 2", expected: "3" },
  { stdin: "2 2", expected: "4" },
]);
console.log(judged.allPassed, judged.results.map((r) => r.verdict));
```

## 📨 Queue now, read later

```typescript
const accepted = await client.submit("python", "print(1)", "", crypto.randomUUID());
const execution = await client.getResult(accepted.id);
```

A `submit` with an idempotency key is retried on transient failures; without one it is sent once.

## ⚙️ Configuration

Options are a full `RustboxOptions` object; start from `DEFAULT_OPTIONS` and override what you need.

```typescript
import { DEFAULT_OPTIONS, Rustbox } from "rustbox";

const client = new Rustbox(apiKey, { ...DEFAULT_OPTIONS, region: "in", maxRetries: 0 });
```

| Option | Default | Meaning |
|---|---|---|
| `baseUrl` | `ABSENT` | Fixed endpoint; wins over everything else |
| `region` | `ABSENT` | A key of `regions`; `RUSTBOX_REGION` is read when unset |
| `regions` | `{ in: "https://api.rustbox.sh" }` | Region table |
| `timeoutSecs` | `65` | Per-request timeout |
| `maxRetries` | `2` | Retries for reads and idempotent submits |

`RUSTBOX_BASE_URL` and `RUSTBOX_REGION` are the only environment variables read, and only where `process` exists.

## 🧾 Results

`run` and `getResult` return an `Execution`: `id`, `language`, `status`, `done`, `timestamps`, `result` (`verdict`, `exitCode`, `signal`, `errorMessage`), `output` (`stdout`, `stderr`), `metrics` (`cpuTimeSecs`, `wallTimeSecs`, `memoryPeakBytes`) and `evidence`. Missing values are `ABSENT` (`null`).

## 🔒 Errors

Every error extends `RustboxError`.

| Error | When |
|---|---|
| `RustboxConfigError` | Missing key, bad URL or unknown region |
| `RustboxAuthError` | 401 / 403 (`.status`) |
| `RustboxRateLimitError` | 429 (`.retryAfterSecs`) |
| `RustboxServerError` | 5xx after retries (`.status`) |
| `RustboxApiError` | Other 4xx (`.status`, `.detail`) |
| `RustboxTimeoutError` | A request timed out |
| `RustboxStillRunningError` | `run` used up its polling budget; `runId` is the run to fetch later with `getResult` |
| `RustboxTransportError` | The service could not be reached |
| `RustboxDecodeError` | The response did not match the contract |

## 🧪 Development

```bash
bun install
bun run typecheck
bun test
```

The tests replay [`../contract`](../contract), shared with the other SDKs.
