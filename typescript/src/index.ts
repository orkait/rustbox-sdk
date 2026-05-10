export const VERSION = "0.1.0";

export class RustboxAuthError extends Error { constructor(m: string) { super(m); this.name="RustboxAuthError"; } }
export class RustboxRateLimitError extends Error { constructor(m: string) { super(m); this.name="RustboxRateLimitError"; } }
export class RustboxServerError extends Error { constructor(m: string) { super(m); this.name="RustboxServerError"; } }
export class RustboxTimeoutError extends Error { constructor(m: string) { super(m); this.name="RustboxTimeoutError"; } }

export type Profile = "judge" | "agent";

export type SubmitRequest = {
  language: string;
  code: string;
  stdin?: string;
  /** "judge" (default) for short evaluation runs. "agent" for longer
   *  jobs with egress proxy + per-key byte budgets. Agent requires a
   *  non-trial API key. */
  profile?: Profile;
};

export type SubmitResponse = { id: string; verdict?: string; [key: string]: any; };

export type RustboxOptions = {
  baseUrl?: string;
  /** Per-request timeout in ms. Default 65_000. Set 0 to disable. */
  timeoutMs?: number;
  /** Max retries on transient errors (5xx, network). Default 2 (3 attempts total). */
  maxRetries?: number;
};

export type SubmitOptions = {
  /** Optional Idempotency-Key header. Safe to retry POST /api/submit when set. */
  idempotencyKey?: string;
};

const DEFAULT_BASE_URL = "https://rustbox-api.orkait.com";
const DEFAULT_TIMEOUT_MS = 65_000;
const DEFAULT_MAX_RETRIES = 2;
const USER_AGENT = `rustbox-sdk-ts/${VERSION}`;

export class Rustbox {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(apiKey: string, opts: RustboxOptions = {}) {
    if (!apiKey) throw new Error("apiKey required");
    this.apiKey = apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  /** Send a request with retry on transient failure (5xx + network).
   *  Idempotency-Key + 4xx are NOT retried (caller handles auth/quota). */
  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const ctrl = new AbortController();
      const timer = this.timeoutMs > 0 ? setTimeout(() => ctrl.abort(), this.timeoutMs) : null;
      try {
        const res = await fetch(url, { ...init, signal: ctrl.signal });
        if (res.status >= 500 && attempt < this.maxRetries) {
          await this.sleep(this.backoff(attempt));
          continue;
        }
        return res;
      } catch (e) {
        lastErr = e;
        if (e instanceof Error && e.name === "AbortError") {
          if (attempt >= this.maxRetries) throw new RustboxTimeoutError(`request timed out after ${this.timeoutMs}ms`);
        } else if (attempt >= this.maxRetries) {
          throw e;
        }
        await this.sleep(this.backoff(attempt));
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    throw lastErr ?? new Error("retry exhausted");
  }

  private backoff(attempt: number): number {
    return Math.min(100 * Math.pow(2, attempt), 5_000);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      "X-API-Key": this.apiKey,
      "User-Agent": USER_AGENT,
      ...extra,
    };
  }

  private async handle(res: Response): Promise<any> {
    if (res.ok || res.status === 408) return res.json();
    if (res.status === 401 || res.status === 403) throw new RustboxAuthError("Invalid API key");
    if (res.status === 429) throw new RustboxRateLimitError("Rate limit exceeded");
    if (res.status >= 500) throw new RustboxServerError(`Server error: ${res.status}`);
    const text = await res.text();
    throw new Error(`API Error: ${res.status} - ${text}`);
  }

  async submit(req: SubmitRequest, wait: boolean = false, opts: SubmitOptions = {}): Promise<SubmitResponse> {
    const body: Record<string, unknown> = {
      language: req.language,
      code: req.code,
      stdin: req.stdin ?? "",
    };
    if (req.profile) body.profile = req.profile;

    const headers = this.headers({ "Content-Type": "application/json" });
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

    const res = await this.fetchWithRetry(`${this.baseUrl}/api/submit?wait=${wait}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    return this.handle(res);
  }

  async getResult(id: string): Promise<SubmitResponse> {
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/result/${id}`, {
      headers: this.headers(),
    });
    return this.handle(res);
  }

  async getLanguages(): Promise<string[]> {
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/languages`, { headers: this.headers() });
    return this.handle(res);
  }

  async getHealth(): Promise<any> {
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/health`, { headers: this.headers() });
    return this.handle(res);
  }

  async getReady(): Promise<any> {
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/health/ready`, { headers: this.headers() });
    return this.handle(res);
  }

  /** Submit + wait (sync) + auto-poll fallback. Auto-generates an
   *  Idempotency-Key so the underlying POST is safe to retry. */
  async run(req: SubmitRequest): Promise<SubmitResponse> {
    const idempotencyKey = crypto.randomUUID();
    let res = await this.submit(req, true, { idempotencyKey });
    if (res.verdict) return res;
    const id = res.id;

    for (let i = 0; i < 45; i++) {
      await this.sleep(Math.min(40 * Math.pow(1.5, i), 600));
      res = await this.getResult(id);
      if (res.verdict) return res;
    }
    return res;
  }
}
