package rustbox

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"
)

const (
	contractPath  = "../contract/contract.json"
	scenariosPath = "../contract/scenarios.json"
	testAPIKey    = "rb_contract_test"
	absentRule    = "absent"
	uuidRule      = "uuid"
	repeatRule    = "repeat"
)

type bindings struct {
	Version         string            `json:"version"`
	Regions         map[string]string `json:"regions"`
	DefaultRegion   string            `json:"default_region"`
	RegionSelection struct {
		ProbePath           string `json:"probe_path"`
		ProbeTimeoutMs      int64  `json:"probe_timeout_ms"`
		CacheTTLSecs        int64  `json:"cache_ttl_secs"`
		FailoverPenaltySecs int64  `json:"failover_penalty_secs"`
	} `json:"region_selection"`
	Env struct {
		BaseURL string `json:"base_url"`
		Region  string `json:"region"`
	} `json:"env"`
	Headers struct {
		APIKey         string `json:"api_key"`
		UserAgent      string `json:"user_agent"`
		IdempotencyKey string `json:"idempotency_key"`
		RetryAfter     string `json:"retry_after"`
	} `json:"headers"`
	TimeoutSecs int64 `json:"timeout_secs"`
	Retry       struct {
		MaxRetries    int   `json:"max_retries"`
		BackoffBaseMs int64 `json:"backoff_base_ms"`
		BackoffCapMs  int64 `json:"backoff_cap_ms"`
	} `json:"retry"`
	Poll struct {
		MaxPolls     int     `json:"max_polls"`
		FirstDelayMs int64   `json:"first_delay_ms"`
		Growth       float64 `json:"growth"`
		CapMs        int64   `json:"cap_ms"`
	} `json:"poll"`
	Paths struct {
		Submit    string `json:"submit"`
		Result    string `json:"result"`
		Judge     string `json:"judge"`
		Languages string `json:"languages"`
		Health    string `json:"health"`
		Ready     string `json:"ready"`
	} `json:"paths"`
	Verdicts         []Verdict      `json:"verdicts"`
	Statuses         []Status       `json:"statuses"`
	TerminalStatuses []Status       `json:"terminal_statuses"`
	HealthStatuses   []HealthStatus `json:"health_statuses"`
	Unknown          string         `json:"unknown"`
	Errors           []ErrorKind    `json:"errors"`
}

type contractFile struct {
	bindings
	UserAgent   string           `json:"user_agent"`
	Operations  []string         `json:"operations"`
	ConfigCases []configCase     `json:"config_cases"`
	Resolution  []resolutionCase `json:"resolution"`
	RegionCases []regionCase     `json:"region_cases"`
}

type configCase struct {
	Name        string            `json:"name"`
	APIKey      string            `json:"api_key"`
	MaxRetries  *int              `json:"max_retries"`
	TimeoutSecs *float64          `json:"timeout_secs"`
	Regions     map[string]string `json:"regions"`
	ExpectError *string           `json:"expect_error"`
}

type resolutionCase struct {
	Name        string  `json:"name"`
	BaseURL     *string `json:"base_url"`
	EnvBaseURL  string  `json:"env_base_url"`
	Region      *string `json:"region"`
	EnvRegion   string  `json:"env_region"`
	Expect      *string `json:"expect"`
	ExpectError *string `json:"expect_error"`
}

type canned struct {
	Status  int               `json:"status"`
	Headers map[string]string `json:"headers"`
	Body    json.RawMessage   `json:"body"`
}

type regionCase struct {
	Name    string  `json:"name"`
	Pin     *string `json:"pin"`
	Regions map[string]struct {
		Health struct {
			Status  int   `json:"status"`
			DelayMs int64 `json:"delay_ms"`
		} `json:"health"`
		Languages canned `json:"languages"`
	} `json:"regions"`
	Expect []projection      `json:"expect"`
	Calls  map[string]counts `json:"calls"`
}

type counts struct {
	Health    int `json:"health"`
	Languages int `json:"languages"`
}

type scenarioFile struct {
	Scenarios []scenario `json:"scenarios"`
}

type scenario struct {
	Name      string     `json:"name"`
	Call      call       `json:"call"`
	Exchanges []exchange `json:"exchanges"`
	Expect    projection `json:"expect"`
}

