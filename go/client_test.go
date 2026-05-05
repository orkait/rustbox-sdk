package rustbox

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNewDefaultsBaseURLToProduction(t *testing.T) {
	c := New("k")
	if c.BaseURL != DefaultBaseURL {
		t.Fatalf("expected %q, got %q", DefaultBaseURL, c.BaseURL)
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
	if c.BaseURL != "https://custom.example.com" {
		t.Fatalf("expected trimmed override URL, got %q", c.BaseURL)
	}
}

func TestRunSuccessFast(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{"id":"1","verdict":"AC"}`))
	}))
	defer srv.Close()

	c := New("k", WithBaseURL(srv.URL))
	res, err := c.Run(SubmitRequest{Language: "python", Code: "print(1)"})
	if err != nil {
		t.Fatal(err)
	}
	if res["verdict"] != "AC" {
		t.Fatalf("got %v", res["verdict"])
	}
}

func TestRunPolling(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
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

	c := New("k", WithBaseURL(srv.URL))
	res, err := c.Run(SubmitRequest{Language: "python", Code: "while True: pass"})
	if err != nil {
		t.Fatal(err)
	}
	if res["verdict"] != "TLE" {
		t.Fatalf("got %v", res["verdict"])
	}
	if calls < 2 {
		t.Fatalf("expected polling, got %d calls", calls)
	}
}
