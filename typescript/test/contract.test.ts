import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  BACKOFF_BASE_MS,
  BACKOFF_CAP_MS,
  DEFAULT_OPTIONS,
  DEFAULT_REGION,
  ENV_BASE_URL,
  ENV_REGION,
  FAILOVER_PENALTY_SECS,
  loadConfig,
  MAX_RETRIES,
  pinnedBaseUrl,
  POLL_CAP_MS,
  POLL_FIRST_DELAY_MS,
  POLL_GROWTH,
  POLL_MAX,
  PROBE_TIMEOUT_MS,
  REGION_CACHE_TTL_SECS,
  REGIONS,
  regionUrl,
  TIMEOUT_SECS,
  type Env,
  type Regions,
} from "../src/config";
import {
  ABSENT,
  HEADER_API_KEY,
  HEADER_IDEMPOTENCY_KEY,
  HEADER_RETRY_AFTER,
  HEADER_USER_AGENT,
  PATH_HEALTH,
  PATH_JUDGE,
  PATH_LANGUAGES,
  PATH_READY,
  PATH_RESULT,
  PATH_SUBMIT,
  UNKNOWN,
  USER_AGENT,
  VERSION,
} from "../src/constants";
import {
  RustboxApiError,
  RustboxAuthError,
  RustboxConfigError,
  RustboxDecodeError,
  RustboxError,
  RustboxRateLimitError,
  RustboxServerError,
  RustboxStillRunningError,
  RustboxTimeoutError,
  RustboxTransportError,
} from "../src/errors";
import { HEALTH_STATUSES, STATUSES, TERMINAL_STATUSES, VERDICTS, type JudgeCase } from "../src/models";
import { Rustbox } from "../src/client";
import { RegionSelector } from "../src/regions";
import type { Fetch } from "../src/transport";

type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };
type Projection = Readonly<Record<string, Json>>;
type ExpectedRequest = {
  method: string;
  path: string;
  query?: Record<string, string>;
  body?: Json;
  idempotency_key?: string;
};
type CannedResponse = { status: number; headers?: Record<string, string>; body: Json };
type Exchange = { times?: number; request: ExpectedRequest; response: CannedResponse };
type Call = {
  op: string;
  language?: string;
  code?: string;
  stdin?: string;
  id?: string;
  idempotency_key?: string;
  cases?: JudgeCase[];
};
type Scenario = { name: string; call: Call; exchanges: Exchange[]; expect: Projection };
type RegionSpec = { health: { status: number; delay_ms: number }; languages: { status: number; body: Json } };
type Counts = { health: number; languages: number };
type RegionCase = {
  name: string;
  pin: string | null;
  regions: Record<string, RegionSpec>;
  expect: Projection[];
  calls: Record<string, Counts>;
};
type ConfigCase = {
  name: string;
  api_key: string;
  max_retries?: number;
  timeout_secs?: number;
  regions?: Regions;
  expect_error?: string;
};
type ResolutionCase = {
  name: string;
  base_url?: string;
  env_base_url?: string;
  region?: string;
  env_region?: string;
  expect?: string;
  expect_error?: string;
};
type Contract = Record<string, Json> & {
  version: string;
  user_agent: string;
  operations: string[];
  config_cases: ConfigCase[];
  resolution: ResolutionCase[];
  region_cases: RegionCase[];
};

const CONTRACT_DIR = join(import.meta.dir, "..", "..", "contract");
const contract: Contract = JSON.parse(readFileSync(join(CONTRACT_DIR, "contract.json"), "utf8"));
const scenarios: Scenario[] = JSON.parse(readFileSync(join(CONTRACT_DIR, "scenarios.json"), "utf8")).scenarios;
const packageJson: { version: string } = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8"));
const LANG = "ts";
const API_KEY = "rb_contract_test";
const BASE_URL = "https://sdk.test";
const SCENARIO_TIMEOUT_MS = 60_000;
const NO_ENV: Env = () => ABSENT;