type call struct {
	Op             string      `json:"op"`
	Language       string      `json:"language"`
	Code           string      `json:"code"`
	Stdin          string      `json:"stdin"`
	ID             string      `json:"id"`
	IdempotencyKey *string     `json:"idempotency_key"`
	Cases          []JudgeCase `json:"cases"`
}

type exchange struct {
	Times   *int `json:"times"`
	Request struct {
		Method         string            `json:"method"`
		Path           string            `json:"path"`
		Query          map[string]string `json:"query"`
		Body           json.RawMessage   `json:"body"`
		IdempotencyKey *string           `json:"idempotency_key"`
	} `json:"request"`
	Response canned `json:"response"`
}

type resultView struct {
	ID       string   `json:"id"`
	Status   Status   `json:"status"`
	Verdict  *Verdict `json:"verdict"`
	Stdout   *string  `json:"stdout"`
	ExitCode *int     `json:"exit_code"`
}

type acceptedView struct {
	ID     string `json:"id"`
	Status Status `json:"status"`
}

type judgeView struct {
	AllPassed bool       `json:"all_passed"`
	Verdicts  []*Verdict `json:"verdicts"`
	Passed    []bool     `json:"passed"`
}

type errorView struct {
	Kind           ErrorKind `json:"kind"`
	Status         *int      `json:"status"`
	RetryAfterSecs *int      `json:"retry_after_secs"`
	Message        *string   `json:"message"`
	RunID          *string   `json:"run_id"`
}

type projection struct {
	Result    *resultView   `json:"result"`
	Accepted  *acceptedView `json:"accepted"`
	Judge     *judgeView    `json:"judge"`
	Languages []string      `json:"languages"`
	Health    *HealthStatus `json:"health"`
	Error     *errorView    `json:"error"`
}

type fixture interface {
	contractFile | scenarioFile
}

func decodeFile[T fixture](t *testing.T, path string) T {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var value T
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	return value
}

func noEnv(string) string { return "" }

func sdkBindings() bindings {
	var b bindings
	b.Version = Version
	b.Regions = Regions()
	b.DefaultRegion = DefaultRegion
	b.RegionSelection.ProbePath = pathHealth
	b.RegionSelection.ProbeTimeoutMs = ProbeTimeout.Milliseconds()
	b.RegionSelection.CacheTTLSecs = int64(RegionCacheTTL / time.Second)
	b.RegionSelection.FailoverPenaltySecs = int64(FailoverPenalty / time.Second)
	b.Env.BaseURL, b.Env.Region = EnvBaseURL, EnvRegion
	b.Headers.APIKey, b.Headers.UserAgent = headerAPIKey, headerUserAgent
	b.Headers.IdempotencyKey, b.Headers.RetryAfter = headerIdempotencyKey, headerRetryAfter
	b.TimeoutSecs = int64(DefaultTimeout / time.Second)
	b.Retry.MaxRetries = DefaultMaxRetries
	b.Retry.BackoffBaseMs, b.Retry.BackoffCapMs = BackoffBase.Milliseconds(), BackoffCap.Milliseconds()
	b.Poll.MaxPolls, b.Poll.Growth = PollMax, PollGrowth
	b.Poll.FirstDelayMs, b.Poll.CapMs = PollFirstDelay.Milliseconds(), PollCap.Milliseconds()
	b.Paths.Submit, b.Paths.Result, b.Paths.Judge = pathSubmit, pathResult, pathJudge
	b.Paths.Languages, b.Paths.Health, b.Paths.Ready = pathLanguages, pathHealth, pathReady
	b.Verdicts, b.Statuses, b.TerminalStatuses = Verdicts, Statuses, TerminalStatuses
	b.HealthStatuses, b.Unknown, b.Errors = HealthStatuses, unknown, ErrorKinds
	return b
}

