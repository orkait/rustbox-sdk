package rustbox

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestNewDefaultsBaseURLToProduction(t *testing.T) {
	c := New("k")
	if c.BaseURL() != DefaultBaseURL {
		t.Fatalf("expected %q, got %q", DefaultBaseURL, c.BaseURL())
	}
}

func TestNewRequiresAPIKey(t *testing.T) {
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("expected panic for empty apiKey")
		}
	}()
	_ = New("")
}

func TestNewWithBaseURLOverride(t *testing.T) {
	c := New("k", WithBaseURL("https://custom.example.com/"))
	if c.BaseURL() != "https://custom.example.com" {
		t.Fatalf("expected trimmed override URL, got %q", c.BaseURL())
	}
}

func TestSubmitSendsUserAgent(t *testing.T) {
	var ua string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ua = r.Header.Get("User-Agent")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{"id":"1","verdict":"AC"}`))
	}))
	defer srv.Close()

	_, err := New("k", WithBaseURL(srv.URL)).Submit(SubmitRequest{Language: "python", Code: "print(1)"}, false)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(ua, "rustbox-sdk-go/") {
		t.Fatalf("expected User-Agent prefix rustbox-sdk-go/, got %q", ua)
	}
}

func TestSubmitIncludesProfileWhenSet(t *testing.T) {
	var captured map[string]interface{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&captured)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{"id":"1","verdict":"AC"}`))
	}))
	defer srv.Close()

	_, err := New("k", WithBaseURL(srv.URL)).Submit(
		SubmitRequest{Language: "python", Code: "print(1)", Profile: ProfileAgent},
		false,
	)
	if err != nil {
		t.Fatal(err)
	}
	if captured["profile"] != "agent" {
		t.Fatalf("expected profile=agent, got %v", captured["profile"])
	}
}

func TestSubmitSendsIdempotencyKey(t *testing.T) {
	var got string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.Header.Get("Idempotency-Key")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{"id":"1","verdict":"AC"}`))
	}))
	defer srv.Close()

	_, err := New("k", WithBaseURL(srv.URL)).Submit(
		SubmitRequest{Language: "python", Code: "print(1)"},
		false,
		SubmitOptions{IdempotencyKey: "explicit-key-xyz"},
	)
	if err != nil {
		t.Fatal(err)
	}
	if got != "explicit-key-xyz" {
		t.Fatalf("expected explicit-key-xyz, got %q", got)
	}
}

func TestRunAutoGeneratesIdempotencyKey(t *testing.T) {
	var got string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" {
			got = r.Header.Get("Idempotency-Key")
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{"id":"1","verdict":"AC"}`))
	}))
	defer srv.Close()

	_, err := New("k", WithBaseURL(srv.URL)).Run(SubmitRequest{Language: "python", Code: "print(1)"})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) < 8 {
		t.Fatalf("expected non-empty idempotency-key, got %q", got)
	}
}

func TestSubmitRetriesOn503(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&calls, 1)
		if n < 2 {
			w.WriteHeader(503)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{"id":"1","verdict":"AC"}`))
	}))
	defer srv.Close()

	res, err := New("k", WithBaseURL(srv.URL), WithMaxRetries(2)).Submit(
		SubmitRequest{Language: "python", Code: "print(1)"}, false,
	)
	if err != nil {
		t.Fatal(err)
	}
	if res["verdict"] != "AC" {
		t.Fatalf("got %v", res["verdict"])
	}
	if atomic.LoadInt32(&calls) != 2 {
		t.Fatalf("expected 2 calls, got %d", calls)
	}
}

func TestSubmitDoesNotRetryOn401(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(401)
	}))
	defer srv.Close()

	_, err := New("k", WithBaseURL(srv.URL)).Submit(
		SubmitRequest{Language: "python", Code: "print(1)"}, false,
	)
	if !errors.Is(err, ErrAuth) {
		t.Fatalf("expected ErrAuth, got %v", err)
	}
	if atomic.LoadInt32(&calls) != 1 {
		t.Fatalf("expected 1 call (no retry), got %d", calls)
	}
}

func TestSubmitReturnsErrServerOn5xxAfterRetries(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(503)
	}))
	defer srv.Close()

	_, err := New("k", WithBaseURL(srv.URL), WithMaxRetries(1)).Submit(
		SubmitRequest{Language: "python", Code: "print(1)"}, false,
	)
	if !errors.Is(err, ErrServer) {
		t.Fatalf("expected ErrServer, got %v", err)
	}
}

func TestRunPollsUntilVerdict(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.Header().Set("Content-Type", "application/json")
		if r.Method == "POST" {
			w.WriteHeader(408)
			_, _ = w.Write([]byte(`{"id":"1"}`))
			return
		}
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{"id":"1","verdict":"TLE"}`))
	}))
	defer srv.Close()

	res, err := New("k", WithBaseURL(srv.URL)).Run(SubmitRequest{Language: "python", Code: "while True: pass"})
	if err != nil {
		t.Fatal(err)
	}
	if res["verdict"] != "TLE" {
		t.Fatalf("got %v", res["verdict"])
	}
	if atomic.LoadInt32(&calls) < 2 {
		t.Fatalf("expected polling, got %d calls", calls)
	}
}
