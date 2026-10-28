package rustbox

import (
	"encoding/json"
	"fmt"
	"slices"
)

type Verdict string

const (
	VerdictAccepted          Verdict = "AC"
	VerdictWrongAnswer       Verdict = "WA"
	VerdictRuntimeError      Verdict = "RE"
	VerdictTimeLimit         Verdict = "TLE"
	VerdictMemoryLimit       Verdict = "MLE"
	VerdictOutputLimit       Verdict = "OLE"
	VerdictProcessLimit      Verdict = "PLE"
	VerdictFileSizeLimit     Verdict = "FSE"
	VerdictSignaled          Verdict = "SIG"
	VerdictSecurityViolation Verdict = "SV"
	VerdictAbuse             Verdict = "ABUSE"
	VerdictInternalError     Verdict = "IE"
	VerdictWaitTimeout       Verdict = "TIMEOUT"
	VerdictUnknown           Verdict = unknown
)

var Verdicts = []Verdict{
	VerdictAccepted, VerdictWrongAnswer, VerdictRuntimeError, VerdictTimeLimit, VerdictMemoryLimit,
	VerdictOutputLimit, VerdictProcessLimit, VerdictFileSizeLimit, VerdictSignaled,
	VerdictSecurityViolation, VerdictAbuse, VerdictInternalError, VerdictWaitTimeout,
}

type Status string

const (
	StatusPending   Status = "pending"
	StatusRunning   Status = "running"
	StatusCompleted Status = "completed"
	StatusError     Status = "error"
	StatusUnknown   Status = unknown
)

var (
	Statuses         = []Status{StatusPending, StatusRunning, StatusCompleted, StatusError}
	TerminalStatuses = []Status{StatusCompleted, StatusError}
)

type HealthStatus string

const (
	HealthOK       HealthStatus = "ok"
	HealthReady    HealthStatus = "ready"
	HealthNotReady HealthStatus = "not_ready"
	HealthUnknown  HealthStatus = unknown
)

var HealthStatuses = []HealthStatus{HealthOK, HealthReady, HealthNotReady}

func wireValue[T ~string](data []byte, known []T, fallback T) (T, error) {
	var raw string
	if err := json.Unmarshal(data, &raw); err != nil {
		return fallback, err
	}
	if slices.Contains(known, T(raw)) {
		return T(raw), nil
	}
	return fallback, nil
}

func (v *Verdict) UnmarshalJSON(data []byte) (err error) {
	*v, err = wireValue(data, Verdicts, VerdictUnknown)
	return err
}

func (s *Status) UnmarshalJSON(data []byte) (err error) {
	*s, err = wireValue(data, Statuses, StatusUnknown)
	return err
}

func (h *HealthStatus) UnmarshalJSON(data []byte) (err error) {
	*h, err = wireValue(data, HealthStatuses, HealthUnknown)
	return err
}

func requireKeys(data []byte, what string, keys ...string) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return fmt.Errorf("%s: expected an object: %w", what, err)
	}
	for _, key := range keys {
		if _, ok := fields[key]; !ok {
			return fmt.Errorf("%s: missing %s", what, key)
		}
	}
	return nil
}

type Timestamps struct {
	CreatedAt   string  `json:"created_at"`
	StartedAt   *string `json:"started_at"`
	CompletedAt *string `json:"completed_at"`
}

func (t *Timestamps) UnmarshalJSON(data []byte) error {
	if err := requireKeys(data, "timestamps", "created_at", "started_at", "completed_at"); err != nil {
		return err
	}
	type plain Timestamps
	return json.Unmarshal(data, (*plain)(t))
}

type Outcome struct {
	Verdict      *Verdict `json:"verdict"`
	ExitCode     *int     `json:"exit_code"`
	Signal       *int     `json:"signal"`
	ErrorMessage *string  `json:"error_message"`
}

