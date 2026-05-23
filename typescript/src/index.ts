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
  profile?: Profile;
};

export type SubmitResponse = { id: string; verdict?: string; [key: string]: any; };

/** Known regions. Add new entries here when a region launches; the
 *  region-pick algorithm probes every entry and picks the fastest. */
export const REGIONS: Record<string, string> = {
  eu: "https://rustbox-eu.orkait.com",
  us: "https://rustbox-us.orkait.com",
};

export type RegionId = keyof typeof REGIONS;

export type RustboxOptions = {
  /** Explicit base URL. Wins over `region` and auto-probe. */
  baseUrl?: string;
  /** Pick a known region by id (e.g. "eu", "us"). Skips probing. */
  region?: RegionId;
  /** Per-request timeout in ms. Default 65_000. Set 0 to disable. */
  timeoutMs?: number;
  /** Max retries on transient errors (5xx, network). Default 2. */
  maxRetries?: number;
  /** Override the regions table at construct time (advanced). */
  regions?: Record<string, string>;
  /** Cross-region failover: on 5xx/timeout/network, try other regions
   *  before raising. Default true. */
  failoverAcrossRegions?: boolean;
};

export type SubmitOptions = {
  idempotencyKey?: string;
};

const DEFAULT_TIMEOUT_MS = 65_000;
const DEFAULT_MAX_RETRIES = 2;
const PROBE_TIMEOUT_MS = 1_500;
const PICK_CACHE_TTL_MS = 60 * 60 * 1000;       // 1 h
const FAILOVER_PENALTY_MS = 5 * 60 * 1000;       // 5 min "down" mark
const USER_AGENT = `rustbox-sdk-ts/${VERSION}`;

/** Module-level cache so multiple Rustbox instances in the same process
 *  share probe results. Keyed by JSON of the regions table so callers
 *  with a custom regions list don't share state with the default. */
type PickEntry = { base: string; pickedAt: number };
const pickCache: Map<string, PickEntry> = new Map();
/** Per-base "marked unhealthy at" timestamp; ignored after FAILOVER_PENALTY_MS */
const unhealthySince: Map<string, number> = new Map();

function envRegion(): string | undefined {
  if (typeof process !== "undefined" && process?.env) {
    return process.env.RUSTBOX_REGION || process.env.NEXT_PUBLIC_RUSTBOX_REGION || undefined;
  }
  return undefined;
}

function envBaseUrl(): string | undefined {
  if (typeof process !== "undefined" && process?.env) {
    return process.env.RUSTBOX_BASE_URL || undefined;
  }
  return undefined;
}

