// GET /api/history answers the shared history ladder's states as status codes: missing / invalid 400,
// no database 503, an unreachable one 500, every scan hidden by the plan window 200 empty with
// `x-ascent-history-hidden: window`, ok 200 with the ETag.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  configured: true,
  orgs: new Map<string, { plan: string; kind: string }>(),
}));
vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));
vi.mock("@/lib/api/respond", () => ({ reportHandledError: vi.fn() }));
vi.mock("@/lib/auth", () => ({ isAuthConfigured: () => false, readableOrgForOwner: async () => "public" }));
vi.mock("@/lib/access", () => ({ authGateEnabled: () => false, resolveViewerLogin: async () => "kaz" }));
vi.mock("@/lib/authz", () => ({ canReadOrg: async () => false }));
vi.mock("@/lib/db/scans-read", () => ({ getOrgForHistoryWindow: async (s: string) => h.orgs.get(s) ?? null }));
vi.mock("@/lib/db", () => ({ isDbConfigured: () => h.configured, getRepositoryHistory: vi.fn() }));

import { GET } from "./route";
import { getRepositoryHistory } from "@/lib/db";

const mockHistory = vi.mocked(getRepositoryHistory);
const series = (ids: string[]) =>
  ({
    repo: { owner: "o", name: "r", fullName: "o/r" },
    scans: ids.map((id) => ({ id, scannedAt: "2026-10-20T00:00:00.000Z", overallScore: 70, level: "L3", dimensions: [] })),
  }) as unknown as Awaited<ReturnType<typeof getRepositoryHistory>>;
const get = (qs: string) => GET(new Request(`http://t/api/history${qs}`));

beforeEach(() => {
  vi.stubEnv("ASCENT_SELF_HOSTED", "0");
  h.configured = true;
  h.orgs.clear();
  h.orgs.set("kaz", { plan: "free", kind: "personal" });
  mockHistory.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/history - the ladder's states as status codes", () => {
  it("missing and invalid repo are 400, no database is 503, and none of them reads", async () => {
    expect((await get("")).status).toBe(400);
    expect((await get("?repo=not%20a%20repo")).status).toBe(400);
    h.configured = false;
    expect((await get("?repo=o/r")).status).toBe(503);
    expect(mockHistory).not.toHaveBeenCalled();
  });

  it("an unreachable database is 500", async () => {
    mockHistory.mockRejectedValue(Object.assign(new Error("down"), { code: "DB_UNAVAILABLE" }));
    expect((await get("?repo=o/r")).status).toBe(500);
  });

  it("every scan hidden by the window: 200 empty, flagged x-ascent-history-hidden: window", async () => {
    mockHistory.mockResolvedValueOnce(series([])).mockResolvedValueOnce(series(["old"]));
    const res = await get("?repo=o/r");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-ascent-history-hidden")).toBe("window");
    expect((await res.json()).scans).toEqual([]);
    // The probe is unwindowed and one row deep.
    expect(mockHistory.mock.calls[1]![2]).toMatchObject({ limit: 1, strict: true });
    expect(mockHistory.mock.calls[1]![2]!.since ?? null).toBeNull();
  });

  it("the CSV export carries the same flag", async () => {
    mockHistory.mockResolvedValueOnce(series([])).mockResolvedValueOnce(series(["old"]));
    const res = await get("?repo=o/r&format=csv");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-ascent-history-hidden")).toBe("window");
  });

  it("truly empty under a window: 200 empty and no hidden flag", async () => {
    mockHistory.mockResolvedValueOnce(series([])).mockResolvedValueOnce(series([]));
    const res = await get("?repo=o/r");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-ascent-history-hidden")).toBeNull();
  });

  it("ok is 200 with the ETag and no hidden flag, and the hidden answer never shares its validator", async () => {
    mockHistory.mockResolvedValue(series(["a"]));
    const ok = await get("?repo=o/r");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("etag")).toMatch(/^W\/"h/);
    expect(ok.headers.get("x-ascent-history-hidden")).toBeNull();
    mockHistory.mockReset();
    mockHistory.mockResolvedValueOnce(series([])).mockResolvedValueOnce(series([]));
    const empty = (await get("?repo=o/r")).headers.get("etag");
    mockHistory.mockResolvedValueOnce(series([])).mockResolvedValueOnce(series(["old"]));
    const hidden = (await get("?repo=o/r")).headers.get("etag");
    expect(hidden).toBeTruthy();
    expect(hidden).not.toBe(empty);
  });
});