var ops = map[string]func(context.Context, *Client, call) (projection, error){
	"submit": func(ctx context.Context, c *Client, in call) (projection, error) {
		accepted, err := c.Submit(ctx, RunRequest{Language: in.Language, Code: in.Code, Stdin: in.Stdin}, in.IdempotencyKey)
		return projection{Accepted: &acceptedView{ID: accepted.ID, Status: accepted.Status}}, err
	},
	"run": func(ctx context.Context, c *Client, in call) (projection, error) {
		execution, err := c.Run(ctx, RunRequest{Language: in.Language, Code: in.Code, Stdin: in.Stdin})
		return observeExecution(execution), err
	},
	"get_result": func(ctx context.Context, c *Client, in call) (projection, error) {
		execution, err := c.GetResult(ctx, in.ID)
		return observeExecution(execution), err
	},
	"judge": func(ctx context.Context, c *Client, in call) (projection, error) {
		judged, err := c.Judge(ctx, JudgeRequest{Language: in.Language, Code: in.Code, Cases: in.Cases})
		view := judgeView{AllPassed: judged.AllPassed}
		for _, r := range judged.Results {
			view.Verdicts = append(view.Verdicts, r.Verdict)
			view.Passed = append(view.Passed, r.Passed)
		}
		return projection{Judge: &view}, err
	},
	"languages": func(ctx context.Context, c *Client, _ call) (projection, error) {
		languages, err := c.GetLanguages(ctx)
		return projection{Languages: languages}, err
	},
	"health": func(ctx context.Context, c *Client, _ call) (projection, error) {
		status, err := c.GetHealth(ctx)
		return projection{Health: &status}, err
	},
	"ready": func(ctx context.Context, c *Client, _ call) (projection, error) {
		status, err := c.GetReady(ctx)
		return projection{Health: &status}, err
	},
}

func observeExecution(e Execution) projection {
	return projection{Result: &resultView{ID: e.ID, Status: e.Status, Verdict: e.Result.Verdict, Stdout: e.Output.Stdout, ExitCode: e.Result.ExitCode}}
}

func outcome(t *testing.T, c *Client, in call, wanted projection) projection {
	t.Helper()
	op, ok := ops[in.Op]
	if !ok {
		t.Fatalf("no SDK operation for %s", in.Op)
	}
	got, err := op(context.Background(), c, in)
	if err == nil {
		return got
	}
	var failed *Error
	if !errors.As(err, &failed) || wanted.Error == nil {
		t.Fatalf("unexpected error: %v", err)
	}
	view := errorView{Kind: failed.Kind}
	if wanted.Error.Status != nil {
		view.Status = &failed.Status
	}
	if wanted.Error.RetryAfterSecs != nil {
		view.RetryAfterSecs = failed.RetryAfterSecs
	}
	if wanted.Error.Message != nil {
		view.Message = &failed.Message
	}
	if wanted.Error.RunID != nil {
		view.RunID = &failed.RunID
	}
	return projection{Error: &view}
}

func TestSDKMatchesTheContract(t *testing.T) {
	contract := decodeFile[contractFile](t, contractPath)
	if !reflect.DeepEqual(contract.bindings, sdkBindings()) {
		t.Fatalf("SDK drifted from the contract:\ncontract %+v\nsdk      %+v", contract.bindings, sdkBindings())
	}
	wantUA := strings.NewReplacer("{lang}", Lang, "{version}", Version).Replace(contract.UserAgent)
	if UserAgent != wantUA {
		t.Fatalf("user agent %q, contract %q", UserAgent, wantUA)
	}
}

func TestEveryContractOperationIsImplementedAndExercised(t *testing.T) {
	contract := decodeFile[contractFile](t, contractPath)
	scenarios := decodeFile[scenarioFile](t, scenariosPath)
	implemented := make([]string, 0, len(ops))
	for op := range ops {
		implemented = append(implemented, op)
	}
	exercised := map[string]bool{}
	for _, s := range scenarios.Scenarios {
		exercised[s.Call.Op] = true
	}
	sort.Strings(implemented)
	want := append([]string(nil), contract.Operations...)
	sort.Strings(want)
	if !reflect.DeepEqual(implemented, want) || len(exercised) != len(want) {
		t.Fatalf("implemented %v, exercised %v, contract %v", implemented, exercised, want)
	}
}

func TestClientConfig(t *testing.T) {
	for _, tc := range decodeFile[contractFile](t, contractPath).ConfigCases {
		t.Run(tc.Name, func(t *testing.T) {
			opts := []Option{WithEnv(noEnv)}
			if tc.MaxRetries != nil {
				opts = append(opts, WithMaxRetries(*tc.MaxRetries))
			}
			if tc.TimeoutSecs != nil {
				opts = append(opts, WithTimeout(time.Duration(*tc.TimeoutSecs*float64(time.Second))))
			}
			if tc.Regions != nil {
				opts = append(opts, WithRegions(tc.Regions))
			}
			_, err := loadConfig(tc.APIKey, opts...)
			if (tc.ExpectError != nil) != errors.Is(err, ErrConfig) || (tc.ExpectError == nil && err != nil) {
				t.Fatalf("expect_error=%v err=%v", tc.ExpectError, err)
			}
		})
	}
}

