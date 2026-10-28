package rustbox

const (
	Version   = "0.6.0"
	Lang      = "go"
	UserAgent = "rustbox-sdk-" + Lang + "/" + Version

	headerAPIKey         = "X-API-Key"
	headerUserAgent      = "User-Agent"
	headerContentType    = "Content-Type"
	headerIdempotencyKey = "Idempotency-Key"
	headerRetryAfter     = "Retry-After"
	contentTypeJSON      = "application/json"

	pathSubmit    = "/api/submit"
	pathResult    = "/api/result/{id}"
	pathJudge     = "/api/judge"
	pathLanguages = "/api/languages"
	pathHealth    = "/api/health"
	pathReady     = "/api/health/ready"
	pathID        = "{id}"

	querySeparator = "?"
	queryWait      = "wait"
	waitTrue       = "true"
	waitFalse      = "false"
	unknown        = "UNKNOWN"
)
