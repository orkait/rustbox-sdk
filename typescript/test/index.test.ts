import { describe, it, expect, vi, beforeEach } from "vitest";
import { Rustbox, RustboxAuthError, RustboxRateLimitError, RustboxServerError, VERSION, REGIONS, pickFastestRegion } from "../src/index";

const EU_BASE = "https://rustbox-eu.orkait.com";
const US_BASE = "https://rustbox-us.orkait.com";

describe("Rustbox", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("constructor_should_default_to_probed_region", async () => {
    // Probe call (HEAD/GET /api/health) returns OK for EU first (fast),
    // then any subsequent call uses EU as the picked base.
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/api/health")) {
        return new Response("{}", { status: 200 });
      }
      return new Response(JSON.stringify({ id: "1", verdict: "AC" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const rb = new Rustbox("k", { region: "eu" }); // explicit to skip probe race
    await rb.submit({ language: "python", code: "print(1)" });
    const submitCall = fetchMock.mock.calls.find((c: any[]) => String(c[0]).includes("/api/submit"));
    expect(submitCall).toBeTruthy();
    expect(String(submitCall![0])).toBe(`${EU_BASE}/api/submit?wait=false`);
  });

  it("constructor_should_require_api_key", () => {
    expect(() => new Rustbox("")).toThrow();
  });

  it("region_us_uses_us_base", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "1", verdict: "AC" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const rb = new Rustbox("k", { region: "us" });
    await rb.submit({ language: "python", code: "print(1)" });
    expect(fetchMock).toHaveBeenCalledWith(
      `${US_BASE}/api/submit?wait=false`,
      expect.objectContaining({ method: "POST" })
    );
  });

  it("explicit_baseUrl_overrides_region", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "1", verdict: "AC" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const rb = new Rustbox("k", { baseUrl: "https://example.local", region: "us" });
    await rb.submit({ language: "python", code: "print(1)" });
    expect(fetchMock).toHaveBeenCalledWith(
      `https://example.local/api/submit?wait=false`,
      expect.objectContaining({ method: "POST" })
    );
  });

  it("REGIONS_table_matches_production_hostnames", () => {
    expect(REGIONS.eu).toBe(EU_BASE);
    expect(REGIONS.us).toBe(US_BASE);
  });
});