const ERROR_KINDS: ReadonlyArray<readonly [new (...args: never[]) => RustboxError, string]> = [
  [RustboxConfigError, "config"],
  [RustboxAuthError, "auth"],
  [RustboxRateLimitError, "rate_limit"],
  [RustboxServerError, "server"],
  [RustboxTimeoutError, "timeout"],
  [RustboxStillRunningError, "still_running"],
  [RustboxApiError, "api"],
  [RustboxTransportError, "transport"],
  [RustboxDecodeError, "decode"],
];

const BINDINGS: Readonly<Record<string, Json>> = {
  version: VERSION,
  regions: REGIONS,
  default_region: DEFAULT_REGION,
  region_selection: {
    probe_path: PATH_HEALTH,
    probe_timeout_ms: PROBE_TIMEOUT_MS,
    cache_ttl_secs: REGION_CACHE_TTL_SECS,
    failover_penalty_secs: FAILOVER_PENALTY_SECS,
  },
  env: { base_url: ENV_BASE_URL, region: ENV_REGION },
  headers: {
    api_key: HEADER_API_KEY,
    user_agent: HEADER_USER_AGENT,
    idempotency_key: HEADER_IDEMPOTENCY_KEY,
    retry_after: HEADER_RETRY_AFTER,
  },
  timeout_secs: TIMEOUT_SECS,
  retry: { max_retries: MAX_RETRIES, backoff_base_ms: BACKOFF_BASE_MS, backoff_cap_ms: BACKOFF_CAP_MS },
  poll: { max_polls: POLL_MAX, first_delay_ms: POLL_FIRST_DELAY_MS, growth: POLL_GROWTH, cap_ms: POLL_CAP_MS },
  paths: {
    submit: PATH_SUBMIT,
    result: PATH_RESULT,
    judge: PATH_JUDGE,
    languages: PATH_LANGUAGES,
    health: PATH_HEALTH,
    ready: PATH_READY,
  },
  verdicts: [...VERDICTS],
  statuses: [...STATUSES],
  terminal_statuses: [...TERMINAL_STATUSES],
  health_statuses: [...HEALTH_STATUSES],
  unknown: UNKNOWN,
  errors: ERROR_KINDS.map(([, kind]) => kind),
};

function arg(call: Call, value: string | undefined): string {
  if (value === undefined) throw new Error(`scenario call ${call.op} is missing an argument`);
  return value;
}

const OPS: Readonly<Record<string, (client: Rustbox, call: Call) => Promise<Json>>> = {
  submit: async (client, call) => {
    const accepted = await client.submit(
      arg(call, call.language),
      arg(call, call.code),
      arg(call, call.stdin),
      call.idempotency_key ?? ABSENT,
    );
    return { accepted: { id: accepted.id, status: accepted.status } };
  },
  run: async (client, call) => observeExecution(await client.run(arg(call, call.language), arg(call, call.code), arg(call, call.stdin))),
  get_result: async (client, call) => observeExecution(await client.getResult(arg(call, call.id))),
  judge: async (client, call) => {
    const judged = await client.judge(arg(call, call.language), arg(call, call.code), call.cases ?? []);
    return {
      judge: {
        all_passed: judged.allPassed,
        verdicts: judged.results.map((r) => r.verdict),
        passed: judged.results.map((r) => r.passed),
      },
    };
  },
  languages: async (client) => ({ languages: await client.getLanguages() }),
  health: async (client) => ({ health: await client.getHealth() }),
  ready: async (client) => ({ health: await client.getReady() }),
};

function observeExecution(execution: Awaited<ReturnType<Rustbox["run"]>>): Json {
  return {
    result: {
      id: execution.id,
      status: execution.status,
      verdict: execution.result.verdict,
      stdout: execution.output.stdout,
      exit_code: execution.result.exitCode,
    },
  };
}

