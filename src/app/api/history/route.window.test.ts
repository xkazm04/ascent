// The plan's history window on GET /api/history: the JSON series and the CSV both read under the same
// `since`, name it in a header, and a cached 304 can never cross windows.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const orgs = vi.hoisted(() => ({ rows: new Map<string, { plan: string; kind: string }>() }));
vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));
vi.mock("@/lib/auth", () => ({ isAuthConfigured: () => false, readableOrgForOwner: vi.fn() }));
vi.mock("@/lib/access", () => ({ authGateEnabled: () => false, resolveViewerLogin: vi.fn() }));
vi.mock("@/lib/authz", () => ({ canReadOrg: async () => false }));
vi.mock("@/lib/db/client", () => ({ isDbConfigured: () => true, dbReadStrict: <T,>(fn: () => Promise<T>) => fn() }));
vi.mock("@/lib/db/org-shared", () => ({ getOrgBySlug: async (s: string) => orgs.rows.get(s) ?? null }));
vi.mock("@/lib/db", () => ({ isDbConfigured: () => true, getRepositoryHistory: vi.fn() }));

import { GET } from "./route";
import { readableOrgForOwner } from "@/lib/auth";
import { resolveViewerLogin } from "@/lib/access";
import { getRepositoryHistory } from "@/lib/db";

const mockOrg = vi.mocked(readableOrgForOwner);
const mockViewer = vi.mocked(resolveViewerLogin);
const mockHistory = vi.mocked(getRepositoryHistory);
const DAY = 86_400_000;

const series = (ids: string[]) =>
  ({
    repo: { owner: "o", name: "r", fullName: "o/r" },
    scans: ids.map((id, i) => ({
      id, scannedAt: new Date(Date.UTC(2026, 9, 7 - i)).toISOString(), overallScore: 70, level: "L3",
      levelName: "x", engineProvider: "p", engineModel: "m", dimensions: [],
    })),
  }) as unknown as Awaited<ReturnType<typeof getRepositoryHistory>>;
const get = (qs = "", headers?: Record<string, string>) =>
  GET(new Request(`http://t/api/history?repo=o/r${qs}`, { headers }));
const sinceOf = () => mockHistory.mock.calls.at(-1)![2]!.since as Date | null | undefined;

beforeEach(() => {
  vi.stubEnv("ASCENT_SELF_HOSTED", "0");
  orgs.rows.clear();
  orgs.rows.set("kaz", { plan: "free", kind: "personal" });
  orgs.rows.set("acme", { plan: "team", kind: "team" });
  orgs.rows.set("bigco", { plan: "enterprise", kind: "team" });
  mockOrg.mockResolvedValue("public");
  mockViewer.mockResolvedValue("kaz");
  mockHistory.mockReset();
  mockHistory.mockResolvedValue(series(["a", "b"]));
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/history — the history window", () => {
  it("a Free personal-workspace viewer on a public repo reads since ≈ now-30d (JSON and CSV)", async () => {
    const t0 = Date.now();
    const json = await get();
    expect(sinceOf()!.getTime()).toBeGreaterThanOrEqual(t0 - 30 * DAY);
    expect(sinceOf()!.getTime()).toBeLessThanOrEqual(Date.now() - 30 * DAY);
    expect(json.headers.get("x-ascent-history-since")).toBe(sinceOf()!.toISOString());

    const csv = await get("&format=csv");
    expect(sinceOf()).toBeInstanceOf(Date);
    expect(csv.headers.get("x-ascent-history-since")).toBe(sinceOf()!.toISOString());
    expect(csv.headers.get("content-disposition")).toContain("-last30d.csv");
  });

  it("a Team tenant org floors at 365 days; enterprise has none", async () => {
    mockOrg.mockResolvedValue("acme");
    await get();
    expect(Date.now() - sinceOf()!.getTime()).toBeGreaterThan(364.9 * DAY);
    expect(Date.now() - sinceOf()!.getTime()).toBeLessThan(365.1 * DAY);
    mockOrg.mockResolvedValue("bigco");
    const res = await get("&format=csv");
    expect(sinceOf() ?? null).toBeNull();
    expect(res.headers.get("x-ascent-history-since")).toBeNull();
    expect(res.headers.get("content-disposition")).not.toMatch(/-last\d+d/);
  });

  it("a signed-out reader is unchanged: no floor, no header", async () => {
    mockViewer.mockResolvedValue(null);
    const res = await get();
    expect(sinceOf() ?? null).toBeNull();
    expect(res.headers.get("x-ascent-history-since")).toBeNull();
  });

  it("self-host is unchanged on every plan", async () => {
    vi.stubEnv("ASCENT_SELF_HOSTED", "1");
    await get();
    expect(sinceOf() ?? null).toBeNull();
    mockOrg.mockResolvedValue("acme");
    await get();
    expect(sinceOf() ?? null).toBeNull();
  });

  it("two windows over the same scans give two ETags, and a 304 never crosses windows", async () => {
    const free = (await get()).headers.get("etag");
    mockOrg.mockResolvedValue("acme");
    const team = (await get()).headers.get("etag");
    expect(free).toBeTruthy();
    expect(team).toBeTruthy();
    expect(free).not.toBe(team);
    // Team's validator against the Free window: full 200, not a 304.
    mockOrg.mockResolvedValue("public");
    expect((await get("", { "if-none-match": team! })).status).toBe(200);
    expect((await get("", { "if-none-match": free! })).status).toBe(304);
  });
});
