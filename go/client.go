// Package rustbox is the official Go client for the Rustbox cloud
// execution sandbox. See https://rustbox.orkait.com/docs.
package rustbox

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"time"
)

// Version of this SDK. Sent in User-Agent.
const Version = "0.1.0"

// DefaultBaseURL is the production Rustbox endpoint.
const DefaultBaseURL = "https://rustbox-api.orkait.com"

// DefaultTimeout is the per-request HTTP timeout if WithHTTPClient is not used.
const DefaultTimeout = 65 * time.Second

// DefaultMaxRetries is the retry attempt budget on transient failures (5xx, network).
const DefaultMaxRetries = 2

// Profile selects the execution profile.
//   - ProfileJudge ("judge", default): short evaluation runs.
//   - ProfileAgent ("agent"): longer jobs with egress proxy + per-key
//     byte budgets. Requires a non-trial API key.
const (
	ProfileJudge = "judge"
	ProfileAgent = "agent"
)

// Sentinel errors. Use errors.Is to discriminate on Run/Submit/etc results.
var (
	ErrAuth      = errors.New("rustbox: invalid or missing API key")
	ErrRateLimit = errors.New("rustbox: rate limit exceeded")
	ErrServer    = errors.New("rustbox: server error")
	ErrTimeout   = errors.New("rustbox: request timed out")
)

type SubmitRequest struct {
	Language string `json:"language"`
	Code     string `json:"code"`
	Stdin    string `json:"stdin"`
	// Profile is "judge" (default if empty) or "agent". See Profile* consts.
	Profile string `json:"profile,omitempty"`
}

// SubmitOptions are per-request knobs that don't belong in the request body.
type SubmitOptions struct {
	// IdempotencyKey, if non-empty, is sent as Idempotency-Key header.
	// Safe to retry POST /api/submit when set.
	IdempotencyKey string
}

// Client holds API credentials + transport. Construct with New(...).
// Fields are unexported - use Option arguments to configure.
type Client struct {
	apiKey     string
	baseURL    string
	httpClient *http.Client
	maxRetries int
}

// Option configures a Client. Pass to New as variadic args.
type Option func(*Client)

// WithBaseURL overrides the default API base URL. Use for staging.
func WithBaseURL(baseURL string) Option {
	return func(c *Client) {
		c.baseURL = strings.TrimRight(baseURL, "/")
	}
}

// WithHTTPClient overrides the default HTTP client (DefaultTimeout).
func WithHTTPClient(h *http.Client) Option {
	return func(c *Client) { c.httpClient = h }
}

// WithMaxRetries sets retry attempt budget on transient failures.
// Default: DefaultMaxRetries.
func WithMaxRetries(n int) Option {
	return func(c *Client) { c.maxRetries = n }
}