func TestBaseURLResolution(t *testing.T) {
	for _, tc := range decodeFile[contractFile](t, contractPath).Resolution {
		t.Run(tc.Name, func(t *testing.T) {
			env := func(key string) string {
				return map[string]string{EnvBaseURL: tc.EnvBaseURL, EnvRegion: tc.EnvRegion}[key]
			}
			pinned, err := pinnedBaseURL(tc.BaseURL, tc.Region, env, Regions())
			if tc.ExpectError != nil {
				if !errors.Is(err, ErrConfig) {
					t.Fatalf("want a config error, got %v", err)
				}
				return
			}
			got := Regions()[DefaultRegion]
			if pinned != nil {
				got = *pinned
			}
			if err != nil || tc.Expect == nil || got != *tc.Expect {
				t.Fatalf("got %q (%v), want %v", got, err, tc.Expect)
			}
		})
	}
}

type recorded struct {
	method, path, key string
	query             map[string]string
	headers           http.Header
	body              []byte
}

func TestScenarios(t *testing.T) {
	for _, sc := range decodeFile[scenarioFile](t, scenariosPath).Scenarios {
		t.Run(sc.Name, func(t *testing.T) {
			var exchanges []exchange
			for _, listed := range sc.Exchanges {
				times := 1
				if listed.Times != nil {
					times = *listed.Times
				}
				for repeat := 0; repeat < times; repeat++ {
					exchanges = append(exchanges, listed)
				}
			}
			var mu sync.Mutex
			var seen []recorded
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				body, _ := io.ReadAll(r.Body)
				query := map[string]string{}
				for key := range r.URL.Query() {
					query[key] = r.URL.Query().Get(key)
				}
				mu.Lock()
				seen = append(seen, recorded{method: r.Method, path: r.URL.EscapedPath(), key: r.Header.Get(headerIdempotencyKey), query: query, headers: r.Header.Clone(), body: body})
				index := len(seen) - 1
				mu.Unlock()
				if index >= len(exchanges) {
					w.WriteHeader(http.StatusTeapot)
					return
				}
				reply := exchanges[index].Response
				for name, value := range reply.Headers {
					w.Header().Set(name, value)
				}
				w.WriteHeader(reply.Status)
				_, _ = w.Write(reply.Body)
			}))
			defer server.Close()
			client, err := New(testAPIKey, WithBaseURL(server.URL), WithEnv(noEnv))
			if err != nil {
				t.Fatal(err)
			}
			if got := outcome(t, client, sc.Call, sc.Expect); !reflect.DeepEqual(got, sc.Expect) {
				t.Fatalf("outcome %s, want %s", mustJSON(got), mustJSON(sc.Expect))
			}
			if len(seen) != len(exchanges) {
				t.Fatalf("%d requests, want %d", len(seen), len(exchanges))
			}
			previous := ""
			for index, got := range seen {
				checkRequest(t, got, exchanges[index], previous)
				previous = got.key
			}
		})
	}
}

func checkRequest(t *testing.T, got recorded, want exchange, previousKey string) {
	t.Helper()
	expected := want.Request
	if got.method != expected.Method || got.path != expected.Path {
		t.Fatalf("request %s %s, want %s %s", got.method, got.path, expected.Method, expected.Path)
	}
	wantQuery := expected.Query
	if wantQuery == nil {
		wantQuery = map[string]string{}
	}
	if !reflect.DeepEqual(got.query, wantQuery) {
		t.Fatalf("query %v, want %v", got.query, wantQuery)
	}
	if got.headers.Get(headerAPIKey) != testAPIKey || got.headers.Get(headerUserAgent) != UserAgent {
		t.Fatalf("headers %v", got.headers)
	}
	if expected.Body == nil {
		if len(got.body) != 0 {
			t.Fatalf("unexpected body %s", got.body)
		}
	} else if !sameJSON(got.body, expected.Body) {
		t.Fatalf("body %s, want %s", got.body, expected.Body)
	}
	rule := absentRule
	if expected.IdempotencyKey != nil {
		rule = *expected.IdempotencyKey
	}
	switch rule {
	case absentRule:
		if got.key != "" {
			t.Fatalf("unexpected idempotency key %q", got.key)
		}
	case uuidRule:
		if !isUUID(got.key) {
			t.Fatalf("idempotency key %q is not a UUID", got.key)
		}
	case repeatRule:
		if got.key == "" || got.key != previousKey {
			t.Fatalf("idempotency key %q, want repeat of %q", got.key, previousKey)
		}
	default:
		if got.key != rule {
			t.Fatalf("idempotency key %q, want %q", got.key, rule)
		}
	}
}

