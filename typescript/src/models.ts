import { ABSENT, UNKNOWN } from "./constants";
import { RustboxDecodeError } from "./errors";

export const VERDICTS = ["AC", "WA", "RE", "TLE", "MLE", "OLE", "PLE", "FSE", "SIG", "SV", "ABUSE", "IE", "TIMEOUT"] as const;
export const STATUSES = ["pending", "running", "completed", "error"] as const;
export const TERMINAL_STATUSES = ["completed", "error"] as const;
export const HEALTH_STATUSES = ["ok", "ready", "not_ready"] as const;

export type Unknown = typeof UNKNOWN;
export type Verdict = (typeof VERDICTS)[number] | Unknown;
export type Status = (typeof STATUSES)[number] | Unknown;
export type HealthStatus = (typeof HEALTH_STATUSES)[number] | Unknown;

export type JsonObject = Readonly<Record<string, unknown>>;

export type Timestamps = {
  readonly createdAt: string;
  readonly startedAt: string | typeof ABSENT;
  readonly completedAt: string | typeof ABSENT;
};

export type Outcome = {
  readonly verdict: Verdict | typeof ABSENT;
  readonly exitCode: number | typeof ABSENT;
  readonly signal: number | typeof ABSENT;
  readonly errorMessage: string | typeof ABSENT;
};

export type Output = {
  readonly stdout: string | typeof ABSENT;
  readonly stderr: string | typeof ABSENT;
};

export type Metrics = {
  readonly cpuTimeSecs: number | typeof ABSENT;
  readonly wallTimeSecs: number | typeof ABSENT;
  readonly memoryPeakBytes: number | typeof ABSENT;
};

export type Execution = {
  readonly id: string;
  readonly language: string;
  readonly status: Status;
  readonly done: boolean;
  readonly timestamps: Timestamps;
  readonly result: Outcome;
  readonly output: Output;
  readonly metrics: Metrics;
  readonly evidence: JsonObject | typeof ABSENT;
};

export type Accepted = {
  readonly id: string;
  readonly status: Status;
};

export type JudgeCase = {
  readonly stdin: string;
  readonly expected: string;
};

export type RunBody = {
  readonly language: string;
  readonly code: string;
  readonly stdin: string;
};

export type JudgeBody = {
  readonly language: string;
  readonly code: string;
  readonly cases: readonly JudgeCase[];
};

export type RequestBody = RunBody | JudgeBody;

export function judgeBody(language: string, code: string, cases: readonly JudgeCase[]): JudgeBody {
  return { language, code, cases: cases.map(({ stdin, expected }) => ({ stdin, expected })) };
}

export type CaseResult = {
  readonly verdict: Verdict | typeof ABSENT;
  readonly passed: boolean;
  readonly stdout: string | typeof ABSENT;
  readonly stderr: string | typeof ABSENT;
  readonly expected: string;
  readonly exitCode: number | typeof ABSENT;
  readonly wallTimeSecs: number | typeof ABSENT;
};

export type JudgeResult = {
  readonly results: readonly CaseResult[];
  readonly allPassed: boolean;
};

function isMember<T extends string>(values: readonly T[], raw: string): raw is T {
  const known: readonly string[] = values;
  return known.includes(raw);
}

function member<T extends string>(values: readonly T[], raw: string): T | Unknown {
  return isMember(values, raw) ? raw : UNKNOWN;
}

const TERMINAL: readonly Status[] = TERMINAL_STATUSES;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== ABSENT && !Array.isArray(value);
}

function asObject(value: unknown, what: string): JsonObject {
  if (!isObject(value)) throw new RustboxDecodeError(`${what}: expected an object`);
  return value;
}

function field(obj: JsonObject, key: string, what: string): unknown {
  if (!Object.hasOwn(obj, key)) throw new RustboxDecodeError(`${what}: missing ${key}`);
  return obj[key];
}

function text(obj: JsonObject, key: string, what: string): string {
  const value = field(obj, key, what);
  if (typeof value !== "string") throw new RustboxDecodeError(`${what}.${key}: expected a string`);
  return value;
}

function optionalText(obj: JsonObject, key: string, what: string): string | typeof ABSENT {
  const value = field(obj, key, what);
  if (value === ABSENT || typeof value === "string") return value;
  throw new RustboxDecodeError(`${what}.${key}: expected a string or null`);
}

function optionalInteger(obj: JsonObject, key: string, what: string): number | typeof ABSENT {
  const value = field(obj, key, what);
  if (value === ABSENT) return ABSENT;
  if (typeof value === "number" && Number.isInteger(value)) return value;
  throw new RustboxDecodeError(`${what}.${key}: expected an integer or null`);
}

