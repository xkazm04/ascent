// Route test for the weekly fleet-digest cron (GET /api/cron/digest). On a schedule this endpoint
// fans EACH org's private fleet intelligence (rollup + movers + top gap) out to an EXTERNAL Slack
// webhook. That makes two properties security-critical and entirely untested before this file:
//   (1) fail-closed auth — a missing/empty CRON_SECRET must 503 (the gate already regressed to an
//       opt-in `if (secret)` once; a forgotten env var would silently reopen a fleet-data-exfil
//       endpoint to the internet), and a wrong bearer/?key= must 401 with NO digest built/dispatched;
//   (2) per-tenant routing — org A's digest must POST to org A's OWN resolved webhook only, never to
//       org B's channel (a shared-variable / off-by-one bug here is a cross-tenant data leak).
// Plus the loop's resilience contracts: one org's rollup throwing must NOT abort the others
// (per-org try/catch, counted in `errors`); an org with no resolvable sink is skipped BEFORE any
// rollup work (counted in `skippedNoSink`).
//
// next/server, @/lib/db and @/lib/alerts are mocked so we can assert exactly which org's webhook
// each dispatch targets, and exactly when a digest is (and is NOT) built or dispatched.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));

vi.mock("@/lib/db", () => ({
  isDbConfigured: vi.fn(() => true),
  listOrgsWithWatchedRepos: vi.fn(async () => [] as string[]),
  getOrgAlertWebhook: vi.fn(async (_org: string) => null as string | null),
  getOrgRollup: vi.fn(async () => null),
  getOrgMovers: vi.fn(async () => null),
  getOrgRecommendations: vi.fn(async () => null),
  getOrgBenchmark: vi.fn(async () => null),
  getCreditState: vi.fn(async () => null),
}));

// ALERTS #1: the route noise-filters BOTH gainers and regressers before the movement-gate. Mock the
// noise helper so a test can drive which moves count as jitter and assert the `regressions` value the
// route passes to digestHasSignal excludes within-noise regressers (a pure-jitter week stays silent).
vi.mock("@/lib/maturity/noise", () => ({
  isWithinNoise: vi.fn((d: number) => Math.abs(d) <= 2),
}));

vi.mock("@/lib/alerts", () => ({
  // `isAlertConfigured(url)` must mirror the real "a non-null/usable sink resolves" semantics for
  // routing decisions: here, any truthy webhookUrl is a configured sink (env fallback not needed
  // for these tests — every routed org carries its own URL).
  isAlertConfigured: vi.fn((url?: string | null) => Boolean(url)),
  dispatchAlert: vi.fn(async () => true),
  buildFleetDigestMessage: vi.fn((d: { org: string }) => ({
    // Tag the built message with its org so a cross-tenant build is detectable too.
    text: `digest:${d.org}`,
    blocks: [],
  })),
  creditsAlertThreshold: vi.fn(() => 5),
  // The movement-gate. Default to "has signal" so the routing/auth tests behave as before; one test
  // flips it to false to assert the route SKIPS a flat org (skippedFlat++) without building/dispatching.
  digestHasSignal: vi.fn(() => true),
}));

import { GET } from "./route";
import {
  isDbConfigured,
  listOrgsWithWatchedRepos,
  getOrgAlertWebhook,
  getOrgRollup,
  getOrgMovers,
  getOrgRecommendations,
  getOrgBenchmark,
  getCreditState,
} from "@/lib/db";
import { dispatchAlert, buildFleetDigestMessage, digestHasSignal } from "@/lib/alerts";
import { isWithinNoise } from "@/lib/maturity/noise";

const mockIsDb = vi.mocked(isDbConfigured);
const mockListOrgs = vi.mocked(listOrgsWithWatchedRepos);
const mockOrgWebhook = vi.mocked(getOrgAlertWebhook);
const mockRollup = vi.mocked(getOrgRollup);
const mockMovers = vi.mocked(getOrgMovers);
const mockRecs = vi.mocked(getOrgRecommendations);
const mockBenchmark = vi.mocked(getOrgBenchmark);
const mockCredit = vi.mocked(getCreditState);
const mockDispatch = vi.mocked(dispatchAlert);
const mockBuild = vi.mocked(buildFleetDigestMessage);
const mockHasSignal = vi.mocked(digestHasSignal);

const SECRET = "digest-secret-xyz";

// A non-empty rollup so the route proceeds past the `scannedCount === 0` short-circuit and builds.
const rollupWith = () =>
  ({
    repoCount: 4,
    scannedCount: 4,
    avgOverall: 72,
    deltas: { overall: 1 },
    forecast: null,
  }) as unknown as Awaited<ReturnType<typeof getOrgRollup>>;

