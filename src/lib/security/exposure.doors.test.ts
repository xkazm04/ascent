// fetchOsvSeverity (private) grades one vuln for the exposure count. A vuln whose detail read fails —
// a non-ok OSV response or a thrown fetch — is counted HIGH by design: conservative, never silently
// dropped and never read as "low". The door sweep kept that and made each failure visible through
// reportDegradedRead (console.warn + telemetry naming the vuln). Reached through fetchSecurityExposure
// with the same fetchWithTimeout mock exposure.test.ts uses.

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/github/host", () => ({
  githubRawBase: () => "https://raw.example",
  ghHeaders: () => ({}),
  fetchWithTimeout: h.fetch,
}));
vi.mock("@/lib/api/respond", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/respond")>()),
  reportHandledError: vi.fn(),
}));

import { fetchSecurityExposure } from "./exposure";
import { reportHandledError } from "@/lib/api/respond";

const mockReport = vi.mocked(reportHandledError);

/** One npm dep with the given vulns; `detail` answers each `/v1/vulns/<id>` read. */
function osv(vulnIds: string[], detail: (id: string) => Promise<Response>) {
  h.fetch.mockImplementation(async (url: string) => {
    if (url.endsWith("package-lock.json")) return Response.json({ packages: { "node_modules/lodash": { version: "4.17.20" } } });
    if (url.endsWith("querybatch")) return Response.json({ results: [{ vulns: vulnIds.map((id) => ({ id })) }] });
    const id = decodeURIComponent(url.slice(url.lastIndexOf("/") + 1));
    return detail(id);
  });
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.fetch.mockReset();
  mockReport.mockReset();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => warn.mockRestore());

describe("fetchOsvSeverity door — a failed vuln detail read counts HIGH and reaches the door", () => {
  it("a non-ok OSV vuln response counts high and reports the HTTP status", async () => {
    osv(["GHSA-down"], async () => new Response("unavailable", { status: 503 }));

    const result = await fetchSecurityExposure("acme", "js", "main");

    expect(result).toEqual({ known: true, source: "osv", critical: 0, high: 1, medium: 0, low: 0, scanned: 1 });
    expect(mockReport).toHaveBeenCalledTimes(1);
    const [err, ctx] = mockReport.mock.calls[0]!;
    expect((err as Error).message).toContain("HTTP 503");
    expect(ctx).toEqual({ message: expect.stringContaining("OSV severity GHSA-down (counted high)") });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("OSV severity GHSA-down"), err);
  });

  it("a thrown vuln fetch counts high and reports the original error", async () => {
    const boom = new Error("socket hang up");
    osv(["GHSA-throw"], async () => {
      throw boom;
    });

    const result = await fetchSecurityExposure("acme", "js", "main");

    expect(result).toMatchObject({ known: true, high: 1, critical: 0, medium: 0, low: 0 });
    expect(mockReport).toHaveBeenCalledTimes(1);
    expect(mockReport).toHaveBeenCalledWith(boom, {
      message: expect.stringContaining("OSV severity GHSA-throw (counted high)"),
    });
  });

  it("only the failed vuln opens a door — a sibling with a readable label is graded normally", async () => {
    osv(["GHSA-ok", "GHSA-bad"], async (id) =>
      id === "GHSA-ok" ? Response.json({ database_specific: { severity: "LOW" } }) : new Response("", { status: 500 }),
    );

    const result = await fetchSecurityExposure("acme", "js", "main");

    expect(result).toMatchObject({ known: true, low: 1, high: 1 });
    expect(mockReport).toHaveBeenCalledTimes(1);
    expect(mockReport).toHaveBeenCalledWith(expect.any(Error), {
      message: expect.stringContaining("OSV severity GHSA-bad"),
    });
  });

  it("guard: a readable detail with no label or CVSS still defaults high WITHOUT a door (not a failed read)", async () => {
    osv(["GHSA-bare"], async () => Response.json({}));

    expect(await fetchSecurityExposure("acme", "js", "main")).toMatchObject({ high: 1 });
    expect(mockReport).not.toHaveBeenCalled();
  });
});
