// UAT TOMAS-L1-01 / MC-B2 — ONE ANSWER FOR THE SCAN WALL.
//
// The defect this pins was not a wrong gate; it was TWO gates for one decision. `scanAuthGate` was
// changed to exempt the anonymous public funnel (a cookie-less `POST /api/scan` returns 200), and the
// landing hero's scan dialog went on locking on the coarser `authGateEnabled()` — so the product
// painted a "Scanning is for signed-in members" panel over a scan the server would have run, and took
// the QuotaMeter and the honest duration sentence down with it. A buyer's front door refused what the
// back door served.
//
// `publicScanWallEnabled()` is now the single predicate, and the assertions below are the contract:
// across the whole env matrix it must agree, decision for decision, with what `scanAuthGate` actually
// does on its `publicScan: true` branch. If someone re-splits them, this fails before a walker has to
// find it a second time.
//
// `@/lib/db` is stubbed because scan-gates imports `recordQuotaEvent` for the rate limiter's
// observability side effect; nothing here touches the limiter.

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ recordQuotaEvent: vi.fn(async () => {}) }));

import { publicScanWallEnabled, scanAuthGate } from "@/lib/scan-gates";
import type { Viewer } from "@/lib/access";

const SIGNED_IN = { id: "u1" } as unknown as Viewer;

/** The env dimensions the two predicates are built from. */
type Env = { supabase: boolean; bypass: boolean; requireSignIn: boolean };

const MATRIX: Env[] = [false, true].flatMap((supabase) =>
  [false, true].flatMap((bypass) => [false, true].map((requireSignIn) => ({ supabase, bypass, requireSignIn }))),
);

const saved = { ...process.env };

function applyEnv({ supabase, bypass, requireSignIn }: Env) {
  // NODE_ENV stays non-production so `authBypassEnabled()` is readable at all; its production floor is
  // its own module's contract, not this one's.
  if (supabase) {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  } else {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  }
  if (bypass) process.env.ASCENT_AUTH_BYPASS = "1";
  else delete process.env.ASCENT_AUTH_BYPASS;
  if (requireSignIn) process.env.ASCENT_REQUIRE_SIGNIN_FOR_PUBLIC_SCAN = "1";
  else delete process.env.ASCENT_REQUIRE_SIGNIN_FOR_PUBLIC_SCAN;
}

beforeEach(() => {
  delete process.env.ASCENT_AUTH_BYPASS;
  delete process.env.ASCENT_REQUIRE_SIGNIN_FOR_PUBLIC_SCAN;
});
afterEach(() => {
  process.env = { ...saved };
});

const label = (e: Env) =>
  `supabase=${e.supabase} bypass=${e.bypass} requireSignIn=${e.requireSignIn}`;

describe("publicScanWallEnabled agrees with scanAuthGate's public branch", () => {
  for (const env of MATRIX) {
    it(`refuses an anonymous public scan iff the predicate says walled — ${label(env)}`, async () => {
      applyEnv(env);
      const walled = publicScanWallEnabled();
      const decision = await scanAuthGate(() => null, { publicScan: true });
      // The UI reads `walled`; the endpoint runs `decision`. They are the same statement.
      expect(decision.ok).toBe(!walled);
      if (!decision.ok) expect(decision.reason).toBe("auth_required");
    });

    it(`never refuses a SIGNED-IN public scan — ${label(env)}`, async () => {
      applyEnv(env);
      await expect(scanAuthGate(() => SIGNED_IN, { publicScan: true })).resolves.toEqual({ ok: true });
    });
  }
});

describe("the default deployment is open, and re-walling is a deliberate act", () => {
  it("a production-shaped host with no opt-in lets an anonymous public scan through", async () => {
    applyEnv({ supabase: true, bypass: false, requireSignIn: false });
    expect(publicScanWallEnabled()).toBe(false);
    await expect(scanAuthGate(() => null, { publicScan: true })).resolves.toEqual({ ok: true });
  });

  it("ASCENT_REQUIRE_SIGNIN_FOR_PUBLIC_SCAN re-walls it, and the dialog is told so", async () => {
    applyEnv({ supabase: true, bypass: false, requireSignIn: true });
    expect(publicScanWallEnabled()).toBe(true);
    await expect(scanAuthGate(() => null, { publicScan: true })).resolves.toEqual({
      ok: false,
      reason: "auth_required",
    });
  });
});