function observeError(error: RustboxError, wanted: Json): Json {
  const kind = ERROR_KINDS.find(([type]) => error instanceof type)?.[1] ?? "unclassified";
  const seen: Record<string, Json> = {
    kind,
    status: "status" in error && typeof error.status === "number" ? error.status : null,
    retry_after_secs: error instanceof RustboxRateLimitError ? error.retryAfterSecs : null,
    message: error instanceof RustboxApiError ? error.detail : null,
    run_id: error instanceof RustboxStillRunningError ? error.runId : null,
  };
  const keys = typeof wanted === "object" && wanted !== null && !Array.isArray(wanted) ? Object.keys(wanted) : [];
  return { error: Object.fromEntries(keys.map((key) => [key, seen[key] ?? null])) };
}

async function outcome(client: Rustbox, call: Call, wanted: Projection): Promise<Json> {
  const op = OPS[call.op];
  if (op === undefined) throw new Error(`no SDK operation for ${call.op}`);
  try {
    return await op(client, call);
  } catch (error) {
    if (!(error instanceof RustboxError) || wanted["error"] === undefined) throw error;
    return observeError(error, wanted["error"]);
  }
}

type Recorded = { url: URL; init: RequestInit };

function replay(exchanges: readonly Exchange[]): { fetchFn: Fetch; seen: Recorded[] } {
  const seen: Recorded[] = [];
  const fetchFn: Fetch = async (url, init) => {
    seen.push({ url: new URL(url), init });
    const exchange = exchanges[seen.length - 1];
    if (exchange === undefined) throw new Error(`extra request ${init.method} ${url}`);
    const { status, headers, body } = exchange.response;
    return new Response(JSON.stringify(body), { status, headers: headers ?? {} });
  };
  return { fetchFn, seen };
}

function checkRequest(recorded: Recorded, expected: ExpectedRequest, previousKey: string | null): string | null {
  const headers = new Headers(recorded.init.headers);
  expect(recorded.init.method).toBe(expected.method);
  expect(recorded.url.pathname).toBe(expected.path);
  expect(Object.fromEntries(recorded.url.searchParams)).toEqual(expected.query ?? {});
  expect(headers.get(HEADER_API_KEY)).toBe(API_KEY);
  expect(headers.get(HEADER_USER_AGENT)).toBe(USER_AGENT);
  const body = recorded.init.body;
  if (expected.body === undefined) {
    expect(body ?? null).toBeNull();
  } else {
    expect(typeof body === "string" ? JSON.parse(body) : body).toEqual(expected.body);
  }
  const key = headers.get(HEADER_IDEMPOTENCY_KEY);
  const rule = expected.idempotency_key ?? "absent";
  if (rule === "absent") expect(key).toBeNull();
  else if (rule === "uuid") expect(key ?? "").toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  else if (rule === "repeat") expect(key).toBe(previousKey);
  else expect(key).toBe(rule);
  return key;
}

describe("contract bindings", () => {
  test.each(Object.keys(BINDINGS))("%s matches the contract", (key) => {
    expect(BINDINGS[key]).toEqual(contract[key] ?? null);
  });

  test("version and user agent match the package", () => {
    expect(packageJson.version).toBe(VERSION);
    expect(USER_AGENT).toBe(contract.user_agent.replace("{lang}", LANG).replace("{version}", VERSION));
  });

  test("every contract operation is implemented and exercised", () => {
    expect(Object.keys(OPS).sort()).toEqual([...contract.operations].sort());
    expect([...new Set(scenarios.map((s) => s.call.op))].sort()).toEqual([...contract.operations].sort());
  });
});

describe("client config", () => {
  test.each(contract.config_cases)("$name", (c) => {
    const load = () =>
      loadConfig(
        c.api_key,
        {
          ...DEFAULT_OPTIONS,
          regions: c.regions ?? REGIONS,
          timeoutSecs: c.timeout_secs ?? TIMEOUT_SECS,
          maxRetries: c.max_retries ?? MAX_RETRIES,
        },
        NO_ENV,
      );
    if (c.expect_error === undefined) expect(load).not.toThrow();
    else expect(load).toThrow(RustboxConfigError);
  });
});