/** Probe `${base}/api/health` with a short timeout; return ms or `null` on failure. */
async function probe(base: string): Promise<number | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  const start = performance.now();
  try {
    const res = await fetch(`${base}/api/health`, { method: "GET", signal: ctrl.signal });
    if (!res.ok) return null;
    return performance.now() - start;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Probe every region in parallel, return the fastest reachable base URL.
 *  Returns the first listed region if all probes fail (better than throwing). */
export async function pickFastestRegion(regions: Record<string, string> = REGIONS): Promise<string> {
  const cacheKey = JSON.stringify(regions);
  const cached = pickCache.get(cacheKey);
  if (cached && Date.now() - cached.pickedAt < PICK_CACHE_TTL_MS) {
    return cached.base;
  }
  const entries = Object.values(regions);
  const results = await Promise.all(entries.map(async (b) => ({ base: b, ms: await probe(b) })));
  const reachable = results.filter((r) => r.ms !== null) as { base: string; ms: number }[];
  const base = reachable.length > 0
    ? reachable.sort((a, b) => a.ms - b.ms)[0].base
    : entries[0];
  pickCache.set(cacheKey, { base, pickedAt: Date.now() });
  return base;
}

export class Rustbox {
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly regions: Record<string, string>;
  private readonly failoverAcrossRegions: boolean;

  /** Resolved at first request if neither baseUrl nor region was given. */
  private baseUrlPromise: Promise<string>;

  constructor(apiKey: string, opts: RustboxOptions = {}) {
    if (!apiKey) throw new Error("apiKey required");
    this.apiKey = apiKey;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.regions = opts.regions ?? REGIONS;
    this.failoverAcrossRegions = opts.failoverAcrossRegions ?? true;

    // Resolve base URL: explicit > env baseUrl > explicit region > env region > probe.
    const explicitBase = opts.baseUrl ?? envBaseUrl();
    const explicitRegion = opts.region ?? envRegion();
    if (explicitBase) {
      this.baseUrlPromise = Promise.resolve(explicitBase.replace(/\/+$/, ""));
    } else if (explicitRegion && this.regions[explicitRegion]) {
      this.baseUrlPromise = Promise.resolve(this.regions[explicitRegion]);
    } else {
      this.baseUrlPromise = pickFastestRegion(this.regions);
    }
  }

  /** Resolved current base. Awaits the probe the first time. */
  async base(): Promise<string> { return this.baseUrlPromise; }

  /** Return the list of alternate region bases ordered by recent health. */
  private alternates(current: string): string[] {
    const now = Date.now();
    return Object.values(this.regions)
      .filter((b) => b !== current)
      .filter((b) => {
        const since = unhealthySince.get(b);
        return !since || now - since > FAILOVER_PENALTY_MS;
      });
  }

  private markUnhealthy(base: string): void {
    unhealthySince.set(base, Date.now());
  }

  /** Fetch with intra-region retry on 5xx/network + cross-region failover. */
  private async fetchWithRetry(path: string, init: RequestInit): Promise<Response> {
    let current = await this.base();
    const triedBases = new Set<string>();
    let lastErr: unknown;
    while (true) {
      triedBases.add(current);
      try {
        return await this.fetchOnce(current, path, init);
      } catch (e) {
        lastErr = e;
        const transient = (e as Error)?.name === "AbortError"
          || e instanceof RustboxServerError
          || (e instanceof TypeError /* network err */);
        if (!transient || !this.failoverAcrossRegions) throw e;
        this.markUnhealthy(current);
        const next = this.alternates(current).find((b) => !triedBases.has(b));
        if (!next) throw e;
        current = next;
        // Update baseUrlPromise so subsequent requests start at the working region.
        this.baseUrlPromise = Promise.resolve(current);
        // Invalidate the module-level pick cache so other instances re-probe.
        pickCache.delete(JSON.stringify(this.regions));
      }
    }
  }

  private async fetchOnce(base: string, path: string, init: RequestInit): Promise<Response> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const ctrl = new AbortController();
      const timer = this.timeoutMs > 0 ? setTimeout(() => ctrl.abort(), this.timeoutMs) : null;
      try {
        const res = await fetch(`${base}${path}`, { ...init, signal: ctrl.signal });
        if (res.status >= 500 && attempt < this.maxRetries) {
          await this.sleep(this.backoff(attempt));
          continue;
        }
        if (res.status >= 500) {
          throw new RustboxServerError(`Server error: ${res.status}`);
        }
        return res;
      } catch (e) {
        lastErr = e;
        if (e instanceof Error && e.name === "AbortError") {
          if (attempt >= this.maxRetries) throw new RustboxTimeoutError(`request timed out after ${this.timeoutMs}ms`);
        } else if (e instanceof RustboxServerError) {
          if (attempt >= this.maxRetries) throw e;
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

    const res = await this.fetchWithRetry(`/api/submit?wait=${wait}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    return this.handle(res);
  }

  async getResult(id: string): Promise<SubmitResponse> {
    const res = await this.fetchWithRetry(`/api/result/${id}`, {
      headers: this.headers(),
    });
    return this.handle(res);
  }

  async getLanguages(): Promise<string[]> {
    const res = await this.fetchWithRetry(`/api/languages`, { headers: this.headers() });
    return this.handle(res);
  }

  async getHealth(): Promise<any> {
    const res = await this.fetchWithRetry(`/api/health`, { headers: this.headers() });
    return this.handle(res);
  }

  async getReady(): Promise<any> {
    const res = await this.fetchWithRetry(`/api/health/ready`, { headers: this.headers() });
    return this.handle(res);
  }

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
