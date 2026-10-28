package rustbox

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Client struct {
	config    Config
	transport *transport
	regions   *regionSelector
}

func New(apiKey string, opts ...Option) (*Client, error) {
	config, err := loadConfig(apiKey, opts...)
	if err != nil {
		return nil, err
	}
	return &Client{
		config:    config,
		transport: &transport{client: &http.Client{Timeout: config.Timeout}, apiKey: config.APIKey, retry: config.Retry},
		regions:   newRegionSelector(config.Region, config.PinnedBaseURL),
	}, nil
}

func (c *Client) BaseURL(ctx context.Context) string {
	return c.regions.current(ctx, func(ctx context.Context, base string) (time.Duration, bool) {
		return c.transport.probe(ctx, base, c.config.Region.ProbeTimeout)
	})
}

func (c *Client) send(ctx context.Context, base string, req request) (*http.Response, error) {
	resp, err := c.transport.send(ctx, base, req)
	var failed *Error
	if errors.As(err, &failed) && failed.Transient() {
		c.regions.reportFailure(base)
	}
	return resp, err
}

func (c *Client) call(ctx context.Context, req request) (*http.Response, error) {
	return c.send(ctx, c.BaseURL(ctx), req)
}

func (c *Client) Submit(ctx context.Context, run RunRequest, idempotencyKey *string) (Accepted, error) {
	if idempotencyKey != nil && !isUUID(*idempotencyKey) {
		return Accepted{}, configError(fmt.Sprintf("idempotencyKey must be a UUID, got %q", *idempotencyKey))
	}
	req, err := postRequest(pathSubmit, run, url.Values{queryWait: {waitFalse}}, idempotencyKey)
	if err != nil {
		return Accepted{}, err
	}
	resp, err := c.call(ctx, req)
	if err != nil {
		return Accepted{}, err
	}
	return expect[Accepted](resp, http.StatusAccepted)
}

func (c *Client) Run(ctx context.Context, run RunRequest) (Execution, error) {
	key, err := newUUID()
	if err != nil {
		return Execution{}, &Error{Kind: KindConfig, Message: "idempotency key generation failed", Cause: err}
	}
	req, err := postRequest(pathSubmit, run, url.Values{queryWait: {waitTrue}}, &key)
	if err != nil {
		return Execution{}, err
	}
	base := c.BaseURL(ctx)
	resp, err := c.send(ctx, base, req)
	if err != nil {
		return Execution{}, err
	}
	if resp.StatusCode == http.StatusOK {
		return expect[Execution](resp, http.StatusOK)
	}
	started, err := expect[pending](resp, http.StatusAccepted, http.StatusRequestTimeout)
	if err != nil {
		return Execution{}, err
	}
	return c.poll(ctx, base, started.ID)
}

func (c *Client) poll(ctx context.Context, base, runID string) (Execution, error) {
	for _, delay := range c.config.Poll.Delays() {
		if err := sleep(ctx, delay); err != nil {
			return Execution{}, failure(err)
		}
		execution, err := c.fetch(ctx, base, runID)
		if err != nil {
			return Execution{}, err
		}
		if execution.Done() {
			return execution, nil
		}
	}
	return Execution{}, &Error{
		Kind:    KindStillRunning,
		RunID:   runID,
		Message: fmt.Sprintf("run %s is still running after the polling budget; call GetResult later", runID),
	}
}

func (c *Client) fetch(ctx context.Context, base, runID string) (Execution, error) {
	resp, err := c.send(ctx, base, getRequest(strings.Replace(pathResult, pathID, url.PathEscape(runID), 1)))
	if err != nil {
		return Execution{}, err
	}
	return expect[Execution](resp, http.StatusOK)
}

func (c *Client) GetResult(ctx context.Context, runID string) (Execution, error) {
	return c.fetch(ctx, c.BaseURL(ctx), runID)
}

func (c *Client) Judge(ctx context.Context, judge JudgeRequest) (JudgeResult, error) {
	req, err := postRequest(pathJudge, judge, nil, nil)
	if err != nil {
		return JudgeResult{}, err
	}
	resp, err := c.call(ctx, req)
	if err != nil {
		return JudgeResult{}, err
	}
	return expect[JudgeResult](resp, http.StatusOK)
}

func (c *Client) GetLanguages(ctx context.Context) ([]string, error) {
	resp, err := c.call(ctx, getRequest(pathLanguages))
	if err != nil {
		return nil, err
	}
	return expect[[]string](resp, http.StatusOK)
}

func (c *Client) GetHealth(ctx context.Context) (HealthStatus, error) {
	return c.health(ctx, pathHealth)
}

func (c *Client) GetReady(ctx context.Context) (HealthStatus, error) {
	return c.health(ctx, pathReady)
}

func (c *Client) health(ctx context.Context, path string) (HealthStatus, error) {
	resp, err := c.call(ctx, getRequest(path))
	if err != nil {
		return HealthUnknown, err
	}
	status, err := expect[health](resp, http.StatusOK)
	return status.Status, err
}