function optionalNumber(obj: JsonObject, key: string, what: string): number | typeof ABSENT {
  const value = field(obj, key, what);
  if (value === ABSENT || typeof value === "number") return value;
  throw new RustboxDecodeError(`${what}.${key}: expected a number or null`);
}

function flag(obj: JsonObject, key: string, what: string): boolean {
  const value = field(obj, key, what);
  if (typeof value !== "boolean") throw new RustboxDecodeError(`${what}.${key}: expected a boolean`);
  return value;
}

function optionalVerdict(obj: JsonObject, what: string): Verdict | typeof ABSENT {
  const raw = optionalText(obj, "verdict", what);
  return raw === ABSENT ? ABSENT : member(VERDICTS, raw);
}

function parseTimestamps(value: unknown): Timestamps {
  const obj = asObject(value, "timestamps");
  return {
    createdAt: text(obj, "created_at", "timestamps"),
    startedAt: optionalText(obj, "started_at", "timestamps"),
    completedAt: optionalText(obj, "completed_at", "timestamps"),
  };
}

function parseOutcome(value: unknown): Outcome {
  const obj = asObject(value, "result");
  return {
    verdict: optionalVerdict(obj, "result"),
    exitCode: optionalInteger(obj, "exit_code", "result"),
    signal: optionalInteger(obj, "signal", "result"),
    errorMessage: optionalText(obj, "error_message", "result"),
  };
}

function parseOutput(value: unknown): Output {
  const obj = asObject(value, "output");
  return { stdout: optionalText(obj, "stdout", "output"), stderr: optionalText(obj, "stderr", "output") };
}

function parseMetrics(value: unknown): Metrics {
  const obj = asObject(value, "metrics");
  return {
    cpuTimeSecs: optionalNumber(obj, "cpu_time_secs", "metrics"),
    wallTimeSecs: optionalNumber(obj, "wall_time_secs", "metrics"),
    memoryPeakBytes: optionalInteger(obj, "memory_peak_bytes", "metrics"),
  };
}

function parseEvidence(obj: JsonObject): JsonObject | typeof ABSENT {
  if (!Object.hasOwn(obj, "evidence")) return ABSENT;
  const evidence = obj["evidence"];
  return evidence === ABSENT ? ABSENT : asObject(evidence, "evidence");
}

export function parseExecution(value: unknown): Execution {
  const obj = asObject(value, "execution");
  const status = member(STATUSES, text(obj, "status", "execution"));
  const result = parseOutcome(field(obj, "result", "execution"));
  return {
    id: text(obj, "id", "execution"),
    language: text(obj, "language", "execution"),
    status,
    done: TERMINAL.includes(status) || result.verdict !== ABSENT,
    timestamps: parseTimestamps(field(obj, "timestamps", "execution")),
    result,
    output: parseOutput(field(obj, "output", "execution")),
    metrics: parseMetrics(field(obj, "metrics", "execution")),
    evidence: parseEvidence(obj),
  };
}

export function parseAccepted(value: unknown): Accepted {
  const obj = asObject(value, "accepted");
  return { id: text(obj, "id", "accepted"), status: member(STATUSES, text(obj, "status", "accepted")) };
}

function parseCaseResult(value: unknown): CaseResult {
  const obj = asObject(value, "case");
  return {
    verdict: optionalVerdict(obj, "case"),
    passed: flag(obj, "passed", "case"),
    stdout: optionalText(obj, "stdout", "case"),
    stderr: optionalText(obj, "stderr", "case"),
    expected: text(obj, "expected", "case"),
    exitCode: optionalInteger(obj, "exit_code", "case"),
    wallTimeSecs: optionalNumber(obj, "wall_time_secs", "case"),
  };
}

export function parseJudgeResult(value: unknown): JudgeResult {
  const obj = asObject(value, "judge");
  const cases: unknown = field(obj, "results", "judge");
  if (!Array.isArray(cases)) throw new RustboxDecodeError("judge.results: expected a list");
  return { results: cases.map(parseCaseResult), allPassed: flag(obj, "all_passed", "judge") };
}

export function parseLanguages(value: unknown): string[] {
  if (!Array.isArray(value)) throw new RustboxDecodeError("languages: expected a list of strings");
  const items: readonly unknown[] = value;
  if (!items.every((item): item is string => typeof item === "string")) {
    throw new RustboxDecodeError("languages: expected a list of strings");
  }
  return [...items];
}

export function parsePendingId(value: unknown): string {
  return text(asObject(value, "pending"), "id", "pending");
}

export function parseHealth(value: unknown): HealthStatus {
  return member(HEALTH_STATUSES, text(asObject(value, "health"), "status", "health"));
}