func (o *Outcome) UnmarshalJSON(data []byte) error {
	if err := requireKeys(data, "result", "verdict", "exit_code", "signal", "error_message"); err != nil {
		return err
	}
	type plain Outcome
	return json.Unmarshal(data, (*plain)(o))
}

type Output struct {
	Stdout *string `json:"stdout"`
	Stderr *string `json:"stderr"`
}

func (o *Output) UnmarshalJSON(data []byte) error {
	if err := requireKeys(data, "output", "stdout", "stderr"); err != nil {
		return err
	}
	type plain Output
	return json.Unmarshal(data, (*plain)(o))
}

type Metrics struct {
	CPUTimeSecs     *float64 `json:"cpu_time_secs"`
	WallTimeSecs    *float64 `json:"wall_time_secs"`
	MemoryPeakBytes *int64   `json:"memory_peak_bytes"`
}

func (m *Metrics) UnmarshalJSON(data []byte) error {
	if err := requireKeys(data, "metrics", "cpu_time_secs", "wall_time_secs", "memory_peak_bytes"); err != nil {
		return err
	}
	type plain Metrics
	return json.Unmarshal(data, (*plain)(m))
}

type Execution struct {
	ID         string                     `json:"id"`
	Language   string                     `json:"language"`
	Status     Status                     `json:"status"`
	Timestamps Timestamps                 `json:"timestamps"`
	Result     Outcome                    `json:"result"`
	Output     Output                     `json:"output"`
	Metrics    Metrics                    `json:"metrics"`
	Evidence   map[string]json.RawMessage `json:"evidence"`
}

func (e *Execution) UnmarshalJSON(data []byte) error {
	if err := requireKeys(data, "execution", "id", "language", "status", "timestamps", "result", "output", "metrics"); err != nil {
		return err
	}
	type plain Execution
	return json.Unmarshal(data, (*plain)(e))
}

func (e Execution) Done() bool {
	return slices.Contains(TerminalStatuses, e.Status) || e.Result.Verdict != nil
}

type Accepted struct {
	ID     string `json:"id"`
	Status Status `json:"status"`
}

func (a *Accepted) UnmarshalJSON(data []byte) error {
	if err := requireKeys(data, "accepted", "id", "status"); err != nil {
		return err
	}
	type plain Accepted
	return json.Unmarshal(data, (*plain)(a))
}

type pending struct {
	ID string `json:"id"`
}

type health struct {
	Status HealthStatus `json:"status"`
}

type RunRequest struct {
	Language string `json:"language"`
	Code     string `json:"code"`
	Stdin    string `json:"stdin"`
}

type JudgeCase struct {
	Stdin    string `json:"stdin"`
	Expected string `json:"expected"`
}

type JudgeRequest struct {
	Language string      `json:"language"`
	Code     string      `json:"code"`
	Cases    []JudgeCase `json:"cases"`
}

type CaseResult struct {
	Verdict      *Verdict `json:"verdict"`
	Passed       bool     `json:"passed"`
	Stdout       *string  `json:"stdout"`
	Stderr       *string  `json:"stderr"`
	Expected     string   `json:"expected"`
	ExitCode     *int     `json:"exit_code"`
	WallTimeSecs *float64 `json:"wall_time_secs"`
}

func (c *CaseResult) UnmarshalJSON(data []byte) error {
	if err := requireKeys(data, "case", "verdict", "passed", "stdout", "stderr", "expected", "exit_code", "wall_time_secs"); err != nil {
		return err
	}
	type plain CaseResult
	return json.Unmarshal(data, (*plain)(c))
}

type JudgeResult struct {
	Results   []CaseResult `json:"results"`
	AllPassed bool         `json:"all_passed"`
}

func (j *JudgeResult) UnmarshalJSON(data []byte) error {
	if err := requireKeys(data, "judge", "results", "all_passed"); err != nil {
		return err
	}
	type plain JudgeResult
	return json.Unmarshal(data, (*plain)(j))
}
