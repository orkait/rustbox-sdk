import { backoffMs, type RetryPolicy } from "./config";
import {
  ABSENT,
  CONTENT_TYPE_JSON,
  ERROR_FIELD,
  GET,
  HEADER_CONTENT_TYPE,
  HEADER_IDEMPOTENCY_KEY,
  HEADER_RETRY_AFTER,
  HTTP_FORBIDDEN,
  HTTP_SERVER_ERROR,
  HTTP_TOO_MANY_REQUESTS,
  HTTP_UNAUTHORIZED,
  POST,
  type Method,
} from "./constants";
import {
  RustboxApiError,
  RustboxAuthError,
  RustboxDecodeError,
  RustboxError,
  RustboxRateLimitError,
  RustboxServerError,
  RustboxTimeoutError,
  RustboxTransportError,
} from "./errors";
import type { RequestBody } from "./models";

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;
export type Query = Readonly<Record<string, string>>;

export type ApiRequest = {
  readonly method: Method;
  readonly path: string;
  readonly query: Query | typeof ABSENT;
  readonly body: RequestBody | typeof ABSENT;
  readonly idempotencyKey: string | typeof ABSENT;
};

const ABORT_ERROR = "AbortError";
const DIGITS = /^\d+$/;
const QUERY_PREFIX = "?";

export function get(path: string): ApiRequest {
  return { method: GET, path, query: ABSENT, body: ABSENT, idempotencyKey: ABSENT };
}

export function post(
  path: string,
  body: RequestBody,
  query: Query | typeof ABSENT = ABSENT,
  idempotencyKey: string | typeof ABSENT = ABSENT,
): ApiRequest {
  return { method: POST, path, query, body, idempotencyKey };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryable(request: ApiRequest): boolean {
  return request.method === GET || request.idempotencyKey !== ABSENT;
}

function target(base: string, request: ApiRequest): string {
  const query = request.query === ABSENT ? "" : `${QUERY_PREFIX}${new URLSearchParams(request.query)}`;
  return `${base}${request.path}${query}`;
}

type Attempt = Response | RustboxTimeoutError | RustboxTransportError;

export class Transport {
  constructor(
    private readonly fetchFn: Fetch,
    private readonly headers: Readonly<Record<string, string>>,
    private readonly timeoutMs: number,
    private readonly retry: RetryPolicy,
  ) {}

  async send(base: string, request: ApiRequest): Promise<Response> {
    const retries = retryable(request) ? this.retry.maxRetries : 0;
    for (let attempt = 0; ; attempt++) {
      const final = attempt >= retries;
      const outcome = await this.attempt(base, request);
      if (outcome instanceof Response) {
        if (outcome.status < HTTP_SERVER_ERROR) return outcome;
        if (final) throw new RustboxServerError(outcome.status);
      } else if (final) {
        throw outcome;
      }
      await sleep(backoffMs(this.retry, attempt));
    }
  }

  async probe(url: string, timeoutMs: number): Promise<number | typeof ABSENT> {
    const started = performance.now();
    try {
      const response = await this.fetchFn(url, { headers: this.headers, signal: AbortSignal.timeout(timeoutMs) });
      return response.ok ? performance.now() - started : ABSENT;
    } catch {
      return ABSENT;
    }
  }

  private headersFor(request: ApiRequest): Record<string, string> {
    const headers: Record<string, string> = { ...this.headers };
    if (request.body !== ABSENT) headers[HEADER_CONTENT_TYPE] = CONTENT_TYPE_JSON;
    if (request.idempotencyKey !== ABSENT) headers[HEADER_IDEMPOTENCY_KEY] = request.idempotencyKey;
    return headers;
  }

  private async attempt(base: string, request: ApiRequest): Promise<Attempt> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchFn(target(base, request), {
        method: request.method,
        headers: this.headersFor(request),
        body: request.body === ABSENT ? ABSENT : JSON.stringify(request.body),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === ABORT_ERROR) {
        return new RustboxTimeoutError(`request timed out after ${this.timeoutMs}ms`);
      }
      if (error instanceof TypeError) return new RustboxTransportError(error.message);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function retryAfterSecs(response: Response): number | typeof ABSENT {
  const raw = response.headers.get(HEADER_RETRY_AFTER) ?? "";
  return DIGITS.test(raw) ? Number(raw) : ABSENT;
}

function parsed(raw: string): unknown {
  try {
    const body: unknown = JSON.parse(raw);
    return body;
  } catch {
    return ABSENT;
  }
}

function message(raw: string): string {
  const body = parsed(raw);
  if (typeof body !== "object" || body === ABSENT || !(ERROR_FIELD in body)) return raw;
  const detail: unknown = body[ERROR_FIELD];
  return typeof detail === "string" ? detail : raw;
}

async function errorFor(response: Response): Promise<RustboxError> {
  if (response.status === HTTP_UNAUTHORIZED || response.status === HTTP_FORBIDDEN) {
    return new RustboxAuthError(response.status);
  }
  if (response.status === HTTP_TOO_MANY_REQUESTS) return new RustboxRateLimitError(retryAfterSecs(response));
  return new RustboxApiError(response.status, message(await response.text()));
}

export async function jsonBody(response: Response): Promise<unknown> {
  const raw = await response.text();
  try {
    const body: unknown = JSON.parse(raw);
    return body;
  } catch (error) {
    throw new RustboxDecodeError(`response is not JSON: ${String(error)}`);
  }
}

export async function expect(response: Response, ...statuses: readonly number[]): Promise<unknown> {
  if (!statuses.includes(response.status)) throw await errorFor(response);
  return jsonBody(response);
}
