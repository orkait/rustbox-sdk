import { describe, it, expect, vi, beforeEach } from "vitest";
import { Rustbox, REGIONS } from "../src/index";

const EU_BASE = "https://rustbox-eu.orkait.com";

describe("Rustbox", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("constructor_should_default_to_probed_region", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/api/health")) {
        return new Response("{}", { status: 200 });
      }
      return new Response(JSON.stringify({ id: "1", verdict: "AC" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const rb = new Rustbox("k", { region: "eu" });
    await rb.submit({ language: "python", code: "print(1)" });
    const submitCall = fetchMock.mock.calls.find((c: any[]) => String(c[0]).includes("/api/submit"));
    expect(submitCall).toBeTruthy();
    expect(String(submitCall![0])).toBe(`${EU_BASE}/api/submit?wait=false`);
  });

  it("constructor_should_require_api_key", () => {
    expect(() => new Rustbox("")).toThrow();
  });

  it("explicit_baseUrl_overrides_region", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "1", verdict: "AC" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const rb = new Rustbox("k", { baseUrl: "https://example.local", region: "eu" });
    await rb.submit({ language: "python", code: "print(1)" });
    expect(fetchMock).toHaveBeenCalledWith(
      `https://example.local/api/submit?wait=false`,
      expect.objectContaining({ method: "POST" })
    );
  });

  it("REGIONS_table_matches_production_hostnames", () => {
    expect(REGIONS.eu).toBe(EU_BASE);
  });
});