func sameJSON(a, b []byte) bool {
	var left, right json.RawMessage
	return json.Unmarshal(a, &left) == nil && json.Unmarshal(b, &right) == nil && canonical(left) == canonical(right)
}

func canonical(raw json.RawMessage) string {
	var object map[string]json.RawMessage
	if json.Unmarshal(raw, &object) == nil {
		keys := make([]string, 0, len(object))
		for key := range object {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		parts := make([]string, 0, len(keys))
		for _, key := range keys {
			parts = append(parts, key+"="+canonical(object[key]))
		}
		return "{" + strings.Join(parts, ";") + "}"
	}
	var array []json.RawMessage
	if json.Unmarshal(raw, &array) == nil {
		parts := make([]string, 0, len(array))
		for _, item := range array {
			parts = append(parts, canonical(item))
		}
		return "[" + strings.Join(parts, ",") + "]"
	}
	var compact bytes.Buffer
	if json.Compact(&compact, raw) != nil {
		return string(raw)
	}
	return compact.String()
}

func mustJSON(p projection) string {
	raw, _ := json.Marshal(p)
	return string(raw)
}

func TestRegionSelection(t *testing.T) {
	for _, tc := range decodeFile[contractFile](t, contractPath).RegionCases {
		t.Run(tc.Name, func(t *testing.T) {
			prefix := "/" + strings.ReplaceAll(t.Name(), "/", "_")
			var mu sync.Mutex
			calls := map[string]counts{}
			regions := map[string]string{}
			for name, spec := range tc.Regions {
				name, spec := name, spec
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					mu.Lock()
					seen := calls[name]
					healthCall := strings.HasSuffix(r.URL.Path, pathHealth)
					if healthCall {
						seen.Health++
					} else {
						seen.Languages++
					}
					calls[name] = seen
					mu.Unlock()
					if healthCall {
						time.Sleep(time.Duration(spec.Health.DelayMs) * time.Millisecond)
						w.WriteHeader(spec.Health.Status)
						return
					}
					w.WriteHeader(spec.Languages.Status)
					_, _ = w.Write(spec.Languages.Body)
				}))
				defer server.Close()
				regions[name] = server.URL + prefix
				calls[name] = counts{}
			}
			for _, wanted := range tc.Expect {
				opts := []Option{WithRegions(regions), WithEnv(noEnv)}
				if tc.Pin != nil {
					opts = append(opts, WithRegion(*tc.Pin))
				}
				client, err := New(testAPIKey, opts...)
				if err != nil {
					t.Fatal(err)
				}
				if got := outcome(t, client, call{Op: "languages"}, wanted); !reflect.DeepEqual(got, wanted) {
					t.Fatalf("outcome %s, want %s", mustJSON(got), mustJSON(wanted))
				}
			}
			if !reflect.DeepEqual(calls, tc.Calls) {
				t.Fatalf("calls %v, want %v", calls, tc.Calls)
			}
		})
	}
	t.Run("an expired pick is probed again", func(t *testing.T) {
		config, err := loadConfig(testAPIKey, WithEnv(noEnv), WithRegions(map[string]string{
			"a": "https://a.expiry.test",
			"b": "https://b.expiry.test",
		}))
		if err != nil {
			t.Fatal(err)
		}
		policy := config.Region
		policy.CacheTTL = 0
		selector := newRegionSelector(policy, nil)
		var mu sync.Mutex
		probes := 0
		probe := func(context.Context, string) (time.Duration, bool) {
			mu.Lock()
			probes++
			mu.Unlock()
			return 0, true
		}
		for call := 0; call < 2; call++ {
			selector.current(context.Background(), probe)
		}
		if want := 2 * len(policy.Regions); probes != want {
			t.Fatalf("probes %d, want %d", probes, want)
		}
	})
}
