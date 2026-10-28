package rustbox

import (
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"
	"time"
)

const (
	EnvBaseURL = "RUSTBOX_BASE_URL"
	EnvRegion  = "RUSTBOX_REGION"

	DefaultRegion       = "in"
	defaultRegionURL    = "https://api.rustbox.sh"
	ProbeTimeout        = 1500 * time.Millisecond
	RegionCacheTTL      = 6 * time.Hour
	FailoverPenalty     = 5 * time.Minute
	DefaultTimeout      = 65 * time.Second
	DefaultMaxRetries   = 2
	BackoffBase         = 100 * time.Millisecond
	BackoffCap          = 5 * time.Second
	PollMax             = 45
	PollFirstDelay      = 40 * time.Millisecond
	PollGrowth          = 1.5
	PollCap             = 600 * time.Millisecond
	trailingSlash       = "/"
	schemeHTTP          = "http://"
	schemeHTTPS         = "https://"
	regionListSeparator = ", "
)

var apiKeyPattern = regexp.MustCompile(`^[\x21-\x7e]+$`)

func Regions() map[string]string {
	return map[string]string{DefaultRegion: defaultRegionURL}
}

type Env func(key string) string

func ProcessEnv(key string) string {
	return os.Getenv(key)
}

type RetryPolicy struct {
	MaxRetries  int
	BackoffBase time.Duration
	BackoffCap  time.Duration
}

func (p RetryPolicy) Delay(attempt int) time.Duration {
	delay := p.BackoffBase
	for step := 0; step < attempt && delay < p.BackoffCap; step++ {
		delay *= 2
	}
	return min(delay, p.BackoffCap)
}

type PollPolicy struct {
	MaxPolls   int
	FirstDelay time.Duration
	Growth     float64
	Cap        time.Duration
}

func (p PollPolicy) Delays() []time.Duration {
	delays := make([]time.Duration, 0, p.MaxPolls)
	delay := p.FirstDelay
	for len(delays) < p.MaxPolls {
		delays = append(delays, delay)
		delay = min(time.Duration(float64(delay)*p.Growth), p.Cap)
	}
	return delays
}

type RegionPolicy struct {
	Regions         map[string]string
	Fallback        string
	ProbeTimeout    time.Duration
	CacheTTL        time.Duration
	FailoverPenalty time.Duration
}

type Config struct {
	APIKey        string
	PinnedBaseURL *string
	Timeout       time.Duration
	Retry         RetryPolicy
	Poll          PollPolicy
	Region        RegionPolicy
}

type options struct {
	baseURL    *string
	region     *string
	regions    map[string]string
	timeout    time.Duration
	maxRetries int
	env        Env
}

type Option func(*options)

func WithBaseURL(baseURL string) Option { return func(o *options) { o.baseURL = &baseURL } }

func WithRegion(region string) Option { return func(o *options) { o.region = &region } }

func WithRegions(regions map[string]string) Option { return func(o *options) { o.regions = regions } }

func WithTimeout(timeout time.Duration) Option { return func(o *options) { o.timeout = timeout } }

func WithMaxRetries(maxRetries int) Option { return func(o *options) { o.maxRetries = maxRetries } }

func WithEnv(env Env) Option { return func(o *options) { o.env = env } }

func validURL(value, what string) (string, error) {
	if !strings.HasPrefix(value, schemeHTTP) && !strings.HasPrefix(value, schemeHTTPS) {
		return "", configError(fmt.Sprintf("%s must start with http:// or https://, got %q", what, value))
	}
	return strings.TrimRight(value, trailingSlash), nil
}

func knownRegion(regions map[string]string, name string) (string, error) {
	if base, ok := regions[name]; ok {
		return base, nil
	}
	names := make([]string, 0, len(regions))
	for known := range regions {
		names = append(names, known)
	}
	sort.Strings(names)
	return "", configError(fmt.Sprintf("unknown region %q; known regions: %s", name, strings.Join(names, regionListSeparator)))
}

func pinnedBaseURL(baseURL, region *string, env Env, regions map[string]string) (*string, error) {
	pin := func(value string, err error) (*string, error) {
		if err != nil {
			return nil, err
		}
		return &value, nil
	}
	if baseURL != nil {
		return pin(validURL(*baseURL, "baseURL"))
	}
	if envBaseURL := env(EnvBaseURL); envBaseURL != "" {
		return pin(validURL(envBaseURL, EnvBaseURL))
	}
	if region != nil {
		return pin(knownRegion(regions, *region))
	}
	if envRegion := env(EnvRegion); envRegion != "" {
		return pin(knownRegion(regions, envRegion))
	}
	return nil, nil
}

func loadConfig(apiKey string, opts ...Option) (Config, error) {
	o := options{regions: Regions(), timeout: DefaultTimeout, maxRetries: DefaultMaxRetries, env: ProcessEnv}
	for _, opt := range opts {
		opt(&o)
	}
	if !apiKeyPattern.MatchString(apiKey) {
		return Config{}, configError("apiKey is required and must be visible ASCII without spaces")
	}
	if o.maxRetries < 0 {
		return Config{}, configError(fmt.Sprintf("maxRetries must not be negative, got %d", o.maxRetries))
	}
	if o.timeout <= 0 {
		return Config{}, configError(fmt.Sprintf("timeout must be positive, got %s", o.timeout))
	}
	regions := make(map[string]string, len(o.regions))
	for name, base := range o.regions {
		checked, err := validURL(base, "region "+name)
		if err != nil {
			return Config{}, err
		}
		regions[name] = checked
	}
	fallback, ok := regions[DefaultRegion]
	if !ok {
		names := make([]string, 0, len(regions))
		for name := range regions {
			names = append(names, name)
		}
		if len(names) == 0 {
			return Config{}, configError("regions must not be empty")
		}
		sort.Strings(names)
		fallback = regions[names[0]]
	}
	pinned, err := pinnedBaseURL(o.baseURL, o.region, o.env, regions)
	if err != nil {
		return Config{}, err
	}
	return Config{
		APIKey:        apiKey,
		PinnedBaseURL: pinned,
		Timeout:       o.timeout,
		Retry:         RetryPolicy{MaxRetries: o.maxRetries, BackoffBase: BackoffBase, BackoffCap: BackoffCap},
		Poll:          PollPolicy{MaxPolls: PollMax, FirstDelay: PollFirstDelay, Growth: PollGrowth, Cap: PollCap},
		Region: RegionPolicy{
			Regions:         regions,
			Fallback:        fallback,
			ProbeTimeout:    ProbeTimeout,
			CacheTTL:        RegionCacheTTL,
			FailoverPenalty: FailoverPenalty,
		},
	}, nil
}