// New creates a Client. apiKey is required and must be non-empty.
func New(apiKey string, opts ...Option) *Client {
	if apiKey == "" {
		panic("rustbox: apiKey required")
	}
	c := &Client{
		apiKey:     apiKey,
		baseURL:    DefaultBaseURL,
		httpClient: &http.Client{Timeout: DefaultTimeout},
		maxRetries: DefaultMaxRetries,
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

// BaseURL exposes the configured base URL (read-only accessor).
func (c *Client) BaseURL() string { return c.baseURL }

func (c *Client) backoffDelay(attempt int) time.Duration {
	d := time.Duration(100*math.Pow(2, float64(attempt))) * time.Millisecond
	if d > 5*time.Second {
		d = 5 * time.Second
	}
	return d
}

func (c *Client) do(req *http.Request) (*http.Response, error) {
	req.Header.Set("X-API-Key", c.apiKey)
	req.Header.Set("User-Agent", "rustbox-sdk-go/"+Version)
	if req.Body != nil && req.Header.Get("Content-Type") == "" {
		req.Header.Set("Content-Type", "application/json")
	}

	var lastErr error
	for attempt := 0; attempt <= c.maxRetries; attempt++ {
		// Rewind the body for retries.
		if req.GetBody != nil && attempt > 0 {
			body, err := req.GetBody()
			if err != nil {
				return nil, err
			}
			req.Body = body
		}

		resp, err := c.httpClient.Do(req)
		if err != nil {
			lastErr = err
			if attempt >= c.maxRetries {
				if isTimeout(err) {
					return nil, fmt.Errorf("%w: %v", ErrTimeout, err)
				}
				return nil, err
			}
			time.Sleep(c.backoffDelay(attempt))
			continue
		}

		if resp.StatusCode >= 500 && attempt < c.maxRetries {
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
			time.Sleep(c.backoffDelay(attempt))
			continue
		}

		return resp, nil
	}
	return nil, lastErr
}

func isTimeout(err error) bool {
	type timeoutErr interface{ Timeout() bool }
	var te timeoutErr
	return errors.As(err, &te) && te.Timeout()
}

func (c *Client) handle(resp *http.Response) (map[string]interface{}, error) {
	defer resp.Body.Close()

	if resp.StatusCode == 200 || resp.StatusCode == 202 || resp.StatusCode == 408 {
		var data map[string]interface{}
		if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
			return nil, err
		}
		return data, nil
	}
	switch {
	case resp.StatusCode == 401 || resp.StatusCode == 403:
		return nil, ErrAuth
	case resp.StatusCode == 429:
		return nil, ErrRateLimit
	case resp.StatusCode >= 500:
		return nil, fmt.Errorf("%w: %d", ErrServer, resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	return nil, fmt.Errorf("rustbox: API error %d: %s", resp.StatusCode, string(body))
}

// Submit sends a job. Set wait=true for sync execution (server polls
// internally up to RUSTBOX_SYNC_WAIT_TIMEOUT_SECS).
func (c *Client) Submit(req SubmitRequest, wait bool, opts ...SubmitOptions) (map[string]interface{}, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	url := fmt.Sprintf("%s/api/submit?wait=%t", c.baseURL, wait)
	httpReq, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.GetBody = func() (io.ReadCloser, error) { return io.NopCloser(bytes.NewReader(body)), nil }
	if len(opts) > 0 && opts[0].IdempotencyKey != "" {
		httpReq.Header.Set("Idempotency-Key", opts[0].IdempotencyKey)
	}
	resp, err := c.do(httpReq)
	if err != nil {
		return nil, err
	}
	return c.handle(resp)
}

func (c *Client) GetResult(id string) (map[string]interface{}, error) {
	httpReq, _ := http.NewRequest("GET", fmt.Sprintf("%s/api/result/%s", c.baseURL, id), nil)
	resp, err := c.do(httpReq)
	if err != nil {
		return nil, err
	}
	return c.handle(resp)
}

func (c *Client) GetLanguages() ([]string, error) {
	httpReq, _ := http.NewRequest("GET", fmt.Sprintf("%s/api/languages", c.baseURL), nil)
	resp, err := c.do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("rustbox: API error %d", resp.StatusCode)
	}
	var data []string
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, err
	}
	return data, nil
}

func (c *Client) GetHealth() (map[string]interface{}, error) {
	httpReq, _ := http.NewRequest("GET", fmt.Sprintf("%s/api/health", c.baseURL), nil)
	resp, err := c.do(httpReq)
	if err != nil {
		return nil, err
	}
	return c.handle(resp)
}

func (c *Client) GetReady() (map[string]interface{}, error) {
	httpReq, _ := http.NewRequest("GET", fmt.Sprintf("%s/api/health/ready", c.baseURL), nil)
	resp, err := c.do(httpReq)
	if err != nil {
		return nil, err
	}
	return c.handle(resp)
}

// Run submits + waits + auto-polls until verdict. Auto-generates an
// Idempotency-Key so the underlying POST is safe to retry on transient
// failure.
func (c *Client) Run(req SubmitRequest) (map[string]interface{}, error) {
	idempKey, _ := newUUID()
	res, err := c.Submit(req, true, SubmitOptions{IdempotencyKey: idempKey})
	if err != nil {
		return nil, err
	}

	if _, hasVerdict := res["verdict"]; hasVerdict {
		return res, nil
	}

	id, ok := res["id"].(string)
	if !ok {
		return res, nil
	}

	for i := 0; i < 45; i++ {
		delayMs := math.Min(40*math.Pow(1.5, float64(i)), 600)
		time.Sleep(time.Duration(delayMs) * time.Millisecond)

		pollRes, err := c.GetResult(id)
		if err != nil {
			return nil, err
		}
		if _, hasVerdict := pollRes["verdict"]; hasVerdict {
			return pollRes, nil
		}
	}
	return res, nil
}

// newUUID returns a hex-encoded 16-byte random ID. Avoids github.com/google/uuid dep.
func newUUID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return hex.EncodeToString(b[0:4]) + "-" + hex.EncodeToString(b[4:6]) + "-" +
		hex.EncodeToString(b[6:8]) + "-" + hex.EncodeToString(b[8:10]) + "-" +
		hex.EncodeToString(b[10:]), nil
}
