<div align="center">

# 🦫 Rustbox Go SDK

[![Go Reference](https://pkg.go.dev/badge/github.com/orkait/rustbox-sdk/go.svg)](https://pkg.go.dev/github.com/orkait/rustbox-sdk/go)
[![Go](https://img.shields.io/badge/Go-1.21%2B-00ADD8?logo=go&logoColor=white)](https://go.dev/)

</div>

Stdlib `net/http` only. Functional options. Synchronous API.

## 🚀 Install

```bash
go get github.com/orkait/rustbox-sdk/go
```

## ⚡ Quickstart

```go
package main

import (
    "fmt"
    "os"
    rustbox "github.com/orkait/rustbox-sdk/go"
)

func main() {
    client := rustbox.New(os.Getenv("RUSTBOX_API_KEY"))
    result, err := client.Run(rustbox.SubmitRequest{
        Language: "python", Code: "print('hello')",
    })
    if err != nil { panic(err) }
    fmt.Println(result["verdict"], result["stdout"])  // AC hello
}
```

`Run()` submits, waits for sync completion, polls if needed, returns the verdict.

### Profiles

```go
// Judge profile (default) - short evaluation runs, no egress proxy.
client.Run(rustbox.SubmitRequest{Language: "python", Code: "print(1)"})

// Agent profile - longer jobs, egress proxy on, per-key byte budget.
// Requires a non-trial API key.
client.Run(rustbox.SubmitRequest{
    Language: "python", Code: "...", Profile: rustbox.ProfileAgent,
})
```

## 🔒 Errors

Sentinel errors. Use `errors.Is` to discriminate:

```go
import "errors"

result, err := client.Run(req)
switch {
case errors.Is(err, rustbox.ErrAuth):      // 401/403
case errors.Is(err, rustbox.ErrRateLimit): // 429
case errors.Is(err, rustbox.ErrServer):    // 5xx (SDK already retried)
case errors.Is(err, rustbox.ErrTimeout):   // request exceeded timeout
}
```

<details>
<summary><strong>🧰 Full API</strong></summary>

| Method | Returns |
|---|---|
| `rustbox.New(apiKey, opts ...Option)` | `*Client` (empty `apiKey` panics) |
| `WithBaseURL(url)` | `Option` |
| `WithHTTPClient(h)` | `Option` |
| `WithMaxRetries(n)` | `Option` |
| `client.Run(req)` | `(map[string]any, error)` |
| `client.Submit(req, wait, opts...)` | `(map[string]any, error)` |
| `client.GetResult(id)` | `(map[string]any, error)` |
| `client.GetLanguages()` | `([]string, error)` |
| `client.GetHealth()` | `(map[string]any, error)` |
| `client.GetReady()` | `(map[string]any, error)` |

```go
type SubmitRequest struct {
    Language      string `json:"language"`
    Code          string `json:"code"`
    Stdin         string `json:"stdin"`
    Profile       string `json:"profile,omitempty"`        // ProfileJudge | ProfileAgent
}

type SubmitOptions struct {
    IdempotencyKey string  // Idempotency-Key header; safe to retry POST when set
}
```

</details>

<details>
<summary><strong>🧪 Tests</strong></summary>

```bash
cd go && go test ./...
```

`httptest.NewServer` mocks. No network.

</details>

## 🔗

- 📦 [pkg.go.dev: rustbox-sdk/go](https://pkg.go.dev/github.com/orkait/rustbox-sdk/go)
- 🪝 [Webhooks](../WEBHOOKS.md)
- 🛣️ [Roadmap](../ROADMAP.md)
- 🦀 [SDK index](../README.md)