function req(opts: { auth?: string; key?: string } = {}) {
  const url = opts.key
    ? `http://localhost/api/cron/digest?key=${opts.key}`
    : "http://localhost/api/cron/digest";
  return new Request(url, {
    method: "GET",
    headers: opts.auth ? { authorization: opts.auth } : {},
  });
}

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe("GET /api/cron/digest — auth fail-closed + per-tenant routing + partial-failure isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = SECRET;
    delete process.env.ASCENT_PUBLIC_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.CREDITS_ALERT_THRESHOLD;
    mockIsDb.mockReturnValue(true);
    mockListOrgs.mockResolvedValue([]);
    mockOrgWebhook.mockResolvedValue(null);
    mockRollup.mockResolvedValue(null);
    mockMovers.mockResolvedValue(null);
    mockRecs.mockResolvedValue(null);
    mockBenchmark.mockResolvedValue(null);
    mockCredit.mockResolvedValue(null);
    mockDispatch.mockResolvedValue(true);
    mockHasSignal.mockReturnValue(true);
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  // ---- (1) FAIL CLOSED when CRON_SECRET is missing/empty ------------------

  it("fails CLOSED with 503 when CRON_SECRET is UNSET — no orgs listed, nothing dispatched", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req({ auth: `Bearer ${SECRET}` }));
    expect(res.status).toBe(503);
    // A forgotten env var must NOT leave a fleet-data-exfil endpoint open.
    expect(mockListOrgs).not.toHaveBeenCalled();
    expect(mockBuild).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("fails CLOSED with 503 when CRON_SECRET is EMPTY — nothing dispatched", async () => {
    process.env.CRON_SECRET = "";
    const res = await GET(req({ auth: "Bearer " }));
    expect(res.status).toBe(503);
    expect(mockListOrgs).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  // ---- (2) REJECT bad credentials → 401, no digest work -------------------

  it("rejects a wrong Bearer with 401 — no digest built or dispatched", async () => {
    const res = await GET(req({ auth: "Bearer wrong-secret" }));
    expect(res.status).toBe(401);
    expect(mockListOrgs).not.toHaveBeenCalled();
    expect(mockBuild).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("rejects a wrong ?key= with 401 — no digest built or dispatched", async () => {
    const res = await GET(req({ key: "nope" }));
    expect(res.status).toBe(401);
    expect(mockBuild).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("rejects a request with NO credential at all with 401", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("does NOT accept the bare secret as the authorization header (must be `Bearer ${secret}`)", async () => {
    const res = await GET(req({ auth: SECRET }));
    expect(res.status).toBe(401);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  // ---- (3) DB-not-configured short-circuit (auth still passes first) -------

  it("authorizes first, then skips (no dispatch) when the DB is not configured", async () => {
    mockIsDb.mockReturnValue(false);
    const res = await GET(req({ auth: `Bearer ${SECRET}` }));
    const body = await bodyOf(res);
    expect(res.status ?? 200).toBe(200);
    expect(body.skipped).toBeDefined();
    expect(mockListOrgs).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  // ---- (4) PER-TENANT ROUTING — each org's digest goes to its OWN sink ----

  it("accepts a correct Bearer and routes each org's digest to ONLY that org's own webhook", async () => {
    mockListOrgs.mockResolvedValue(["orgA", "orgB"]);
    mockOrgWebhook.mockImplementation(async (org: string) =>
      org === "orgA" ? "https://hooks.example.com/A" : "https://hooks.example.com/B",
    );
    mockRollup.mockResolvedValue(rollupWith());

    const res = await GET(req({ auth: `Bearer ${SECRET}` }));
    const body = await bodyOf(res);
    expect(res.status ?? 200).toBe(200);
    expect(body).toMatchObject({ orgs: 2, sent: 2, skippedNoSink: 0, errors: [] });

    // Exactly one dispatch per org, each to its OWN resolved webhook — never cross-posted.
    expect(mockDispatch).toHaveBeenCalledTimes(2);
    const calls = mockDispatch.mock.calls;
    const byUrl = new Map(
      calls.map(([msg, opts]) => [(opts as { webhookUrl?: string }).webhookUrl, (msg as { text: string }).text]),
    );
    // org A's digest message went to org A's webhook (and the same for B).
    expect(byUrl.get("https://hooks.example.com/A")).toBe("digest:orgA");
    expect(byUrl.get("https://hooks.example.com/B")).toBe("digest:orgB");

    // Hard cross-tenant assertion: no dispatch ever paired orgA's message with orgB's URL or vice-versa.
    for (const [msg, opts] of calls) {
      const text = (msg as { text: string }).text;
      const url = (opts as { webhookUrl?: string }).webhookUrl;
      if (text === "digest:orgA") expect(url).toBe("https://hooks.example.com/A");
      if (text === "digest:orgB") expect(url).toBe("https://hooks.example.com/B");
    }
  });

  it("accepts a correct ?key= secret and dispatches the digest", async () => {
    mockListOrgs.mockResolvedValue(["orgA"]);
    mockOrgWebhook.mockResolvedValue("https://hooks.example.com/A");
    mockRollup.mockResolvedValue(rollupWith());

    const res = await GET(req({ key: SECRET }));
    expect(res.status ?? 200).toBe(200);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect((mockDispatch.mock.calls[0][1] as { webhookUrl?: string }).webhookUrl).toBe(
      "https://hooks.example.com/A",
    );
  });

  // ---- (5) NO-SINK orgs are skipped BEFORE any rollup work ----------------

  it("skips an org with no resolvable sink and does NO rollup work for it (skippedNoSink++)", async () => {
    mockListOrgs.mockResolvedValue(["orgA", "orgNoSink"]);
    mockOrgWebhook.mockImplementation(async (org: string) =>
      org === "orgA" ? "https://hooks.example.com/A" : null,
    );
    mockRollup.mockResolvedValue(rollupWith());

    const res = await GET(req({ auth: `Bearer ${SECRET}` }));
    const body = await bodyOf(res);
    expect(body).toMatchObject({ orgs: 2, sent: 1, skippedNoSink: 1, errors: [] });

    // The no-sink org must short-circuit BEFORE getOrgRollup — only orgA's rollup is fetched.
    expect(mockRollup).toHaveBeenCalledTimes(1);
    expect(mockRollup.mock.calls[0][0]).toBe("orgA");
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect((mockDispatch.mock.calls[0][1] as { webhookUrl?: string }).webhookUrl).toBe(
      "https://hooks.example.com/A",
    );
  });

  // ---- (6) PARTIAL-FAILURE ISOLATION — one org failing doesn't abort others ----

  it("isolates a per-org failure: a throwing org is counted in errors, the OTHER org still gets sent", async () => {
    mockListOrgs.mockResolvedValue(["orgBad", "orgGood"]);
    mockOrgWebhook.mockImplementation(async (org: string) =>
      org === "orgBad" ? "https://hooks.example.com/BAD" : "https://hooks.example.com/GOOD",
    );
    mockRollup.mockImplementation(async (org: string) => {
      if (org === "orgBad") throw new Error("rollup exploded");
      return rollupWith();
    });

    const res = await GET(req({ auth: `Bearer ${SECRET}` }));
    const body = await bodyOf(res);

    // orgBad surfaces in errors but does NOT abort the loop — orgGood is still dispatched.
    expect(body.orgs).toBe(2);
    expect(body.sent).toBe(1);
    expect(Array.isArray(body.errors)).toBe(true);
    expect((body.errors as string[]).some((e) => e.includes("orgBad"))).toBe(true);

    // The single dispatch is the GOOD org to its own sink — the failure was contained.
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    const [msg, opts] = mockDispatch.mock.calls[0];
    expect((msg as { text: string }).text).toBe("digest:orgGood");
    expect((opts as { webhookUrl?: string }).webhookUrl).toBe("https://hooks.example.com/GOOD");
  });

  it("movement-gates a flat org: a sink + scanned fleet but no signal → skippedFlat, nothing built/dispatched", async () => {
    mockListOrgs.mockResolvedValue(["orgFlat"]);
    mockOrgWebhook.mockResolvedValue("https://hooks.example.com/FLAT");
    mockRollup.mockResolvedValue(rollupWith());
    mockHasSignal.mockReturnValue(false); // nothing material moved this period

    const res = await GET(req({ auth: `Bearer ${SECRET}` }));
    const body = await bodyOf(res);
    expect(body).toMatchObject({ orgs: 1, sent: 0, skippedNoSink: 0, skippedFlat: 1, errors: [] });
    // The flat org must NOT train the inbox filter — no message built, nothing dispatched.
    expect(mockBuild).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  // ---- (7) ALERTS #1: regressers are noise-filtered symmetrically with gainers ----

  it("excludes within-noise regressers from the movement-gate (a pure-jitter week stays silent)", async () => {
    vi.mocked(isWithinNoise).mockImplementation((d: number) => Math.abs(d) <= 2);
    mockListOrgs.mockResolvedValue(["orgJitter"]);
    mockOrgWebhook.mockResolvedValue("https://hooks.example.com/J");
    mockRollup.mockResolvedValue(rollupWith());
    // A whole-fleet wobble: every move is within ±2 (jitter). Two land net-negative (regressers by
    // sign) but BOTH are within noise; one gainer also within noise.
    mockMovers.mockResolvedValue({
      regressers: [
        { name: "r1", dOverall: -1 },
        { name: "r2", dOverall: -2 },
      ],
      gainers: [{ name: "g1", dOverall: 1 }],
      levelChanges: [],
    } as unknown as Awaited<ReturnType<typeof getOrgMovers>>);
    // Use the real movement-gate so the route's filtered `regressions` count actually drives the skip.
    mockHasSignal.mockImplementation(
      (a: { overallDelta: number | null; levelChanges: number; regressions: number; gainersBeyondNoise: number; creditLow: boolean }) =>
        a.regressions > 0 || a.gainersBeyondNoise > 0 || a.levelChanges > 0 || a.creditLow,
    );

    const res = await GET(req({ auth: `Bearer ${SECRET}` }));
    const body = await bodyOf(res);

    // Both regressers (and the gainer) are within noise → no signal → skippedFlat, nothing dispatched.
    const sig = mockHasSignal.mock.calls[0][0] as { regressions: number; gainersBeyondNoise: number };
    expect(sig.regressions).toBe(0); // the fix: within-noise regressers are NOT counted
    expect(sig.gainersBeyondNoise).toBe(0);
    expect(body).toMatchObject({ orgs: 1, sent: 0, skippedFlat: 1 });
    expect(mockBuild).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("still counts a beyond-noise regresser and renders only beyond-noise regressers in the message", async () => {
    vi.mocked(isWithinNoise).mockImplementation((d: number) => Math.abs(d) <= 2);
    mockListOrgs.mockResolvedValue(["orgReal"]);
    mockOrgWebhook.mockResolvedValue("https://hooks.example.com/R");
    mockRollup.mockResolvedValue(rollupWith());
    mockMovers.mockResolvedValue({
      regressers: [
        { name: "real", dOverall: -7 }, // beyond noise → real signal
        { name: "jitter", dOverall: -1 }, // within noise → must be excluded from count + render
      ],
      gainers: [],
      levelChanges: [],
    } as unknown as Awaited<ReturnType<typeof getOrgMovers>>);
    mockHasSignal.mockImplementation((a: { regressions: number }) => a.regressions > 0);

    const res = await GET(req({ auth: `Bearer ${SECRET}` }));
    const body = await bodyOf(res);

    const sig = mockHasSignal.mock.calls[0][0] as { regressions: number };
    expect(sig.regressions).toBe(1); // only the beyond-noise regresser counts
    expect(body).toMatchObject({ orgs: 1, sent: 1 });
    // The message's regressers list excludes the within-noise repo, so it's never rendered.
    const built = mockBuild.mock.calls[0][0] as { regressers: { name: string }[] };
    expect(built.regressers.map((r) => r.name)).toEqual(["real"]);
  });

  it("does not dispatch when the org has a sink but nothing to report (scannedCount === 0)", async () => {
    mockListOrgs.mockResolvedValue(["orgA"]);
    mockOrgWebhook.mockResolvedValue("https://hooks.example.com/A");
    mockRollup.mockResolvedValue({ repoCount: 2, scannedCount: 0 } as unknown as Awaited<
      ReturnType<typeof getOrgRollup>
    >);

    const res = await GET(req({ auth: `Bearer ${SECRET}` }));
    const body = await bodyOf(res);
    expect(body).toMatchObject({ orgs: 1, sent: 0, skippedNoSink: 0 });
    expect(mockBuild).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("counts a dispatch that returns false as not-sent (sink resolved but delivery failed)", async () => {
    mockListOrgs.mockResolvedValue(["orgA"]);
    mockOrgWebhook.mockResolvedValue("https://hooks.example.com/A");
    mockRollup.mockResolvedValue(rollupWith());
    mockDispatch.mockResolvedValue(false);

    const res = await GET(req({ auth: `Bearer ${SECRET}` }));
    const body = await bodyOf(res);
    expect(body).toMatchObject({ orgs: 1, sent: 0, skippedNoSink: 0, errors: [] });
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });
});
