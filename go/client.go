package rustbox

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"
)

const DefaultBaseURL = "https://rustbox-api.orkait.com"

type SubmitRequest struct {
	Language string `json:"language"`
	Code     string `json:"code"`
	Stdin    string `json:"stdin"`
}

type Client struct {
	APIKey  string
	BaseURL string
	HTTP    *http.Client
}

// Option configures a Client. Pass to New as variadic args.
type Option func(*Client)

// WithBaseURL overrides the default API base URL. Use for self-hosted
// Rustbox or staging environments. Default: https://rustbox-api.orkait.com.
func WithBaseURL(baseURL string) Option {
	return func(c *Client) {
		c.BaseURL = strings.TrimRight(baseURL, "/")
	}
}

// WithHTTPClient overrides the default HTTP client (65s timeout).
func WithHTTPClient(h *http.Client) Option {
	return func(c *Client) {
		c.HTTP = h
	}
}

// New creates a Client. apiKey is required and must be non-empty.
// baseURL defaults to https://rustbox-api.orkait.com; override with WithBaseURL.
func New(apiKey string, opts ...Option) *Client {
	if apiKey == "" {
		panic("rustbox: apiKey required")
	}
	c := &Client{
		APIKey:  apiKey,
		BaseURL: DefaultBaseURL,
		HTTP:    &http.Client{Timeout: 65 * time.Second},
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

func (c *Client) do(req *http.Request) (*http.Response, error) {
	req.Header.Set("X-API-Key", c.APIKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != 200 && resp.StatusCode != 202 && resp.StatusCode != 408 {
		resp.Body.Close()
		return nil, fmt.Errorf("API Error: %d", resp.StatusCode)
	}
	return resp, nil
}

func (c *Client) handle(req *http.Request) (map[string]interface{}, error) {
	resp, err := c.do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var data map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, err
	}
	return data, nil
}

func (c *Client) Submit(req SubmitRequest, wait bool) (map[string]interface{}, error) {
	body, _ := json.Marshal(req)
	url := fmt.Sprintf("%s/api/submit?wait=%t", c.BaseURL, wait)
	httpReq, _ := http.NewRequest("POST", url, bytes.NewBuffer(body))
	return c.handle(httpReq)
}

func (c *Client) GetResult(id string) (map[string]interface{}, error) {
	httpReq, _ := http.NewRequest("GET", fmt.Sprintf("%s/api/result/%s", c.BaseURL, id), nil)
	return c.handle(httpReq)
}

func (c *Client) GetLanguages() ([]string, error) {
	httpReq, _ := http.NewRequest("GET", fmt.Sprintf("%s/api/languages", c.BaseURL), nil)
	resp, err := c.do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var data []string
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, err
	}
	return data, nil
}

func (c *Client) GetHealth() (map[string]interface{}, error) {
	httpReq, _ := http.NewRequest("GET", fmt.Sprintf("%s/api/health", c.BaseURL), nil)
	return c.handle(httpReq)
}

func (c *Client) GetReady() (map[string]interface{}, error) {
	httpReq, _ := http.NewRequest("GET", fmt.Sprintf("%s/api/health/ready", c.BaseURL), nil)
	return c.handle(httpReq)
}

func (c *Client) Run(req SubmitRequest) (map[string]interface{}, error) {
	res, err := c.Submit(req, true)
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
