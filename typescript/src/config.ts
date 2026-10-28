import { ABSENT, MS_PER_SEC } from "./constants";
import { RustboxConfigError } from "./errors";

export const ENV_BASE_URL = "RUSTBOX_BASE_URL";
export const ENV_REGION = "RUSTBOX_REGION";
const URL_SCHEMES = ["http://", "https://"] as const;
const TRAILING_SLASHES = /\/+$/;
const API_KEY_PATTERN = /^[\x21-\x7e]+$/;

export type Regions = Readonly<Record<string, string>>;
export type Env = (key: string) => string | typeof ABSENT;
export type NonEmpty<T> = readonly [T, ...T[]];

export function isNonEmpty<T>(items: readonly T[]): items is NonEmpty<T> {
  return items.length > 0;
}

export const REGIONS: Regions = Object.freeze({ in: "https://api.rustbox.sh" });
export const DEFAULT_REGION = "in";
export const PROBE_TIMEOUT_MS = 1500;
export const REGION_CACHE_TTL_SECS = 21_600;
export const FAILOVER_PENALTY_SECS = 300;

export const TIMEOUT_SECS = 65;
export const MAX_RETRIES = 2;
export const BACKOFF_BASE_MS = 100;
export const BACKOFF_CAP_MS = 5000;

export const POLL_MAX = 45;
export const POLL_FIRST_DELAY_MS = 40;
export const POLL_GROWTH = 1.5;
export const POLL_CAP_MS = 600;

export type RustboxOptions = {
  readonly baseUrl: string | typeof ABSENT;
  readonly region: string | typeof ABSENT;
  readonly regions: Regions;
  readonly timeoutSecs: number;
  readonly maxRetries: number;
};

export const DEFAULT_OPTIONS: RustboxOptions = Object.freeze({
  baseUrl: ABSENT,
  region: ABSENT,
  regions: REGIONS,
  timeoutSecs: TIMEOUT_SECS,
  maxRetries: MAX_RETRIES,
});

export type RetryPolicy = {
  readonly maxRetries: number;
  readonly backoffBaseMs: number;
  readonly backoffCapMs: number;
};

export type PollPolicy = {
  readonly maxPolls: number;
  readonly firstDelayMs: number;
  readonly growth: number;
  readonly capMs: number;
};

export type RegionPolicy = {
  readonly regions: Regions;
  readonly bases: NonEmpty<string>;
  readonly defaultRegion: string;
  readonly probeTimeoutMs: number;
  readonly cacheTtlSecs: number;
  readonly failoverPenaltySecs: number;
};

export type ClientConfig = {
  readonly apiKey: string;
  readonly pinnedBaseUrl: string | typeof ABSENT;
  readonly timeoutMs: number;
  readonly retry: RetryPolicy;
  readonly poll: PollPolicy;
  readonly region: RegionPolicy;
};

export function backoffMs(policy: RetryPolicy, attempt: number): number {
  return Math.min(policy.backoffBaseMs * 2 ** attempt, policy.backoffCapMs);
}

export function* pollDelaysMs(policy: PollPolicy): Generator<number> {
  let delayMs = policy.firstDelayMs;
  for (let poll = 0; poll < policy.maxPolls; poll++) {
    yield delayMs;
    delayMs = Math.min(delayMs * policy.growth, policy.capMs);
  }
}

export function processEnv(): Env {
  return (key) => (typeof process === "undefined" ? ABSENT : process.env[key] || ABSENT);
}

export function regionUrl(regions: Regions, name: string): string | typeof ABSENT {
  return Object.hasOwn(regions, name) ? regions[name] ?? ABSENT : ABSENT;
}

function url(value: string, what: string): string {
  if (!URL_SCHEMES.some((scheme) => value.startsWith(scheme))) {
    throw new RustboxConfigError(`${what} must start with http:// or https://, got ${JSON.stringify(value)}`);
  }
  return value.replace(TRAILING_SLASHES, "");
}

function knownRegion(regions: Regions, name: string): string {
  const pinned = regionUrl(regions, name);
  if (pinned === ABSENT) {
    throw new RustboxConfigError(
      `unknown region ${JSON.stringify(name)}; known regions: ${Object.keys(regions).join(", ")}`,
    );
  }
  return pinned;
}

export function pinnedBaseUrl(
  baseUrl: string | typeof ABSENT,
  region: string | typeof ABSENT,
  env: Env,
  regions: Regions,
): string | typeof ABSENT {
  if (baseUrl !== ABSENT) return url(baseUrl, "baseUrl");
  const envBaseUrl = env(ENV_BASE_URL);
  if (envBaseUrl !== ABSENT) return url(envBaseUrl, ENV_BASE_URL);
  if (region !== ABSENT) return knownRegion(regions, region);
  const envRegion = env(ENV_REGION);
  return envRegion === ABSENT ? ABSENT : knownRegion(regions, envRegion);
}

export function loadConfig(apiKey: string, options: RustboxOptions, env: Env): ClientConfig {
  if (!API_KEY_PATTERN.test(apiKey)) {
    throw new RustboxConfigError("apiKey is required and must be visible ASCII without spaces");
  }
  if (!Number.isInteger(options.maxRetries) || options.maxRetries < 0) {
    throw new RustboxConfigError(`maxRetries must be a non-negative integer, got ${options.maxRetries}`);
  }
  if (!(options.timeoutSecs > 0)) {
    throw new RustboxConfigError(`timeoutSecs must be positive, got ${options.timeoutSecs}`);
  }
  const regions: Regions = Object.freeze(
    Object.fromEntries(Object.entries(options.regions).map(([name, base]) => [name, url(base, `region ${name}`)])),
  );
  const bases = Object.values(regions);
  if (!isNonEmpty(bases)) throw new RustboxConfigError("regions must not be empty");
  return {
    apiKey,
    pinnedBaseUrl: pinnedBaseUrl(options.baseUrl, options.region, env, regions),
    timeoutMs: options.timeoutSecs * MS_PER_SEC,
    retry: { maxRetries: options.maxRetries, backoffBaseMs: BACKOFF_BASE_MS, backoffCapMs: BACKOFF_CAP_MS },
    poll: { maxPolls: POLL_MAX, firstDelayMs: POLL_FIRST_DELAY_MS, growth: POLL_GROWTH, capMs: POLL_CAP_MS },
    region: {
      regions,
      bases,
      defaultRegion: DEFAULT_REGION,
      probeTimeoutMs: PROBE_TIMEOUT_MS,
      cacheTtlSecs: REGION_CACHE_TTL_SECS,
      failoverPenaltySecs: FAILOVER_PENALTY_SECS,
    },
  };
}
