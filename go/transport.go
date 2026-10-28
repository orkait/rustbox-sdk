package rustbox

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"time"
)

type request struct {
	method         string
	path           string
	query          url.Values
	body           []byte
	idempotencyKey *string
}

func getRequest(path string) request {
	return request{method: http.MethodGet, path: path}
}

type payload interface {
	RunRequest | JudgeRequest
}

func postRequest[P payload](path string, body P, query url.Values, idempotencyKey *string) (request, error) {
	encoded, err := json.Marshal(body)
	if err != nil {
		return request{}, &Error{Kind: KindConfig, Message: "request body cannot be encoded", Cause: err}
	}
	return request{method: http.MethodPost, path: path, query: query, body: encoded, idempotencyKey: idempotencyKey}, nil
}

func (r request) retryable() bool {
	return r.method == http.MethodGet || r.idempotencyKey != nil
}

type errorBody struct {
	Error string `json:"error"`
}

type transport struct {
	client *http.Client
	apiKey string
	retry  RetryPolicy
}

func sleep(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func failure(err error) *Error {
	var netErr net.Error
	if errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &netErr) && netErr.Timeout()) {
		return &Error{Kind: KindTimeout, Message: err.Error(), Cause: err}
	}
	return &Error{Kind: KindTransport, Message: err.Error(), Cause: err}
}

func (t *transport) attempt(ctx context.Context, base string, req request) (*http.Response, error) {
	target := base + req.path
	if len(req.query) > 0 {
		target += querySeparator + req.query.Encode()
	}
	var body io.Reader
	if req.body != nil {
		body = bytes.NewReader(req.body)
	}
	httpReq, err := http.NewRequestWithContext(ctx, req.method, target, body)
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set(headerAPIKey, t.apiKey)
	httpReq.Header.Set(headerUserAgent, UserAgent)
	if req.body != nil {
		httpReq.Header.Set(headerContentType, contentTypeJSON)
	}
	if req.idempotencyKey != nil {
		httpReq.Header.Set(headerIdempotencyKey, *req.idempotencyKey)
	}
	return t.client.Do(httpReq)
}

func (t *transport) send(ctx context.Context, base string, req request) (*http.Response, error) {
	retries := 0
	if req.retryable() {
		retries = t.retry.MaxRetries
	}
	for attempt := 0; ; attempt++ {
		last := attempt >= retries
		resp, err := t.attempt(ctx, base, req)
		switch {
		case err != nil && last:
			return nil, failure(err)
		case err == nil && resp.StatusCode < http.StatusInternalServerError:
			return resp, nil
		case err == nil:
			_, _ = io.Copy(io.Discard, resp.Body)
			_ = resp.Body.Close()
			if last {
				return nil, serverError(resp.StatusCode)
			}
		}
		if err := sleep(ctx, t.retry.Delay(attempt)); err != nil {
			return nil, failure(err)
		}
	}
}

func (t *transport) probe(ctx context.Context, base string, timeout time.Duration) (time.Duration, bool) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	started := time.Now()
	resp, err := t.attempt(ctx, base, getRequest(pathHealth))
	if err != nil {
		return 0, false
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
	return time.Since(started), resp.StatusCode >= http.StatusOK && resp.StatusCode < http.StatusMultipleChoices
}

func retryAfterSecs(resp *http.Response) *int {
	secs, err := strconv.Atoi(resp.Header.Get(headerRetryAfter))
	if err != nil || secs < 0 {
		return nil
	}
	return &secs
}

func errorFor(resp *http.Response, raw []byte) *Error {
	switch resp.StatusCode {
	case http.StatusUnauthorized, http.StatusForbidden:
		return &Error{Kind: KindAuth, Status: resp.StatusCode, Message: http.StatusText(resp.StatusCode)}
	case http.StatusTooManyRequests:
		return &Error{Kind: KindRateLimit, Status: resp.StatusCode, RetryAfterSecs: retryAfterSecs(resp), Message: http.StatusText(resp.StatusCode)}
	}
	message := string(raw)
	var body errorBody
	if json.Unmarshal(raw, &body) == nil && body.Error != "" {
		message = body.Error
	}
	return &Error{Kind: KindAPI, Status: resp.StatusCode, Message: message}
}

type decoded interface {
	Accepted | Execution | pending | JudgeResult | []string | health
}

func expect[T decoded](resp *http.Response, statuses ...int) (T, error) {
	var value T
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return value, failure(err)
	}
	if !slices.Contains(statuses, resp.StatusCode) {
		return value, errorFor(resp, raw)
	}
	if err := json.Unmarshal(raw, &value); err != nil {
		return value, decodeError("response does not match the contract", err)
	}
	return value, nil
}
