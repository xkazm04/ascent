// Route test for Athena's autonomous cycle (GET /api/cron/athena).
//
// This endpoint is the ONLY hosted path on which Athena acts without a human in the request, and it
// spends real model budget on every org in the fleet. Four properties are pinned here because each of
// them has a documented precedent for regressing somewhere in this codebase:
//
//   (1) the CRON_SECRET gate fails CLOSED — 503 with the secret unset, 401 with a bad one, and the
//       cycle NEVER runs in either case;
//   (2) a degraded or truncated run returns 207, never a green 200 (the purge's invariant: a cron
//       monitor watches the status and nothing else);
//   (3) a second invocation inside the period COALESCES — the at-most-once claim decides, and a lost
//       claim costs nothing;
//   (4) `maxDuration` equals the exported constant the fan-out's deadline is derived from. Next
//       requires the segment config to be a literal, so only a test can hold the two together.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));

vi.mock("@/lib/auth", () => ({ PUBLIC_ORG: "public" }));

const h = vi.hoisted(() => ({
  isDbConfigured: vi.fn(() => true),
  listOrgsWithWatchedRepos: vi.fn(async () => ["acme"] as string[]),
  getOrgId: vi.fn(async (slug: string) => (slug === "ghost" ? null : `id_${slug}`)),
  claimOrgAuditOnce: vi.fn(async () => ({ claimed: true, id: "aud_1" })),
  releaseAuditClaim: vi.fn(async () => {}),
  runOrgCycle: vi.fn(async () => ({
    org: "acme",
    skipped: null as string | null,
    landed: true,
    threadId: "th_1",
    raised: 1,
    absorbed: 2,
    absorbedBy: { maintenance: 2 },
    proposals: 0,
    claimHeld: true,
  })),
  // Default: exercise every item and report a complete run. Overridden where truncation is the subject.
  mapPoolUntilDeadline: vi.fn(async (items: readonly string[], _c: number, _d: number, fn: (i: string, n: number) => Promise<void>) => {
    for (const [i, item] of items.entries()) await fn(item, i);
    return { remaining: [] as string[], attempted: items.length, truncated: false };
  }),
}));

vi.mock("@/lib/db", () => ({
  isDbConfigured: h.isDbConfigured,
  listOrgsWithWatchedRepos: h.listOrgsWithWatchedRepos,
  getOrgId: h.getOrgId,
}));

vi.mock("@/lib/db/scans-audit", () => ({
  claimOrgAuditOnce: h.claimOrgAuditOnce,
  releaseAuditClaim: h.releaseAuditClaim,
}));

vi.mock("@/lib/pool", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pool")>()),
  mapPoolUntilDeadline: h.mapPoolUntilDeadline,
}));

// The CONSTANTS stay real — the maxDuration pin below is worthless against a mocked one.
vi.mock("@/lib/athena/cycle", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/athena/cycle")>()),
  runOrgCycle: h.runOrgCycle,
}));

vi.mock("./deps", () => ({ buildOrgCycleDeps: vi.fn(() => ({})) }));

import { GET, maxDuration } from "./route";
import { ATHENA_CYCLE_MAX_DURATION_S, ATHENA_CYCLE_ACTION, ATHENA_CYCLE_PERIOD_MS } from "@/lib/athena/cycle";
import { FLEET_FINALIZE_RESERVE_MS } from "@/lib/pool";

const SECRET = "s3cr3t-cron";

const req = (headers: Record<string, string> = {}) =>
  new Request("https://ascent.test/api/cron/athena", { headers });

const authed = () => req({ authorization: `Bearer ${SECRET}` });

const skipResult = (reason: string) => ({
  org: "acme",
  skipped: reason,
  landed: false,
  threadId: null,
  raised: 0,
  absorbed: 0,
  absorbedBy: {},
  proposals: 0,
  claimHeld: false,
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = SECRET;
  h.isDbConfigured.mockReturnValue(true);
  h.listOrgsWithWatchedRepos.mockResolvedValue(["acme"]);
  h.getOrgId.mockImplementation(async (slug: string) => (slug === "ghost" ? null : `id_${slug}`));
  h.claimOrgAuditOnce.mockResolvedValue({ claimed: true, id: "aud_1" });
  h.mapPoolUntilDeadline.mockImplementation(async (items, _c, _d, fn) => {
    for (const [i, item] of items.entries()) await fn(item, i);
    return { remaining: [], attempted: items.length, truncated: false };
  });
  h.runOrgCycle.mockResolvedValue({
    org: "acme",
    skipped: null,
    landed: true,
    threadId: "th_1",
    raised: 1,
    absorbed: 2,
    absorbedBy: { maintenance: 2 },
    proposals: 0,
    claimHeld: true,
  });
});

describe("the gate fails closed", () => {
  it("503s with CRON_SECRET unset, and runs nothing", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(h.runOrgCycle).not.toHaveBeenCalled();
    expect(h.listOrgsWithWatchedRepos).not.toHaveBeenCalled();
  });

  it("401s on a wrong bearer, and runs nothing", async () => {
    const res = await GET(req({ authorization: "Bearer wrong" }));
    expect(res.status).toBe(401);
    expect(h.runOrgCycle).not.toHaveBeenCalled();
  });

  it("401s on no credential at all", async () => {
    expect((await GET(req())).status).toBe(401);
  });

  it("refuses the ?key= query channel by default", async () => {
    const res = await GET(new Request(`https://ascent.test/api/cron/athena?key=${SECRET}`));
    expect(res.status).toBe(401);
    expect(h.runOrgCycle).not.toHaveBeenCalled();
  });

  it("503s when the database is unconfigured — a green 200 would hide a broken deploy", async () => {
    h.isDbConfigured.mockReturnValue(false);
    const res = await GET(authed());
    expect(res.status).toBe(503);
    expect(h.runOrgCycle).not.toHaveBeenCalled();
  });
});

