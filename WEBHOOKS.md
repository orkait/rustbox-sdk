# 🪝 Webhooks

Ship a job and have Rustbox POST the result to your endpoint when it finishes. Avoids the polling loop for long-running work.

## How it works

1. Your dashboard creates a webhook with an `endpoint` URL. Rustbox returns the HMAC signing secret **once**, at creation time. Store it.
2. You submit code with `webhook_url` + `webhook_secret` set on the request.
3. Rustbox executes the job. On completion, it POSTs the result JSON to `endpoint`.
4. Your handler verifies `X-Rustbox-Signature` (HMAC-SHA256 hex of body) using the secret you stored.

## Request shape

```json
{
  "language": "python",
  "code": "...",
  "stdin": "",
  "webhook_url": "https://your.example.com/rustbox-webhook",
  "webhook_secret": "wh_..."
}
```

`webhook_url` must be HTTPS. Private IPs and reserved ranges are rejected at submit time to prevent SSRF.

## Delivery shape

```http
POST /your-endpoint HTTP/1.1
Content-Type: application/json
X-Rustbox-Signature: <hex hmac-sha256 of body>
X-Rustbox-Event: result

{ "id": "...", "verdict": "AC", "stdout": "...", "stderr": "...", ... }
```

Same body shape as `getResult(id)` returns.

## Verifying the signature

| Lang | Snippet |
|---|---|
| Node / Bun | `crypto.createHmac("sha256", secret).update(body).digest("hex") === sig` |
| Python | `hmac.compare_digest(hmac.new(secret.encode(), body, hashlib.sha256).hexdigest(), sig)` |
| Go | `hmac.Equal([]byte(hex.EncodeToString(mac.Sum(nil))), []byte(sig))` |
| Rust | `Hmac::<Sha256>::new_from_slice(secret).chain_update(body).finalize().into_bytes()` |

Always use a constant-time compare. Reject on mismatch with `401`.

## Retry behaviour

- Rustbox waits up to `RUSTBOX_WEBHOOK_TIMEOUT_SECS` (default 10s) for a 2xx response.
- Non-2xx or timeout marks the webhook as `degraded` after repeated failures.
- After `recent_failures` crosses the disable threshold, the webhook flips to `disabled` until the operator re-enables it from the dashboard.

## SDK usage

The SDKs accept `webhook_url` and `webhook_secret` on `submit()` via the underlying request body. First-class struct fields are planned (see [`ROADMAP.md`](./ROADMAP.md)). For now:

```ts
// TypeScript
await client.submit({ language: "python", code: "...", webhook_url, webhook_secret } as any, false);
```

```python
# Python: pass via the underlying client until first-class kwargs land
await client.client.post("/api/submit", params={"wait":"false"}, json={
    "language":"python", "code":"...", "stdin":"",
    "webhook_url": webhook_url, "webhook_secret": webhook_secret,
})
```

```go
// Go: same workaround until WithWebhook(...) is added
body, _ := json.Marshal(map[string]any{
    "language":"python","code":"...","stdin":"",
    "webhook_url":webhookURL,"webhook_secret":webhookSecret,
})
// POST to baseURL+"/api/submit?wait=false" with body
```

```rust
// Rust: same workaround until SubmitRequest gains optional webhook fields
let body = serde_json::json!({
    "language":"python","code":"...","stdin":"",
    "webhook_url": webhook_url, "webhook_secret": webhook_secret,
});
// POST to base_url+"/api/submit?wait=false" with body
```

## Test deliveries

The dashboard has a "Send test" button per webhook. It POSTs a synthetic payload with `event=test` and a real signature so you can verify your handler end-to-end before pointing real traffic at it.

## See also

- [`./README.md`](./README.md) - SDK index
- [API docs](https://rustbox.orkait.com/docs/api/webhooks) - full HTTP contract
