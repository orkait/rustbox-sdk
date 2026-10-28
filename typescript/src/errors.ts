import { ABSENT, HTTP_TOO_MANY_REQUESTS } from "./constants";

export class RustboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class RustboxConfigError extends RustboxError {}

export class RustboxAuthError extends RustboxError {
  constructor(readonly status: number) {
    super(`API key rejected (HTTP ${status})`);
  }
}

export class RustboxRateLimitError extends RustboxError {
  readonly status = HTTP_TOO_MANY_REQUESTS;

  constructor(readonly retryAfterSecs: number | typeof ABSENT) {
    super(`rate limited (retry after ${retryAfterSecs}s)`);
  }
}

export class RustboxServerError extends RustboxError {
  constructor(readonly status: number) {
    super(`server error (HTTP ${status})`);
  }
}

export class RustboxApiError extends RustboxError {
  constructor(readonly status: number, readonly detail: string) {
    super(`HTTP ${status}: ${detail}`);
  }
}

export class RustboxTimeoutError extends RustboxError {}

export class RustboxStillRunningError extends RustboxError {
  constructor(readonly runId: string) {
    super(`run ${runId} is still running after the polling budget; call getResult later`);
  }
}

export class RustboxTransportError extends RustboxError {}

export class RustboxDecodeError extends RustboxError {}

export function isTransient(error: unknown): boolean {
  return (
    error instanceof RustboxServerError || error instanceof RustboxTimeoutError || error instanceof RustboxTransportError
  );
}