describe("a clean run is green, a degraded one is not", () => {
  it("200s on a complete run", async () => {
    const res = await GET(authed());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ orgs: 1, briefed: 1, absorbedOutcomes: 2, remaining: 0 });
  });

  it("207s when an org threw, and releases that org's claim", async () => {
    h.runOrgCycle.mockRejectedValueOnce(new Error("provider exploded"));
    const res = await GET(authed());
    expect(res.status).toBe(207);
    expect((await res.json()).errors).toEqual(["acme: provider exploded"]);
    expect(h.releaseAuditClaim).toHaveBeenCalledWith("aud_1");
  });

  it("207s when the wall-clock budget truncated the fan-out, and reports the tail", async () => {
    h.listOrgsWithWatchedRepos.mockResolvedValue(["acme", "beta"]);
    h.mapPoolUntilDeadline.mockImplementation(async (items, _c, _d, fn) => {
      await fn(items[0]!, 0);
      return { remaining: [items[1]!], attempted: 1, truncated: true };
    });
    const res = await GET(authed());
    expect(res.status).toBe(207);
    expect(await res.json()).toMatchObject({ remaining: 1, truncated: true });
  });

  it("207s when no engine would answer — the cycle's whole reason for existing did nothing", async () => {
    h.runOrgCycle.mockResolvedValue(skipResult("no_engine"));
    const res = await GET(authed());
    expect(res.status).toBe(207);
    expect(await res.json()).toMatchObject({ skippedNoEngine: 1, briefed: 0 });
  });
});

describe("at most once per period", () => {
  it("coalesces a second invocation: the claim is lost, nothing is spent", async () => {
    h.claimOrgAuditOnce.mockResolvedValue({ claimed: false, id: null });
    const res = await GET(authed());
    expect(res.status).toBe(200);
    expect(h.runOrgCycle).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ skippedAlreadyRan: 1, briefed: 0 });
  });

  it("claims BEFORE the spend, under the cycle's own action and window", async () => {
    await GET(authed());
    const [action, slug, since] = h.claimOrgAuditOnce.mock.calls[0]!;
    expect(action).toBe(ATHENA_CYCLE_ACTION);
    expect(slug).toBe("acme");
    const age = Date.now() - (since as Date).getTime();
    expect(age).toBeGreaterThanOrEqual(ATHENA_CYCLE_PERIOD_MS - 5_000);
    expect(age).toBeLessThanOrEqual(ATHENA_CYCLE_PERIOD_MS + 5_000);
    expect(h.claimOrgAuditOnce.mock.invocationCallOrder[0]!).toBeLessThan(
      h.runOrgCycle.mock.invocationCallOrder[0]!,
    );
  });

  it("holds the claim on an ABSORBED run — the period really is finished", async () => {
    h.runOrgCycle.mockResolvedValue({
      org: "acme",
      skipped: null,
      landed: false,
      threadId: "th_1",
      raised: 0,
      absorbed: 3,
      absorbedBy: { maintenance: 3 },
      proposals: 0,
      claimHeld: true,
    });
    const res = await GET(authed());
    expect(res.status).toBe(200);
    expect(h.releaseAuditClaim).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ absorbedRuns: 1, absorbedOutcomes: 3, briefed: 0 });
  });
});

describe("an org mid-conversation is skipped, not queued", () => {
  it("counts the skip in the response and releases the window", async () => {
    h.runOrgCycle.mockResolvedValue(skipResult("live_turn"));
    const res = await GET(authed());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ skippedLiveTurn: 1, briefed: 0 });
    // The window is NOT marked done: a skipped org must be reachable on the next tick.
    expect(h.releaseAuditClaim).toHaveBeenCalledWith("aud_1");
  });
});

describe("the fleet the cycle considers", () => {
  it("never briefs the public funnel org — it has no companion to be", async () => {
    h.listOrgsWithWatchedRepos.mockResolvedValue(["public", "acme"]);
    await GET(authed());
    expect(h.claimOrgAuditOnce.mock.calls.map((c) => c[1])).toEqual(["acme"]);
  });

  it("skips an org whose slug no longer resolves, without claiming a window for it", async () => {
    h.listOrgsWithWatchedRepos.mockResolvedValue(["ghost"]);
    const res = await GET(authed());
    expect(h.claimOrgAuditOnce).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ skippedNoOrg: 1 });
  });
});

describe("the declared ceiling", () => {
  it("pins maxDuration to the constant the fan-out's deadline is derived from", () => {
    expect(maxDuration).toBe(ATHENA_CYCLE_MAX_DURATION_S);
  });

  it("leaves real headroom for the epilogue after the last lane drains", () => {
    expect(ATHENA_CYCLE_MAX_DURATION_S * 1000).toBeGreaterThan(FLEET_FINALIZE_RESERVE_MS * 2);
  });
});
