export class RustboxAuthError extends Error { constructor(m: string) { super(m); this.name="RustboxAuthError"; } }
export class RustboxRateLimitError extends Error { constructor(m: string) { super(m); this.name="RustboxRateLimitError"; } }
export class RustboxServerError extends Error { constructor(m: string) { super(m); this.name="RustboxServerError"; } }

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
};

const DEFAULT_BASE_URL = "https://rustbox-api.orkait.com";

export class Rustbox {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, opts: RustboxOptions = {}) {
    if (!apiKey) throw new Error("apiKey required");
    this.apiKey = apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  private async handle(res: Response): Promise<any> {
    if (res.ok || res.status === 408) return res.json();
    if (res.status === 401 || res.status === 403) throw new RustboxAuthError("Invalid API key");
    if (res.status === 429) throw new RustboxRateLimitError("Rate limit exceeded");
    if (res.status >= 500) throw new RustboxServerError(`Server error: ${res.status}`);
    const text = await res.text();
    throw new Error(`API Error: ${res.status} - ${text}`);
  }

  async submit(req: SubmitRequest, wait: boolean = false): Promise<SubmitResponse> {
    const res = await fetch(`${this.baseUrl}/api/submit?wait=${wait}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": this.apiKey },
      body: JSON.stringify({
        language: req.language,
        code: req.code,
        stdin: req.stdin ?? "",
        ...(req.profile ? { profile: req.profile } : {}),
      }),
    });
    return this.handle(res);
  }

  async getResult(id: string): Promise<SubmitResponse> {
    const res = await fetch(`${this.baseUrl}/api/result/${id}`, {
      headers: { "X-API-Key": this.apiKey },
    });
    return this.handle(res);
  }

  async getLanguages(): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/api/languages`, { headers: { "X-API-Key": this.apiKey } });
    return this.handle(res);
  }

  async getHealth(): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/health`, { headers: { "X-API-Key": this.apiKey } });
    return this.handle(res);
  }

  async getReady(): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/health/ready`, { headers: { "X-API-Key": this.apiKey } });
    return this.handle(res);
  }

  async run(req: SubmitRequest): Promise<SubmitResponse> {
    let res = await this.submit(req, true);
    if (res.verdict) return res;
    const id = res.id;

    for (let i = 0; i < 45; i++) {
      await new Promise(r => setTimeout(r, Math.min(40 * Math.pow(1.5, i), 600)));
      res = await this.getResult(id);
      if (res.verdict) return res;
    }
    return res;
  }
}
