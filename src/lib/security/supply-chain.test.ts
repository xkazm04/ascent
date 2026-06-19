// The Dependabot advisory parser is the trust boundary for the supply-chain signal — it must tally
// real severities and quietly ignore malformed entries (the API shape varies). DB/App/pool are mocked
// so importing the module never touches the network.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/db", () => ({ getOrgRollup: vi.fn(), getInstallationIdForOwner: vi.fn() }));
vi.mock("@/lib/github/app", () => ({ getInstallationToken: vi.fn() }));
vi.mock("@/lib/pool", () => ({ mapPool: vi.fn(), SCAN_CONCURRENCY: 4 }));

import { countAdvisories } from "./supply-chain";

describe("countAdvisories", () => {
  it("tallies severities across the Dependabot alert shapes (case-insensitive)", () => {
    const alerts = [
      { security_advisory: { severity: "critical" } },
      { security_advisory: { severity: "HIGH" } },
      { security_vulnerability: { severity: "high" } },
      { severity: "medium" }, // top-level fallback
      { security_advisory: { severity: "low" } },
      { security_advisory: { severity: "low" } },
    ];
    expect(countAdvisories(alerts)).toEqual({ critical: 1, high: 2, medium: 1, low: 2 });
  });

  it("ignores malformed or unknown-severity entries", () => {
    const alerts = [null, "x", 42, {}, { severity: "informational" }, { security_advisory: {} }];
    expect(countAdvisories(alerts)).toEqual({ critical: 0, high: 0, medium: 0, low: 0 });
  });
});

// ===========================================================================
// getOrgSupplyChain — the QUIET-DEGRADATION + DEMO-HONESTY trust boundary.
//
// The pre-existing tests above stop at the pure `countAdvisories` tally. The risk lives one layer up:
// `fetchAdvisories` MUST return null (→ the repo is EXCLUDED) on a 403/404/throw, so a permission-less
// or erroring repo is dropped rather than reported as "0 advisories — clean" — the most dangerous
// possible false signal in a security tool. And `demo` (true IFF provider=mock) is the honesty flag the
// UI uses to label demo numbers so they are never presented as live security facts. Pin degrade-honest
// vs real vs demo.
// (test-mastery-2026-06-18, finding #4 High / error-branch)
// ===========================================================================

import { getOrgSupplyChain } from "./supply-chain";
import { getOrgRollup, getInstallationIdForOwner } from "@/lib/db";
import { getInstallationToken } from "@/lib/github/app";
import { mapPool } from "@/lib/pool";

const mockRollup = vi.mocked(getOrgRollup);
const mockInstId = vi.mocked(getInstallationIdForOwner);
const mockToken = vi.mocked(getInstallationToken);
const mockMapPool = vi.mocked(mapPool);

type Rollup = NonNullable<Awaited<ReturnType<typeof getOrgRollup>>>;
type RepoRow = Rollup["repos"][number];

// One scanned repo row — getOrgSupplyChain only reads owner/name/fullName + `latest` truthiness (repos
// without `latest` are filtered before any advisory fetch). The rest is inert padding.
function repo(name: string, scanned = true): RepoRow {
  return {
    fullName: `acme/${name}`,
    owner: "acme",
    name,
    isPrivate: false,
    watched: true,
    primaryLanguage: "TypeScript",
    scanSchedule: "weekly",
    lastScanAt: "2026-06-01T00:00:00.000Z",
    lastScanStatus: "ok",
    lastScanError: null,
    aiConformance: null,
    latest: scanned
      ? { level: "L3", overall: 70, adoption: 50, rigor: 50, posture: "governed", scannedAt: "2026-06-01T00:00:00.000Z", dims: [] }
      : null,
  } as RepoRow;
}

function rollup(repos: RepoRow[]): Rollup {
  return {
    org: "acme",
    repoCount: repos.length,
    scannedCount: repos.length,
    avgOverall: 60,
    avgAdoption: 50,
    avgRigor: 50,
    postureCounts: {},
    dimAverages: [],
    repos,
    trend: [],
    forecast: null,
    baseline: null,
    deltas: null,
  } as Rollup;
}

// A `fetch` stub returning a Response-like object with the given ok/status and JSON body.
function fetchReturning(ok: boolean, status: number, json: unknown) {
  return vi.fn(async () => ({ ok, status, json: async () => json }) as unknown as Response);
}

