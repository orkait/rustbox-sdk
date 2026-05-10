<div align="center">

# 📘 Rustbox TypeScript SDK

[![npm version](https://img.shields.io/npm/v/rustbox?logo=npm&color=cb3837)](https://www.npmjs.com/package/rustbox)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

</div>

Native `fetch`. Zero runtime deps. Full type defs.

## 🚀 Install

```bash
bun add rustbox        # or: npm install rustbox / pnpm add rustbox
```

## ⚡ Quickstart

```typescript
import { Rustbox } from "rustbox";

const result = await new Rustbox(process.env.RUSTBOX_API_KEY!).run({
  language: "python",
  code: "print('hello')",
});
console.log(result.verdict, result.stdout);  // AC hello
```

`run()` submits, waits for sync completion, polls if needed, returns the verdict.

### Profiles

```typescript
// Judge profile (default) - short evaluation runs, no egress proxy.
await client.run({ language: "python", code: "print(1)" });

// Agent profile - longer jobs, egress proxy on, per-key byte budget.
// Requires a non-trial API key.
await client.run({ language: "python", code: "...", profile: "agent" });
```

## 🔒 Errors

```ts
import { RustboxAuthError, RustboxRateLimitError, RustboxServerError } from "rustbox";

try { await client.run({ language: "python", code: "..." }); }
catch (e) {
  if (e instanceof RustboxAuthError)      { /* 401/403 */ }
  if (e instanceof RustboxRateLimitError) { /* 429 - back off */ }
  if (e instanceof RustboxServerError)    { /* 5xx - retry */ }
}
```

<details>
<summary><strong>🧰 Full API</strong></summary>

| Method | Returns |
|---|---|
| `new Rustbox(apiKey, opts?)` | `Rustbox` |
| `run(req)` | `Promise<SubmitResponse>` |
| `submit(req, wait?, opts?)` | `Promise<SubmitResponse>` |
| `getResult(id)` | `Promise<SubmitResponse>` |
| `getLanguages()` | `Promise<string[]>` |
| `getHealth()` | `Promise<any>` |
| `getReady()` | `Promise<any>` |

```ts
type SubmitRequest = {
  language: string;
  code: string;
  stdin?: string;
  profile?: "judge" | "agent";
};

type RustboxOptions = {
  baseUrl?: string;     // default: https://rustbox-api.orkait.com
  timeoutMs?: number;   // default: 65_000
  maxRetries?: number;  // default: 2
};

type SubmitOptions = {
  idempotencyKey?: string;  // safe to retry POST when set
};
```

</details>

<details>
<summary><strong>🧪 Tests</strong></summary>

```bash
cd typescript && bun install && bun run test
```

`vitest` + mocked `fetch`. No network.

</details>

## 🔗

- 📦 [npm: rustbox](https://www.npmjs.com/package/rustbox)
- 🪝 [Webhooks](../WEBHOOKS.md)
- 🛣️ [Roadmap](../ROADMAP.md)
- 🦀 [SDK index](../README.md)
