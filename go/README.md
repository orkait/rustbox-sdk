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

> ⏳ First release (v0.1.0) ships once `sdk/go/v0.1.0` tag is pushed (which tags the [public mirror](https://github.com/orkait/rustbox-sdk)). Pipeline ready: see [`PUBLISHING.md`](../PUBLISHING.md). Until then, `go get github.com/orkait/rustbox-sdk/go@main` works against the mirror's `main` branch.

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

## ⚠️ Errors

Today the Go SDK returns generic errors:

```go
result, err := client.Run(req)
// err.Error() looks like "API Error: 401" or transport error
```

Typed sentinels (`ErrAuth`, `ErrRateLimit`, `ErrServer`) are planned. See [`../ROADMAP.md`](../ROADMAP.md). For now, treat any non-2xx as transient and back off.

<details>
<summary><strong>🧰 Full API</strong></summary>

| Method | Returns | Notes |
|---|---|---|
| `rustbox.New(apiKey, opts ...Option)` | `*Client` | empty `apiKey` panics |
| `WithBaseURL(url)` | `Option` | override default URL |
| `WithHTTPClient(h)` | `Option` | inject custom `*http.Client` |
| `client.Run(req)` | `(map[string]any, error)` | Submit + wait + auto-poll |
| `client.Submit(req, wait)` | `(map[string]any, error)` | Low-level, no polling |
| `client.GetResult(id)` | `(map[string]any, error)` | Poll a job by id |
| `client.GetLanguages()` | `([]string, error)` | Available runtimes |
| `client.GetHealth()` | `(map[string]any, error)` | Service health |
| `client.GetReady()` | `(map[string]any, error)` | K8s-style readiness |

```go
type SubmitRequest struct {
    Language string `json:"language"`
    Code     string `json:"code"`
    Stdin    string `json:"stdin"`
}
```

</details>

<details>
<summary><strong>🧪 Tests</strong></summary>

```bash
cd sdk/go && go test ./...
```

`httptest.NewServer` mocks. No network.

</details>

## 🔗

- 📦 [pkg.go.dev: rustbox-sdk/go](https://pkg.go.dev/github.com/orkait/rustbox-sdk/go)
- 🪝 [Webhooks](../WEBHOOKS.md)
- 🛣️ [Roadmap](../ROADMAP.md)
- 🦀 [SDK index](../README.md)