describe("the PRIVATE scan wall is untouched by the public-funnel flag", () => {
  it("walls an anonymous private scan whenever the general gate is on, opt-in or not", async () => {
    for (const requireSignIn of [false, true]) {
      applyEnv({ supabase: true, bypass: false, requireSignIn });
      await expect(scanAuthGate(() => null, { publicScan: false })).resolves.toEqual({
        ok: false,
        reason: "auth_required",
      });
    }
  });

  it("passes an anonymous private scan when the general gate is off", async () => {
    applyEnv({ supabase: false, bypass: false, requireSignIn: true });
    await expect(scanAuthGate(() => null, { publicScan: false })).resolves.toEqual({ ok: true });
  });

  it("does not resolve a viewer at all when no wall applies (the call-site short-circuit)", async () => {
    applyEnv({ supabase: true, bypass: false, requireSignIn: false });
    const resolveViewer = vi.fn(() => null);
    await scanAuthGate(resolveViewer, { publicScan: true });
    expect(resolveViewer).not.toHaveBeenCalled();
  });
});

// ── The three scan doors give one answer ────────────────────────────────────────────────────────────
// A behavioural test cannot see the seam that actually broke: the landing page COMPUTING its own
// predicate. So read the three doors' sources and assert each defers to the server's decision — the
// hero dialog by passing `publicScanWallEnabled()` down, `/report?repo=` and the cold permalink by
// starting the scan and rendering whatever the endpoint answers (`auth_required` → SignInNotice)
// rather than pre-judging it client-side. TOMAS-L1-08 is the second half of this: a wall on one door
// and none on the other two protects nothing and costs the one visitor who used the front door.
describe("the three scan doors read one predicate", () => {
  const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

  it("DOOR 1 — the landing page derives the dialog's wall from publicScanWallEnabled, never authGateEnabled", () => {
    const page = src("src/app/page.tsx");
    expect(page).toMatch(/const gated = publicScanWallEnabled\(\)/);
    // The exact regression: `gated = authGateEnabled()` walled a scan the endpoint exempted. Match on
    // the IMPORT, not on the identifier — the comment above that line names the predicate it replaced,
    // and a rule that forbids naming the bug in prose would be a rule against explaining it.
    expect(page).not.toMatch(/^import\s[^;]*\bauthGateEnabled\b/m);
  });

  it("DOOR 2 — /report?repo= adds no wall of its own and renders the server's auth answer", () => {
    const client = src("src/components/report/ReportClient.tsx");
    expect(client).toContain("state.authRequired");
    expect(client).toContain("SignInNotice");
    // No client-side gate predicate anywhere on this path — the scan runs and the server decides.
    expect(client).not.toContain("authGateEnabled");
    expect(client).not.toContain("publicScanWallEnabled");
  });

  it("DOOR 3 — the cold permalink keeps its explicit start affordance and states no account is needed", () => {
    const cold = src("src/components/report/ColdScanGate.tsx");
    expect(cold).toContain("needs no account");
    expect(cold).toContain("setScanning(true)");
    expect(cold).not.toContain("authGateEnabled");
    expect(cold).not.toContain("publicScanWallEnabled");
  });

  it("the QuotaMeter and the duration sentence ride the OPEN branch, so an anonymous visitor sees both", () => {
    const modal = src("src/components/landing/prototypes/index/ScanModal.tsx");
    // Both live below the `locked ? … : …` split's open arm; with the wall correctly off they render.
    expect(modal).toContain("<QuotaMeter />");
    expect(modal).toContain("SCAN_DURATION");
    expect(modal).toMatch(/const locked = gated && signedIn === false/);
  });
});