const alert = (severity: string) => ({ security_advisory: { severity } });

// @/lib/pool is auto-mocked at the top (mapPool → vi.fn() returning undefined). Give it the REAL
// order-preserving fan-out so getOrgSupplyChain's per-repo provider calls actually run.
async function realMapPool<T, R>(items: readonly T[], _c: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i++) out[i] = await fn(items[i]!, i);
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  mockMapPool.mockImplementation(realMapPool as typeof mapPool);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// Each test below uses a UNIQUE org slug because getOrgSupplyChain has a module-level TTL cache keyed
// by slug — reusing a slug across tests would return a stale cached result.
describe("getOrgSupplyChain — quiet degradation on denied/failed fetch (the honesty invariant)", () => {
  beforeEach(() => {
    vi.stubEnv("SUPPLY_CHAIN_PROVIDER", "github");
    mockInstId.mockResolvedValue("inst_123");
    mockToken.mockResolvedValue("ghs_token");
  });

  it("403 (permission denied) → repo is DROPPED, NOT reported as 0 vulnerabilities (no false 'secure')", async () => {
    mockRollup.mockResolvedValue(rollup([repo("denied")]));
    vi.stubGlobal("fetch", fetchReturning(false, 403, { message: "Resource not accessible" }));

    const sc = (await getOrgSupplyChain("org-403"))!;
    expect(sc).not.toBeNull();
    // THE invariant: a denied fetch is excluded, not surfaced as a clean repo.
    expect(sc.scanned).toBe(0);
    expect(sc.repos).toEqual([]);
    expect(sc.totals).toEqual({ critical: 0, high: 0, medium: 0, low: 0, total: 0 });
    expect(sc.demo).toBe(false); // github mode is real data, never flagged demo
  });

  it("404 (alerts disabled) → repo is DROPPED, not a clean repo", async () => {
    mockRollup.mockResolvedValue(rollup([repo("noalerts")]));
    vi.stubGlobal("fetch", fetchReturning(false, 404, { message: "Not Found" }));

    const sc = (await getOrgSupplyChain("org-404"))!;
    expect(sc.scanned).toBe(0);
    expect(sc.repos).toEqual([]);
  });

  it("a thrown fetch (network error) → repo is DROPPED, not a clean repo", async () => {
    mockRollup.mockResolvedValue(rollup([repo("flaky")]));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNRESET");
      }),
    );

    const sc = (await getOrgSupplyChain("org-throw"))!;
    expect(sc.scanned).toBe(0);
    expect(sc.repos).toEqual([]);
  });

  it("a missing installation token → repo is DROPPED (never fetched), not a clean repo", async () => {
    // No token → the github provider returns null before any HTTP call.
    mockInstId.mockResolvedValue(null);
    mockRollup.mockResolvedValue(rollup([repo("untokened")]));
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const sc = (await getOrgSupplyChain("org-notoken"))!;
    expect(sc.scanned).toBe(0);
    expect(sc.repos).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("MIXED fleet: only the repos whose fetch SUCCEEDED are counted; denied repos vanish from totals", async () => {
    mockRollup.mockResolvedValue(rollup([repo("good"), repo("denied")]));
    // First repo OK with 2 high advisories; second repo 403.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [alert("high"), alert("high")] })
      .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const sc = (await getOrgSupplyChain("org-mixed"))!;
    // Only the good repo survives — the denied one is NOT folded in as zeros.
    expect(sc.scanned).toBe(1);
    expect(sc.repos.map((r) => r.name)).toEqual(["good"]);
    expect(sc.totals).toEqual({ critical: 0, high: 2, medium: 0, low: 0, total: 2 });
  });
});

