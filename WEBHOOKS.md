# Webhooks

Rustbox webhooks are project-level delivery targets. Configure them once in
the dashboard for a project, then submit normally with an API key scoped to
that project.

## How it works

1. Create a webhook in the dashboard and choose a project.
2. Rustbox returns the HMAC signing secret once. Store it in your receiver.
3. Submit code with an API key scoped to that project.
4. When the execution completes, Rustbox POSTs the result to every active
   webhook on the project.

SDK submit calls do not accept per-request webhook URLs or secrets.

## Delivery shape

```http
POST /your-endpoint HTTP/1.1
Content-Type: application/json
webhook-id: <message id>
webhook-timestamp: <unix timestamp>
webhook-signature: v1,<base64 hmac-sha256>

{ "id": "...", "verdict": "AC", "stdout": "...", "stderr": "...", ... }
```

Rustbox follows the Standard Webhooks signing shape:

```txt
{webhook-id}.{webhook-timestamp}.{raw-body}
```

Verify the signature with the secret shown at creation or after rotation.

## Retry behaviour

- Rustbox waits up to 10s for a successful response.
- Failed deliveries mark the webhook degraded.
- Repeated failures disable the webhook.
- Dashboard test deliveries use the same header/signature format as real
  execution deliveries.

## See also

- [`./README.md`](./README.md) - SDK index
- [API docs](https://rustbox.orkait.com/docs/api/webhooks) - full HTTP contract
