import { describe, it, expect, vi, beforeEach } from "vitest";
import { Rustbox } from "../src/index";

const DEFAULT_BASE = "https://rustbox-api.orkait.com";
const CUSTOM_BASE = "https://custom.example.com";

describe("Rustbox", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("constructor_should_default_base_url_to_production", () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "1", verdict: "AC" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const rb = new Rustbox("k");
    return rb.submit({ language: "python", code: "print(1)" }).then(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `${DEFAULT_BASE}/api/submit?wait=false`,
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  it("constructor_should_require_api_key", () => {
    expect(() => new Rustbox("")).toThrow();
  });

  it("constructor_should_use_override_base_url_when_provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "1", verdict: "AC" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const rb = new Rustbox("k", { baseUrl: CUSTOM_BASE });
    await rb.submit({ language: "python", code: "print(1)" });
    expect(fetchMock).toHaveBeenCalledWith(
      `${CUSTOM_BASE}/api/submit?wait=false`,
      expect.objectContaining({ method: "POST" })
    );
  });

  it("run_should_poll_when_initial_returns_408", async () => {
    let call = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      call++;
      if (call === 1) {
        return new Response(JSON.stringify({ id: "1" }), { status: 408 });
      }
      return new Response(JSON.stringify({ id: "1", verdict: "TLE" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const rb = new Rustbox("k");
    const res = await rb.run({ language: "python", code: "while True: pass" });
    expect(res.verdict).toBe("TLE");
    expect(call).toBe(2);
  });
});