describe("getOrgSupplyChain — successful fetch returns the real vuln tally", () => {
  beforeEach(() => {
    vi.stubEnv("SUPPLY_CHAIN_PROVIDER", "github");
    mockInstId.mockResolvedValue("inst_123");
    mockToken.mockResolvedValue("ghs_token");
  });

  it("tallies real advisories per repo and sums totals (not demo)", async () => {
    mockRollup.mockResolvedValue(rollup([repo("api")]));
    vi.stubGlobal("fetch", fetchReturning(true, 200, [alert("critical"), alert("high"), alert("low")]));

    const sc = (await getOrgSupplyChain("org-real"))!;
    expect(sc.provider).toBe("github");
    expect(sc.demo).toBe(false); // real data, honestly labeled
    expect(sc.scanned).toBe(1);
    expect(sc.repos[0]).toMatchObject({ name: "api", critical: 1, high: 1, medium: 0, low: 1, total: 3 });
    expect(sc.totals).toEqual({ critical: 1, high: 1, medium: 0, low: 1, total: 3 });
  });

  it("sorts repos worst-first: critical-desc, then high-desc", async () => {
    mockRollup.mockResolvedValue(rollup([repo("low-risk"), repo("crit-heavy"), repo("high-heavy")]));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [alert("low")] }) // low-risk
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [alert("critical"), alert("critical")] }) // crit-heavy
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [alert("high"), alert("high"), alert("high")] }); // high-heavy
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const sc = (await getOrgSupplyChain("org-sort"))!;
    expect(sc.repos.map((r) => r.name)).toEqual(["crit-heavy", "high-heavy", "low-risk"]);
  });

  it("non-array JSON falls back to explicit zeros (a KEPT, genuinely-clean repo) — distinct from a dropped repo", async () => {
    // Unlike a denied fetch, an OK response with a non-array body is the documented `{...EMPTY}` fallback:
    // the repo IS counted (scanned) with all-zero counts. This is the only honest "clean" outcome.
    mockRollup.mockResolvedValue(rollup([repo("weird")]));
    vi.stubGlobal("fetch", fetchReturning(true, 200, { message: "unexpected object" }));

    const sc = (await getOrgSupplyChain("org-nonarray"))!;
    expect(sc.scanned).toBe(1); // kept, not dropped
    expect(sc.repos[0]).toMatchObject({ name: "weird", critical: 0, high: 0, medium: 0, low: 0, total: 0 });
  });
});

describe("getOrgSupplyChain — demo honesty flag and provider selection", () => {
  it("mock provider sets demo===true and provider==='mock' (deterministic demo data, clearly labeled)", async () => {
    vi.stubEnv("SUPPLY_CHAIN_PROVIDER", "mock");
    mockRollup.mockResolvedValue(rollup([repo("demo-repo")]));
    // mock provider needs no fetch/token at all.

    const sc = (await getOrgSupplyChain("org-mock"))!;
    expect(sc.provider).toBe("mock");
    expect(sc.demo).toBe(true); // THE honesty invariant: demo data is flagged as demo
    expect(sc.scanned).toBe(1);
    expect(mockToken).not.toHaveBeenCalled();
  });

  it("demo===true IFF provider is mock — github mode is never flagged demo (even with zero advisories)", async () => {
    vi.stubEnv("SUPPLY_CHAIN_PROVIDER", "github");
    mockInstId.mockResolvedValue("inst_123");
    mockToken.mockResolvedValue("ghs_token");
    mockRollup.mockResolvedValue(rollup([repo("api")]));
    vi.stubGlobal("fetch", fetchReturning(true, 200, []));

    const sc = (await getOrgSupplyChain("org-github-real"))!;
    expect(sc.provider).toBe("github");
    expect(sc.demo).toBe(false);
  });

  it("returns null when SUPPLY_CHAIN_PROVIDER is unset (default off) — feature disabled, not faked", async () => {
    vi.stubEnv("SUPPLY_CHAIN_PROVIDER", undefined);
    expect(await getOrgSupplyChain("org-off-unset")).toBeNull();
    expect(mockRollup).not.toHaveBeenCalled(); // short-circuits before touching the DB
  });

  it("returns null when SUPPLY_CHAIN_PROVIDER === 'off'", async () => {
    vi.stubEnv("SUPPLY_CHAIN_PROVIDER", "off");
    expect(await getOrgSupplyChain("org-off-explicit")).toBeNull();
  });

  it("returns null when the org rollup is null (provider on, but nothing scanned)", async () => {
    vi.stubEnv("SUPPLY_CHAIN_PROVIDER", "mock");
    mockRollup.mockResolvedValue(null);
    expect(await getOrgSupplyChain("org-norollup")).toBeNull();
  });
});
