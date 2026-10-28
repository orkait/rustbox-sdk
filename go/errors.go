package rustbox

import (
	"fmt"
	"net/http"
)

type ErrorKind string

const (
	KindConfig       ErrorKind = "config"
	KindAuth         ErrorKind = "auth"
	KindRateLimit    ErrorKind = "rate_limit"
	KindServer       ErrorKind = "server"
	KindTimeout      ErrorKind = "timeout"
	KindStillRunning ErrorKind = "still_running"
	KindAPI          ErrorKind = "api"
	KindTransport    ErrorKind = "transport"
	KindDecode       ErrorKind = "decode"
)

var ErrorKinds = []ErrorKind{
	KindConfig, KindAuth, KindRateLimit, KindServer, KindTimeout, KindStillRunning, KindAPI, KindTransport, KindDecode,
}

var (
	ErrConfig       = &Error{Kind: KindConfig}
	ErrAuth         = &Error{Kind: KindAuth}
	ErrRateLimit    = &Error{Kind: KindRateLimit}
	ErrServer       = &Error{Kind: KindServer}
	ErrTimeout      = &Error{Kind: KindTimeout}
	ErrStillRunning = &Error{Kind: KindStillRunning}
	ErrAPI          = &Error{Kind: KindAPI}
	ErrTransport    = &Error{Kind: KindTransport}
	ErrDecode       = &Error{Kind: KindDecode}
)

type Error struct {
	Kind           ErrorKind
	Status         int
	RetryAfterSecs *int
	RunID          string
	Message        string
	Cause          error
}

func (e *Error) Error() string {
	if e.Status != 0 {
		return fmt.Sprintf("rustbox %s (HTTP %d): %s", e.Kind, e.Status, e.Message)
	}
	return fmt.Sprintf("rustbox %s: %s", e.Kind, e.Message)
}

func (e *Error) Is(target error) bool {
	sentinel, ok := target.(*Error)
	return ok && sentinel.Kind == e.Kind && sentinel.Status == 0 && sentinel.Message == ""
}

func (e *Error) Unwrap() error {
	return e.Cause
}

func (e *Error) Transient() bool {
	return e.Kind == KindServer || e.Kind == KindTimeout || e.Kind == KindTransport
}

func configError(message string) *Error {
	return &Error{Kind: KindConfig, Message: message}
}

func decodeError(what string, cause error) *Error {
	return &Error{Kind: KindDecode, Message: what, Cause: cause}
}

func serverError(status int) *Error {
	return &Error{Kind: KindServer, Status: status, Message: http.StatusText(status)}
}
