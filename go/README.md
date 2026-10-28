<div align="center">

# 🦫 rustbox for Go

**Client for the Rustbox judge API, standard library only.**

[![Go Reference](https://pkg.go.dev/badge/github.com/orkait/rustbox-sdk/go.svg)](https://pkg.go.dev/github.com/orkait/rustbox-sdk/go)
[![Go](https://img.shields.io/badge/Go-1.21%2B-00ADD8?logo=go&logoColor=white)](./go.mod)

</div>

---

`rustbox` runs untrusted code on Rustbox and returns typed results. Every call takes a `context.Context`. Behaviour shared with the other SDKs (retries, regions, verdicts) is described in the [SDK index](../README.md).

## 🚀 Quickstart

```bash
go get github.com/orkait/rustbox-sdk/go@v0.6.0
```

```go
package main

import (
	"context"
	"fmt"
	"log"
	"os"

	rustbox "github.com/orkait/rustbox-sdk/go"
)

func main() {
	client, err := rustbox.New(os.Getenv("RUSTBOX_API_KEY"))
	if err != nil {
		log.Fatal(err)
	}
	execution, err := client.Run(context.Background(), rustbox.RunRequest{Language: "python", Code: "print(6 * 7)"})
	if err != nil {
		log.Fatal(err)
	}
	if execution.Result.Verdict != nil && *execution.Result.Verdict == rustbox.VerdictAccepted {
		fmt.Print(*execution.Output.Stdout)
	}
}
```

## ⚖️ Judge against test cases

```go
judged, err := client.Judge(ctx, rustbox.JudgeRequest{
	Language: "python",
	Code:     "a, b = map(int, input().split())\nprint(a + b)",
	Cases: []rustbox.JudgeCase{
		{Stdin: "1 2", Expected: "3"},
		{Stdin: "2 2", Expected: "4"},
	},
})
```

## 📨 Queue now, read later

```go
key := "6a0e7c1d-2b3f-4a5e-8d9c-0b1a2c3d4e5f"
accepted, err := client.Submit(ctx, rustbox.RunRequest{Language: "python", Code: "print(1)"}, &key)
execution, err := client.GetResult(ctx, accepted.ID)
```

A `Submit` with an idempotency key is retried on transient failures; with `nil` it is sent once.

## ⚙️ Configuration

```go
client, err := rustbox.New(apiKey, rustbox.WithRegion("in"), rustbox.WithMaxRetries(0))
```

| Option | Default | Meaning |
|---|---|---|
| `WithBaseURL` | unset | Fixed endpoint; wins over everything else |
| `WithRegion` | unset | A key of the region table; `RUSTBOX_REGION` is read when unset |
| `WithRegions` | `{"in": "https://api.rustbox.sh"}` | Region table |
| `WithTimeout` | 65 s | Per-request timeout |
| `WithMaxRetries` | 2 | Retries for reads and idempotent submits |
| `WithEnv` | `os.Getenv` | Where `RUSTBOX_BASE_URL` and `RUSTBOX_REGION` are read from |

## 🔒 Errors

Every error is a `*rustbox.Error` with a `Kind`, and `Status`, `RetryAfterSecs`, `RunID` and `Message` where they apply. Match a kind with `errors.Is(err, rustbox.ErrRateLimit)`, or read the fields with `errors.As`. Kinds: `ErrConfig`, `ErrAuth`, `ErrRateLimit`, `ErrServer`, `ErrTimeout`, `ErrStillRunning` (when `Run` uses up its polling budget; fetch `RunID` later with `GetResult`), `ErrAPI`, `ErrTransport`, `ErrDecode`.

## 🧪 Development

```bash
gofmt -l .
go vet ./...
go test ./...
```

The tests replay [`../contract`](../contract), shared with the other SDKs.