describe("base url resolution", () => {
  test.each(contract.resolution)("$name", (c) => {
    const values: Readonly<Record<string, string>> = { [ENV_BASE_URL]: c.env_base_url ?? "", [ENV_REGION]: c.env_region ?? "" };
    const env: Env = (key) => values[key] || ABSENT;
    const resolve = () =>
      pinnedBaseUrl(c.base_url ?? ABSENT, c.region ?? ABSENT, env, REGIONS) ?? regionUrl(REGIONS, DEFAULT_REGION);
    if (c.expect_error === undefined) expect(resolve()).toBe(c.expect ?? null);
    else expect(resolve).toThrow(RustboxConfigError);
  });
});

describe("scenarios", () => {
  test.each(scenarios)("$name", async (scenario) => {
    const exchanges = scenario.exchanges.flatMap((exchange) => Array<Exchange>(exchange.times ?? 1).fill(exchange));
    const { fetchFn, seen } = replay(exchanges);
    const client = new Rustbox(API_KEY, { ...DEFAULT_OPTIONS, baseUrl: BASE_URL }, { fetch: fetchFn, env: NO_ENV });
    expect(await outcome(client, scenario.call, scenario.expect)).toEqual(scenario.expect);
    expect(seen.length).toBe(exchanges.length);
    let key: string | null = null;
    seen.forEach((recorded, index) => {
      const exchange = exchanges[index];
      if (exchange !== undefined) key = checkRequest(recorded, exchange.request, key);
    });
  }, SCENARIO_TIMEOUT_MS);
});

describe("region selection", () => {
  test.each(contract.region_cases)("$name", async (c) => {
    const run = crypto.randomUUID();
    const names = Object.keys(c.regions);
    const regions = Object.fromEntries(names.map((name) => [name, `https://${name}.${run}.test`]));
    const calls: Record<string, Counts> = Object.fromEntries(names.map((name) => [name, { health: 0, languages: 0 }]));
    const fetchFn: Fetch = async (url) => {
      const target = new URL(url);
      const name = names.find((candidate) => target.host === `${candidate}.${run}.test`);
      const spec = name === undefined ? undefined : c.regions[name];
      const counts = name === undefined ? undefined : calls[name];
      if (spec === undefined || counts === undefined) throw new Error(`unexpected host ${target.host}`);
      if (target.pathname === PATH_HEALTH) {
        counts.health += 1;
        await new Promise((resolve) => setTimeout(resolve, spec.health.delay_ms));
        return new Response(JSON.stringify({ status: "ok" }), { status: spec.health.status });
      }
      counts.languages += 1;
      return new Response(JSON.stringify(spec.languages.body), { status: spec.languages.status });
    };
    for (const wanted of c.expect) {
      const client = new Rustbox(
        API_KEY,
        { ...DEFAULT_OPTIONS, region: c.pin, regions },
        { fetch: fetchFn, env: NO_ENV },
      );
      expect(await outcome(client, { op: "languages" }, wanted)).toEqual(wanted);
    }
    expect(calls).toEqual(c.calls);
  });

  test("an expired pick is probed again", async () => {
    const run = crypto.randomUUID();
    const regions = Object.fromEntries(["a", "b"].map((name) => [name, `https://${name}.${run}.test`]));
    const policy = loadConfig(API_KEY, { ...DEFAULT_OPTIONS, regions }, NO_ENV).region;
    const probed: string[] = [];
    const selector = new RegionSelector({ ...policy, cacheTtlSecs: 0 }, ABSENT, async (base) => {
      probed.push(base);
      return 0;
    });
    for (let call = 0; call < 2; call += 1) await selector.current();
    expect(probed.sort()).toEqual([...Object.values(regions), ...Object.values(regions)].sort());
  });
});
