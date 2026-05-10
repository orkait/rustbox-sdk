import { describe, it, expect, vi, beforeEach } from "vitest";
import { Rustbox, RustboxAuthError, RustboxRateLimitError, RustboxServerError, VERSION } from "../src/index";

const DEFAULT_BASE = "https://rustbox-api.orkait.com";

describe("Rustbox", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("constructor_should_default_base_url_to_production", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "1", verdict: "AC" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const rb = new Rustbox("k");
    await rb.submit({ language: "python", code: "print(1)" });
    expect(fetchMock).toHaveBeenCalledWith(
      `${DEFAULT_BASE}/api/submit?wait=false`,
      expect.objectContaining({ method: "POST" })
    );
  });

  it("constructor_should_require_api_key", () => {
    expect(() => new Rustbox("")).toThrow();
  });

  it("submit_should_send_user_agent_header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "1", verdict: "AC" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const rb = new Rustbox("k");
    await rb.submit({ language: "python", code: "print(1)" });
    const call = fetchMock.mock.calls[0][1];
    expect(call.headers["User-Agent"]).toBe(`rustbox-sdk-ts/${VERSION}`);
  });

  it("submit_should_include_profile_when_set", async () => {
    let captured: any;
    const fetchMock = vi.fn().mockImplementation((_url: string, init: any) => {
      captured = JSON.parse(init.body);
      return Promise.resolve(new Response(JSON.stringify({ id: "1", verdict: "AC" }), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    await new Rustbox("k").submit({ language: "python", code: "print(1)", profile: "agent" });
    expect(captured.profile).toBe("agent");
  });

  it("submit_should_send_idempotency_key_header_when_provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "1", verdict: "AC" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const rb = new Rustbox("k");
    await rb.submit({ language: "python", code: "print(1)" }, false, { idempotencyKey: "test-key-123" });
    const call = fetchMock.mock.calls[0][1];
    expect(call.headers["Idempotency-Key"]).toBe("test-key-123");
  });

  it("run_should_auto_generate_idempotency_key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "1", verdict: "AC" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    await new Rustbox("k").run({ language: "python", code: "print(1)" });
    const call = fetchMock.mock.calls[0][1];
    expect(call.headers["Idempotency-Key"]).toBeDefined();
    expect(call.headers["Idempotency-Key"].length).toBeGreaterThan(8);
  });

  it("submit_should_retry_on_503_then_succeed", async () => {
    let n = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      n++;
      if (n < 2) return Promise.resolve(new Response("upstream", { status: 503 }));
      return Promise.resolve(new Response(JSON.stringify({ id: "1", verdict: "AC" }), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await new Rustbox("k").submit({ language: "python", code: "print(1)" });
    expect(res.verdict).toBe("AC");
    expect(n).toBe(2);
  });

  it("submit_should_NOT_retry_on_401", async () => {
    let n = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      n++;
      return Promise.resolve(new Response("nope", { status: 401 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(new Rustbox("k").submit({ language: "python", code: "print(1)" }))
      .rejects.toBeInstanceOf(RustboxAuthError);
    expect(n).toBe(1);
  });

  it("submit_should_throw_RustboxRateLimitError_on_429", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("limit", { status: 429 })));
    await expect(new Rustbox("k").submit({ language: "python", code: "print(1)" }))
      .rejects.toBeInstanceOf(RustboxRateLimitError);
  });

  it("submit_should_throw_RustboxServerError_after_retries_exhausted", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("upstream", { status: 503 })));
    await expect(new Rustbox("k", { maxRetries: 1 }).submit({ language: "python", code: "print(1)" }))
      .rejects.toBeInstanceOf(RustboxServerError);
  });

  it("run_should_poll_when_initial_returns_408", async () => {
    let call = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      call++;
      if (call === 1) return new Response(JSON.stringify({ id: "1" }), { status: 408 });
      return new Response(JSON.stringify({ id: "1", verdict: "TLE" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await new Rustbox("k").run({ language: "python", code: "while True: pass" });
    expect(res.verdict).toBe("TLE");
    expect(call).toBe(2);
  });
});
