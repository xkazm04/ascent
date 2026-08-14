// Route test for /api/org/memory/recall — specifically the ACCOUNTING the UI surface depends on.
//
// The route already returned the packed winners and a bare `omittedCount`. A count tells a reader that
// something was left out but not WHICH lever moves it: a budget-bound memory is admitted by raising the
// budget, while a superseded/expired one never is. Those two now come back as separate, labelled lists.
//
// The pure scoring core runs FOR REAL here (it is untouched by this change); only the db/authz seams are
// mocked. The clock is the wall clock, so assertions are on ORDER and MEMBERSHIP, never on a literal score.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: { status?: number }) {
      return new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }
  },
}));

const { mockIsDbConfigured, mockLifecycleWorkingSet, mockBump, mockAuthorizeOrgApi, mockResolveViewerLogin } =
  vi.hoisted(() => ({
    mockIsDbConfigured: vi.fn(),
    mockLifecycleWorkingSet: vi.fn(),
    mockBump: vi.fn(),
    mockAuthorizeOrgApi: vi.fn(),
    mockRequireOrgRead: vi.fn(),
    mockResolveViewerLogin: vi.fn(),
  }));

vi.mock("@/lib/db", () => ({
  isDbConfigured: mockIsDbConfigured,
  lifecycleWorkingSet: mockLifecycleWorkingSet,
  bumpMemoryAccessCounts: mockBump,
}));
// The auth seam (token OR session). isDenied is a pure type guard — kept real via the actual module;
// only authorizeOrgApi is replaced, mirroring the skills route tests.
vi.mock("@/lib/api-token-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-token-auth")>();
  return { ...actual, authorizeOrgApi: mockAuthorizeOrgApi };
});
vi.mock("@/lib/access", () => ({ resolveViewerLogin: mockResolveViewerLogin }));

import { POST } from "./route";

const NOW = Date.now();
const iso = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString();

const row = (over: Partial<Record<string, unknown>> & { id: string; content: string }) => ({
  namespace: "",
  kind: "semantic",
  visibility: "shared",
  source: "",
  confidence: 1,
  tags: [],
  supersededBy: null,
  version: 1,
  accessCount: 0,
  expiresAt: null,
  createdBy: null,
  createdAt: iso(1),
  updatedAt: iso(1),
  ...over,
});

const post = (body: unknown) =>
  POST(new Request("http://t/api/org/memory/recall", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
  mockAuthorizeOrgApi.mockResolvedValue({ principal: { via: "session" } });
  mockResolveViewerLogin.mockResolvedValue("kazimi66");
  mockBump.mockResolvedValue(1);
});

describe("POST /api/org/memory/recall — what was packed, and what wasn't", () => {
  it("reports budget-bound omissions and not-recallable rows as SEPARATE, labelled lists", async () => {
    mockLifecycleWorkingSet.mockResolvedValue([
      row({ id: "fresh", content: "x".repeat(100), updatedAt: iso(1) }),
      // Ranks above `fresh` on nothing but can't fit — and must NOT stop the pass.
      row({ id: "huge", content: "y".repeat(900), updatedAt: iso(0.5) }),
      row({ id: "small", content: "z".repeat(50), updatedAt: iso(2) }),
      // Not recallable at any budget. (lifecycleWorkingSet excludes these in production; mocked in so
      // the classification itself is exercised.)
      row({ id: "gone", content: "old truth", supersededBy: "fresh", updatedAt: iso(1) }),
      row({ id: "stale", content: "ttl'd", expiresAt: iso(1), updatedAt: iso(1) }),
    ]);

    const body = await (await post({ org: "acme", charBudget: 200 })).json();

    const packed = body.memories.map((m: { id: string }) => m.id);
    // Whole-item greedy packing: `huge` is SKIPPED, not a stop condition, so `small` still lands.
    expect(packed).toContain("fresh");
    expect(packed).toContain("small");
    expect(packed).not.toContain("huge");
    expect(body.usedChars).toBeLessThanOrEqual(200);

    expect(body.omitted.map((m: { id: string }) => m.id)).toEqual(["huge"]);
    expect(body.omittedCount).toBe(1);
    // Budget-bound rows carry the SAME server-computed score/age the packed ones do, so the UI can
    // render a near-miss without recomputing anything.
    expect(typeof body.omitted[0].score).toBe("number");
    expect(typeof body.omitted[0].ageDays).toBe("number");

    expect(body.ineligible).toHaveLength(2);
    expect(
      Object.fromEntries(body.ineligible.map((m: { id: string; reason: string }) => [m.id, m.reason])),
    ).toEqual({ gone: "superseded", stale: "expired" });

    // consideredCount counts only the RECALLABLE rows the pass ranked.
    expect(body.consideredCount).toBe(3);
  });

  it("bumps accessCount for the packed rows only — never for a memory that lost the budget race", async () => {
    mockLifecycleWorkingSet.mockResolvedValue([
      row({ id: "a", content: "a".repeat(100) }),
      row({ id: "b", content: "b".repeat(900) }),
    ]);
    await post({ org: "acme", charBudget: 200 });
    expect(mockBump).toHaveBeenCalledWith("acme", ["a"]);
  });

  it("clamps an out-of-range budget instead of honoring it", async () => {
    mockLifecycleWorkingSet.mockResolvedValue([row({ id: "a", content: "a" })]);
    const tiny = await (await post({ org: "acme", charBudget: 0 })).json();
    expect(tiny.charBudget).toBe(200); // floored to MIN_CHAR_BUDGET, never a useless 0
    const absent = await (await post({ org: "acme" })).json();
    expect(absent.charBudget).toBe(6000); // omitted => the documented default
    const huge = await (await post({ org: "acme", charBudget: 10_000_000 })).json();
    expect(huge.charBudget).toBe(60_000);
  });

  it("stays read-gated: a denial short-circuits before any read or counter bump", async () => {
    mockAuthorizeOrgApi.mockResolvedValue({ denied: new Response("nope", { status: 403 }) });
    const res = await post({ org: "acme" });
    expect(res.status).toBe(403);
    expect(mockLifecycleWorkingSet).not.toHaveBeenCalled();
    expect(mockBump).not.toHaveBeenCalled();
  });

  it("asks the seam for the memory:read scope in read mode", async () => {
    mockLifecycleWorkingSet.mockResolvedValue([]);
    await post({ org: "acme" });
    expect(mockAuthorizeOrgApi).toHaveBeenCalledWith(expect.anything(), "acme", { scope: "memory:read", mode: "read" });
  });

  it("a token principal reads as an anonymous member: null viewer, shared memories only", async () => {
    mockAuthorizeOrgApi.mockResolvedValue({
      principal: { via: "token", login: "token:ci", tokenId: "t1", scopes: ["memory:read"] },
    });
    mockLifecycleWorkingSet.mockResolvedValue([row({ id: "a", content: "shared truth" })]);
    const body = await (await post({ org: "acme" })).json();
    // The privacy filter (lifecycleWorkingSet's third arg) gets NULL — never the token's audit label,
    // which is not a GitHub login and must not accidentally match an author.
    expect(mockLifecycleWorkingSet).toHaveBeenCalledWith("acme", expect.anything(), null);
    expect(mockResolveViewerLogin).not.toHaveBeenCalled();
    expect(body.memories.map((m: { id: string }) => m.id)).toEqual(["a"]);
  });
});
