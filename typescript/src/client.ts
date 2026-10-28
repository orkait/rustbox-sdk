import {
  DEFAULT_OPTIONS,
  loadConfig,
  pollDelaysMs,
  processEnv,
  type ClientConfig,
  type Env,
  type RustboxOptions,
} from "./config";
import {
  ABSENT,
  HEADER_API_KEY,
  HEADER_USER_AGENT,
  HTTP_ACCEPTED,
  HTTP_OK,
  HTTP_REQUEST_TIMEOUT,
  PATH_HEALTH,
  PATH_ID,
  PATH_JUDGE,
  PATH_LANGUAGES,
  PATH_READY,
  PATH_RESULT,
  PATH_SUBMIT,
  QUERY_WAIT,
  USER_AGENT,
  UUID_PATTERN,
  WAIT_FALSE,
  WAIT_TRUE,
} from "./constants";
import { isTransient, RustboxConfigError, RustboxStillRunningError } from "./errors";
import {
  judgeBody,
  parseAccepted,
  parseExecution,
  parseHealth,
  parseJudgeResult,
  parseLanguages,
  parsePendingId,
  type Accepted,
  type Execution,
  type HealthStatus,
  type JudgeCase,
  type JudgeResult,
} from "./models";
import { RegionSelector } from "./regions";
import { expect, get, jsonBody, post, sleep, Transport, type ApiRequest, type Fetch } from "./transport";

const WAIT_FOR_RESULT = Object.freeze({ [QUERY_WAIT]: WAIT_TRUE });
const QUEUE_ONLY = Object.freeze({ [QUERY_WAIT]: WAIT_FALSE });

export type Runtime = {
  readonly fetch: Fetch;
  readonly env: Env;
};

function defaultRuntime(): Runtime {
  return { fetch: (url, init) => fetch(url, init), env: processEnv() };
}

function resultPath(runId: string): string {
  return PATH_RESULT.replace(PATH_ID, encodeURIComponent(runId));
}

export class Rustbox {
  private readonly config: ClientConfig;
  private readonly transport: Transport;
  private readonly regions: RegionSelector;

  constructor(apiKey: string, options: RustboxOptions = DEFAULT_OPTIONS, runtime: Runtime = defaultRuntime()) {
    this.config = loadConfig(apiKey, options, runtime.env);
    this.transport = new Transport(
      runtime.fetch,
      { [HEADER_API_KEY]: this.config.apiKey, [HEADER_USER_AGENT]: USER_AGENT },
      this.config.timeoutMs,
      this.config.retry,
    );
    this.regions = new RegionSelector(this.config.region, this.config.pinnedBaseUrl, (base) =>
      this.transport.probe(`${base}${PATH_HEALTH}`, this.config.region.probeTimeoutMs),
    );
  }

  baseUrl(): Promise<string> {
    return this.regions.current();
  }

  async submit(
    language: string,
    code: string,
    stdin = "",
    idempotencyKey: string | typeof ABSENT = ABSENT,
  ): Promise<Accepted> {
    if (idempotencyKey !== ABSENT && !UUID_PATTERN.test(idempotencyKey)) {
      throw new RustboxConfigError(`idempotencyKey must be a UUID, got ${JSON.stringify(idempotencyKey)}`);
    }
    const response = await this.call(post(PATH_SUBMIT, { language, code, stdin }, QUEUE_ONLY, idempotencyKey));
    return parseAccepted(await expect(response, HTTP_ACCEPTED));
  }

  async run(language: string, code: string, stdin = ""): Promise<Execution> {
    const base = await this.regions.current();
    const response = await this.send(
      base,
      post(PATH_SUBMIT, { language, code, stdin }, WAIT_FOR_RESULT, crypto.randomUUID()),
    );
    if (response.status === HTTP_OK) return parseExecution(await jsonBody(response));
    const pending = await expect(response, HTTP_ACCEPTED, HTTP_REQUEST_TIMEOUT);
    return this.poll(base, parsePendingId(pending));
  }

  async getResult(runId: string): Promise<Execution> {
    return this.fetchResult(await this.regions.current(), runId);
  }

  async judge(language: string, code: string, cases: readonly JudgeCase[]): Promise<JudgeResult> {
    const response = await this.call(post(PATH_JUDGE, judgeBody(language, code, cases)));
    return parseJudgeResult(await expect(response, HTTP_OK));
  }

  async getLanguages(): Promise<string[]> {
    return parseLanguages(await expect(await this.call(get(PATH_LANGUAGES)), HTTP_OK));
  }

  async getHealth(): Promise<HealthStatus> {
    return parseHealth(await expect(await this.call(get(PATH_HEALTH)), HTTP_OK));
  }

  async getReady(): Promise<HealthStatus> {
    return parseHealth(await expect(await this.call(get(PATH_READY)), HTTP_OK));
  }

  private async poll(base: string, runId: string): Promise<Execution> {
    for (const delayMs of pollDelaysMs(this.config.poll)) {
      await sleep(delayMs);
      const execution = await this.fetchResult(base, runId);
      if (execution.done) return execution;
    }
    throw new RustboxStillRunningError(runId);
  }

  private async fetchResult(base: string, runId: string): Promise<Execution> {
    return parseExecution(await expect(await this.send(base, get(resultPath(runId))), HTTP_OK));
  }

  private async call(request: ApiRequest): Promise<Response> {
    return this.send(await this.regions.current(), request);
  }

  private async send(base: string, request: ApiRequest): Promise<Response> {
    try {
      return await this.transport.send(base, request);
    } catch (error) {
      if (isTransient(error)) this.regions.reportFailure(base);
      throw error;
    }
  }
}
