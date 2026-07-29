// Persisted-JSON parse-helper resilience for the pinned-snapshot reconstruction.
//
// getScanReportByCommit rebuilds the public `/report/{owner}/{repo}@{sha}` permalink directly from
// stored JSON columns. Four PURE, TOTAL guards stand between a malformed / legacy / hand-edited row
// and a broken (crash / NaN-rendered) public report:
//
//   parseStringArray  → string[]            (non-strings dropped; never throws → [])
//   parseJsonObject   → object | null       (array / scalar / bad-JSON → null, never blind-cast)
//   parseNumberArray  → number[] | null     (non-array → null; non-finite/non-number entries dropped)
//   parseDiscrepancies→ Discrepancy[]       (drops rows missing dimension/claim; bad-JSON → [])
//
// These helpers are module-PRIVATE, so we exercise the REAL code (no copy that can drift, no source
// change) through the only public seam that reaches them: getScanReportByCommit. We feed crafted
// stored-JSON column values via a faked Prisma and assert what lands on the reconstructed report.
//
// THE RESILIENCE INVARIANT PINNED HERE: every helper is TOTAL — on valid-but-wrong-shape, malformed,
// null, or undefined stored JSON it returns its documented default ([] / null) and NEVER throws, so a
// single corrupt scan row can never crash or NaN-render the shareable report page.
//
// Note on JS/JSON semantics (the finding's `[1,"x",NaN,2]→[1,2]` example is wrong): a literal `NaN`
// token is INVALID JSON, so JSON.parse throws and parseNumberArray returns null (the catch default).
// The real non-finite DROP path is reached with valid JSON that parses to a non-finite number —
// `1e400` parses to Infinity — which Number.isFinite filters out. Both are asserted below.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(() => true),
  mockGetPrisma: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: mockIsDbConfigured,
  getPrisma: mockGetPrisma,
  // Faithful stand-in for the real dbReadSafe (scan-persistence-history 07-16 #4): run fn; degrade a
  // DB-UNREACHABLE throw (PrismaClientInitializationError) to the fallback; re-throw anything else —
  // so the tests below can prove the readers are actually wrapped (a raw read would propagate).
  dbReadSafe: async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if ((err as { name?: string } | null)?.name === "PrismaClientInitializationError") return fallback;
      throw err;
    }
  },
}));

// resolveOrgId is the only scans-shared seam getScanReportByCommit needs to MOCK (to reach the scan
// row). The JSON parsers (parseJson/parseStringArray) and toPersistedRec are provided as their REAL
// implementations so the resilience assertions below exercise the production decode unchanged — these
// all live in scans-shared (the dependency sink) and scans-read imports them from here. NOTE:
// getScanReportByCommit routes its roadmap mapping through the canonical toPersistedRec, so it must be
// real here (not an inert vi.fn) for the roadmap.explore resilience assertions to hold.
vi.mock("@/lib/db/scans-shared", () => {
  // The canonical JSON.parse-with-fallback primitive (null/empty/malformed → null). parseStringArray,
  // toPersistedRec, and scans-read's object/number/discrepancy parsers all build on it.
  const parseJson = <T,>(s: string | null | undefined): T | null => {
    if (!s) return null;
    try {
      return JSON.parse(s) as T;
    } catch {
      return null;
    }
  };
  const parseStringArray = (s: string | null | undefined): string[] => {
    const p = parseJson<unknown>(s);
    return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : [];
  };
  const toPersistedRec = (r: {
    id: string;
    title: string;
    dimId: string;
    impact: string;
    effort: string;
    rationale: string;
    explore?: string;
    levelUnlock: string | null;
    status: string;
    assigneeLogin?: string | null;
    targetDate?: Date | null;
  }) => ({
    id: r.id,
    title: r.title,
    dimension: r.dimId,
    impact: r.impact,
    effort: r.effort,
    rationale: r.rationale,
    explore: parseStringArray(r.explore),
    levelUnlock: r.levelUnlock ?? undefined,
    status: r.status,
    assigneeLogin: r.assigneeLogin ?? null,
    targetDate: r.targetDate ? r.targetDate.toISOString().slice(0, 10) : null,
  });
  return {
    DEFAULT_ORG_SLUG: "public",
    canonicalRepoFullName: (owner: string, name: string) =>
      `${owner.trim().toLowerCase()}/${name.trim().toLowerCase()}`,
    resolveOrgId: vi.fn(async () => "org_1"),
    parseJson,
    parseStringArray,
    toPersistedRec,
  };
});

import {
  findScanByDedupKey,
  findScanByScannedAt,
  getLatestRecommendations,
  getScanReportByCommit,
  scanContentKey,
  scanDedupKey,
} from "./scans-read";

// ── Faked Prisma returning ONE scan row whose JSON columns we craft per-test ──────────────────────

/**
 * Build a minimal repo + scan graph for getScanReportByCommit. Only the persisted-JSON string columns
 * vary; every other field is a benign default so the real maturity/model + report assembly run clean.
 * `cols` overrides the raw stored-JSON strings the four helpers parse.
 */
function fakePrismaWithColumns(cols: {
  strengths?: string | null;
  risks?: string | null;
  prStats?: string | null;
  governance?: string | null;
  commitActivity?: string | null;
  discrepancies?: string | null;
  dimEvidence?: string | null;
  recExplore?: string | null;
  posture?: string;
}) {
  const scan = {
    id: "scan_1",
    headSha: "sha_abc",
    overallScore: 70,
    level: "L3",
    archetype: "app",
    adoptionScore: 60,
    rigorScore: 80,
    // Stored posture id (default agrees with postureFor(60,80)='ai-native'; a test overrides it to prove
    // reconstruction reads the FROZEN column rather than recomputing).
    posture: cols.posture === undefined ? "ai-native" : cols.posture,
    confidence: 0.9,
    headline: "ok",
    engineProvider: "anthropic",
    engineModel: "claude",
    scannedAt: new Date("2026-06-18T00:00:00.000Z"),
    // the JSON-string columns under test (default to well-formed, override per test):
    strengths: cols.strengths === undefined ? "[]" : cols.strengths,
    risks: cols.risks === undefined ? "[]" : cols.risks,
    prStats: cols.prStats === undefined ? null : cols.prStats,
    governance: cols.governance === undefined ? null : cols.governance,
    commitActivity: cols.commitActivity === undefined ? null : cols.commitActivity,
    discrepancies: cols.discrepancies === undefined ? "[]" : cols.discrepancies,
    dimensions: [
      {
        dimId: "ci",
        name: "CI",
        weight: 1,
        score: 50,
        signalScore: 50,
        llmScore: 50,
        summary: "s",
        evidence: cols.dimEvidence === undefined ? "[]" : cols.dimEvidence,
        strengths: "[]",
        gaps: "[]",
      },
    ],
    recommendations: [
      {
        title: "Add CI",
        dimId: "ci",
        impact: "high",
        effort: "medium",
        rationale: "because",
        explore: cols.recExplore === undefined ? "[]" : cols.recExplore,
        levelUnlock: null,
        createdAt: new Date("2026-06-18T00:00:00.000Z"),
      },
    ],
  };

  return {
    repository: {
      findUnique: vi.fn(async () => ({
        id: "repo_1",
        owner: "acme",
        name: "widget",
        url: "https://github.com/acme/widget",
        stars: 5,
        primaryLanguage: "TypeScript",
        isPrivate: false,
        contributors: [],
      })),
    },
    scan: { findFirst: vi.fn(async () => scan) },
  };
}

/** Run getScanReportByCommit against crafted columns and return the reconstructed report (non-null). */
async function reportWith(cols: Parameters<typeof fakePrismaWithColumns>[0]) {
  mockGetPrisma.mockReturnValue(fakePrismaWithColumns(cols));
  const report = await getScanReportByCommit("acme", "widget", { headSha: "sha_abc" });
  expect(report).not.toBeNull();
  return report!;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
});

// ── parseStringArray (report.strengths / risks / dimension.evidence / roadmap.explore) ─────────────

describe("getScanReportByCommit — parseStringArray resilience", () => {
  it("well-formed string array parses through unchanged", async () => {
    const r = await reportWith({ strengths: JSON.stringify(["a", "b", "c"]) });
    expect(r.strengths).toEqual(["a", "b", "c"]);
  });

  it("drops non-string entries (numbers, null, objects) from a mixed array", async () => {
    const r = await reportWith({ strengths: '["a", 1, "b", null, {"x":1}, "c"]' });
    expect(r.strengths).toEqual(["a", "b", "c"]);
  });

  it("a stored OBJECT (wrong type, not an array) defaults to [] (never throws)", async () => {
    const r = await reportWith({ strengths: '{"not":"an array"}' });
    expect(r.strengths).toEqual([]);
  });

  it("malformed JSON defaults to [] (caught, report still renders)", async () => {
    const r = await reportWith({ risks: '["unterminated' });
    expect(r.risks).toEqual([]);
  });

  it("null and empty-string columns default to []", async () => {
    const rNull = await reportWith({ strengths: null });
    expect(rNull.strengths).toEqual([]);
    const rEmpty = await reportWith({ strengths: "" });
    expect(rEmpty.strengths).toEqual([]);
  });

  it("guards nested array fields too: dimension.evidence and roadmap.explore", async () => {
    const r = await reportWith({
      dimEvidence: '["ev", 7, "ev2"]', // non-string dropped
      recExplore: "{not json", // malformed → []
    });
    expect(r.dimensions[0].evidence).toEqual(["ev", "ev2"]);
    expect(r.roadmap[0].explore).toEqual([]);
  });
});

// ── parseJsonObject (report.prStats / governance) — array/scalar must NOT be blind-cast ────────────

describe("getScanReportByCommit — parseJsonObject resilience", () => {
  it("a well-formed object parses to that object", async () => {
    const r = await reportWith({ prStats: '{"open":3,"merged":10}' });
    expect(r.prStats).toEqual({ open: 3, merged: 10 });
  });

  it("a stored ARRAY is REJECTED → null (cannot reach charts as a fake object)", async () => {
    const r = await reportWith({ prStats: "[1,2,3]" });
    expect(r.prStats).toBeNull();
  });

  it("a stored scalar (number / string / JSON null) is rejected → null", async () => {
    expect((await reportWith({ governance: "5" })).governance).toBeNull();
    expect((await reportWith({ governance: '"a string"' })).governance).toBeNull();
    expect((await reportWith({ governance: "null" })).governance).toBeNull();
  });

  it("malformed JSON and null/missing columns default to null (never throws)", async () => {
    expect((await reportWith({ prStats: "{oops" })).prStats).toBeNull();
    expect((await reportWith({ prStats: null })).prStats).toBeNull();
  });
});

// ── parseNumberArray (report.commitActivity — the sparkline) — non-array→null, non-finite dropped ──

describe("getScanReportByCommit — parseNumberArray resilience", () => {
  it("a well-formed number array parses through (including floats)", async () => {
    const r = await reportWith({ commitActivity: "[1, 2.5, 3, 0]" });
    expect(r.commitActivity).toEqual([1, 2.5, 3, 0]);
  });

  it("drops non-number entries (strings, null, objects) — no NaN-positioned SVG point", async () => {
    const r = await reportWith({ commitActivity: '[1, "x", 2, null, {"a":1}, 3]' });
    expect(r.commitActivity).toEqual([1, 2, 3]);
  });

  it("drops NON-FINITE numbers: 1e400 parses to Infinity and is filtered out", async () => {
    // valid JSON that parses to a non-finite number → reaches the Number.isFinite drop path
    const r = await reportWith({ commitActivity: "[1, 1e400, 2]" });
    expect(r.commitActivity).toEqual([1, 2]);
  });

  it("a literal NaN token is INVALID JSON → JSON.parse throws → null (not [1,2])", async () => {
    // Pins real JS semantics over the finding's mistaken example.
    const r = await reportWith({ commitActivity: '[1, "x", NaN, 2]' });
    expect(r.commitActivity).toBeNull();
  });

  it("a stored OBJECT (non-array) returns null — distinct from [] so callers can branch", async () => {
    const r = await reportWith({ commitActivity: '{"a":1}' });
    expect(r.commitActivity).toBeNull();
  });

  it("empty array stays [], while null/malformed columns return null (never throws)", async () => {
    expect((await reportWith({ commitActivity: "[]" })).commitActivity).toEqual([]);
    expect((await reportWith({ commitActivity: null })).commitActivity).toBeNull();
    expect((await reportWith({ commitActivity: "[1,2" })).commitActivity).toBeNull();
  });
});

// ── parseDiscrepancies (report.discrepancies) — drops rows missing dimension/claim ────────────────

describe("getScanReportByCommit — parseDiscrepancies resilience", () => {
  it("keeps only well-formed {dimension, claim} rows, dropping malformed ones", async () => {
    const r = await reportWith({
      discrepancies: JSON.stringify([
        { dimension: "ci", claim: "tests claimed but absent" }, // keep
        { dimension: "ci" }, // missing claim → drop
        { claim: "no dimension" }, // missing dimension → drop
        null, // not an object → drop
        5, // not an object → drop
        { dimension: 7, claim: "wrong type" }, // dimension non-string → drop
      ]),
    });
    expect(r.discrepancies).toEqual([{ dimension: "ci", claim: "tests claimed but absent" }]);
  });

  it("a non-array stored value defaults to [] (never throws)", async () => {
    const r = await reportWith({ discrepancies: '{"dimension":"ci","claim":"c"}' });
    expect(r.discrepancies).toEqual([]);
  });

  it("malformed JSON and null columns default to [] (report still renders)", async () => {
    expect((await reportWith({ discrepancies: "[{oops" })).discrepancies).toEqual([]);
    expect((await reportWith({ discrepancies: null })).discrepancies).toEqual([]);
  });
});

// ── Pinned posture is FROZEN: read the stored column, don't recompute (scan-persistence-history #3) ──
//
// A `/report/{owner}/{repo}@{sha}` permalink is a supposedly-immutable snapshot. `posture` must be
// reconstructed from the persisted `scan.posture` column (the classification the scan recorded), NOT
// recomputed via postureFor(adoption, rigor) under today's POSTURE_THRESHOLD — otherwise tuning the
// maturity model silently re-postures every old pinned report, and the report view disagrees with the
// comparison view (which already reads the stored column).

describe("getScanReportByCommit — pinned posture reads the stored column (not a recompute)", () => {
  it("reads the stored posture id, even when it disagrees with postureFor(adoption, rigor)", async () => {
    // adoption=60, rigor=80 → postureFor would say 'ai-native'; the stored column says 'manual'. The
    // reconstruction must reproduce the FROZEN stored classification, proving it doesn't recompute.
    const r = await reportWith({ posture: "manual" });
    expect(r.posture.id).toBe("manual");
  });

  it("falls back to postureFor only for a legacy/corrupt row with no recognized posture id", async () => {
    const r = await reportWith({ posture: "" }); // unrecognized id → fallback recompute
    expect(r.posture.id).toBe("ai-native"); // postureFor(60,80): both axes ≥ threshold
  });
});

// ── The unifying invariant across every helper: TOTAL on garbage, the report ALWAYS rebuilds ──────

describe("getScanReportByCommit — corrupt-row resilience (the load-bearing invariant)", () => {
  it("a row whose EVERY parsed JSON column is corrupt still reconstructs without throwing", async () => {
    const r = await reportWith({
      strengths: "{not json",
      risks: "[1,2", // malformed
      prStats: "[1,2,3]", // array, not object
      governance: '"scalar"',
      commitActivity: '{"a":1}', // object, not array
      discrepancies: "5", // not an array
      dimEvidence: "}}}",
      recExplore: "[true,false", // malformed
    });
    // Each helper fell back to its documented default — nothing crashed the render.
    expect(r.strengths).toEqual([]);
    expect(r.risks).toEqual([]);
    expect(r.prStats).toBeNull();
    expect(r.governance).toBeNull();
    expect(r.commitActivity).toBeNull();
    expect(r.discrepancies).toEqual([]);
    expect(r.dimensions[0].evidence).toEqual([]);
    expect(r.roadmap[0].explore).toEqual([]);
    // The surrounding report still assembled with its non-JSON fields intact.
    expect(r.overallScore).toBe(70);
    expect(r.headline).toBe("ok");
  });
});

// ── getLatestRecommendations — the public-org private-repo guard (defense in depth) ───────────────
// getRepositoryHistory, getScanComparison, and getScanReportByCommit all refuse to serve a PRIVATE
// repo's data out of the shared public org (the anonymous read surface); getLatestRecommendations was
// the fourth public-org reader and shipped without the guard — serving roadmap titles, rationales
// (which can quote private code/evidence), assignee logins, and target dates for a legacy private row
// persisted under the public org. These tests pin the guard so it can't be dropped a second time.

describe("getLatestRecommendations — public-org private-repo guard", () => {
  function prismaWithRepo(isPrivate: boolean) {
    const base = fakePrismaWithColumns({});
    const repo = {
      id: "repo_1",
      owner: "acme",
      name: "widget",
      url: "https://github.com/acme/widget",
      stars: 5,
      primaryLanguage: "TypeScript",
      isPrivate,
      contributors: [],
    };
    base.repository.findUnique = vi.fn(async () => repo);
    return base;
  }

  it("returns null and never reads the scan when the repo is PRIVATE under the shared public org", async () => {
    const prisma = prismaWithRepo(true);
    mockGetPrisma.mockReturnValue(prisma);

    // No orgSlug → defaults to DEFAULT_ORG_SLUG ("public"), the anonymous read surface.
    const res = await getLatestRecommendations("acme", "widget");

    expect(res).toBeNull();
    // Fail closed BEFORE the scan/recommendations read — no roadmap bytes are even fetched.
    expect(prisma.scan.findFirst).not.toHaveBeenCalled();
  });

  it("still serves the roadmap for a public repo under the public org (guard is private-only)", async () => {
    const prisma = prismaWithRepo(false);
    mockGetPrisma.mockReturnValue(prisma);

    const res = await getLatestRecommendations("acme", "widget");

    expect(res).not.toBeNull();
    expect(res!.scanId).toBe("scan_1");
    expect(prisma.scan.findFirst).toHaveBeenCalledTimes(1);
  });

  it("still serves a PRIVATE repo under a member-scoped (non-public) org", async () => {
    const prisma = prismaWithRepo(true);
    mockGetPrisma.mockReturnValue(prisma);

    const res = await getLatestRecommendations("acme", "widget", { orgSlug: "acme-corp" });

    expect(res).not.toBeNull();
    expect(prisma.scan.findFirst).toHaveBeenCalledTimes(1);
  });
});

// ── DB-down degrade parity (scan-persistence-history 07-16 #4) ────────────────────────────────────
// A configured-but-UNREACHABLE DB (PrismaClientInitializationError at connect) must degrade these
// readers to null — the same "no data" fallback their callers already render — instead of 500ing the
// report/history/comparison pages while the landing page degrades gracefully. The dbReadSafe mock at
// the top of this file re-throws anything that isn't the unreachable class, so these tests fail
// against unwrapped (raw getPrisma) readers.

describe("DB-down degrade — readers wrapped in dbReadSafe", () => {
  function unreachablePrisma() {
    const boom = Object.assign(new Error("Can't reach database server at localhost:5432"), {
      name: "PrismaClientInitializationError",
    });
    return {
      repository: {
        findUnique: vi.fn(async () => {
          throw boom;
        }),
      },
      scan: { findFirst: vi.fn() },
    };
  }

  beforeEach(() => {
    mockIsDbConfigured.mockReturnValue(true);
  });

  it("getScanReportByCommit returns null (report permalink renders its fallback, no 500)", async () => {
    mockGetPrisma.mockReturnValue(unreachablePrisma());
    await expect(getScanReportByCommit("acme", "widget")).resolves.toBeNull();
  });

  it("getLatestRecommendations returns null on a DB-down", async () => {
    mockGetPrisma.mockReturnValue(unreachablePrisma());
    await expect(getLatestRecommendations("acme", "widget")).resolves.toBeNull();
  });

  it("a LIVE-DB query error still propagates (dbReadSafe only swallows the unreachable class)", async () => {
    const prisma = unreachablePrisma();
    prisma.repository.findUnique = vi.fn(async () => {
      throw new Error("column does not exist");
    });
    mockGetPrisma.mockReturnValue(prisma);
    await expect(getScanReportByCommit("acme", "widget")).rejects.toThrow("column does not exist");
  });
});

// ── G3-01: sha-less dedup keys on CONTENT, not bare timestamp equality ────────────────────────────
//
// A sha-less report has no commit to dedup on, so persist matched the report's own `scannedAt`. Exact
// equality on a high-precision timestamp is a proxy for "the same computed report" that fails BOTH
// ways: two genuinely different results computed in the same millisecond collided (the second was
// silently dropped), and a reused/replayed clock value could suppress a legitimate re-score. The
// timestamp is now only the narrowing step; findScanByScannedAt returns a CONTENT key the persist path
// compares before it reuses a row.
describe("scanContentKey / findScanByScannedAt — content identity for sha-less dedup", () => {
  const base = {
    overallScore: 70,
    level: "L3",
    adoptionScore: 60,
    rigorScore: 80,
    engineProvider: "anthropic",
    engineModel: "claude",
    dimensions: [
      { dimId: "D2", score: 55 },
      { dimId: "D1", score: 90 },
    ],
  };

  it("is STABLE across dimension ordering (detector/LLM emission order must not change identity)", () => {
    const reversed = { ...base, dimensions: [...base.dimensions].reverse() };
    expect(scanContentKey(reversed)).toBe(scanContentKey(base));
  });

  it("CHANGES when the headline score changes", () => {
    expect(scanContentKey({ ...base, overallScore: 71 })).not.toBe(scanContentKey(base));
  });

  it("CHANGES when only a per-dimension score changes (a same-headline, different-detail result)", () => {
    const drifted = { ...base, dimensions: [{ dimId: "D2", score: 55 }, { dimId: "D1", score: 89 }] };
    expect(scanContentKey(drifted)).not.toBe(scanContentKey(base));
  });

  it("CHANGES when the engine that produced it changes (mock floor vs a live grade)", () => {
    expect(scanContentKey({ ...base, engineProvider: "mock" })).not.toBe(scanContentKey(base));
  });

  it("findScanByScannedAt derives the key from the persisted row (same builder, so both sides agree)", async () => {
    const findFirst = vi.fn(async () => ({
      id: "scan_1",
      engineProvider: "anthropic",
      engineModel: "claude",
      overallScore: 70,
      level: "L3",
      adoptionScore: 60,
      rigorScore: 80,
      dimensions: [{ dimId: "D1", score: 90 }, { dimId: "D2", score: 55 }],
    }));
    mockGetPrisma.mockReturnValue({ scan: { findFirst } });

    const at = new Date("2026-06-18T00:00:00.000Z");
    const row = await findScanByScannedAt("repo_1", at);

    expect(row).toEqual({ id: "scan_1", engineProvider: "anthropic", contentKey: scanContentKey(base) });
    // Still narrowed by (repoId, exact scannedAt) with a deterministic tie-break — the cheap indexed step.
    const args = findFirst.mock.calls[0][0] as { where: unknown; orderBy: unknown };
    expect(args.where).toEqual({ repoId: "repo_1", scannedAt: at });
    expect(args.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
  });

  it("returns null when no row shares the timestamp, and when persistence is off", async () => {
    mockGetPrisma.mockReturnValue({ scan: { findFirst: vi.fn(async () => null) } });
    await expect(findScanByScannedAt("repo_1", new Date())).resolves.toBeNull();

    mockIsDbConfigured.mockReturnValue(false);
    await expect(findScanByScannedAt("repo_1", new Date())).resolves.toBeNull();
    mockIsDbConfigured.mockReturnValue(true);
  });
});

// ── scanDedupKey / findScanByDedupKey — the CROSS-INSTANCE half of sha-less dedup (G3-01) ────────
//
// scanContentKey answers "is this the same computed report?" in memory. It cannot stop two serverless
// instances that BOTH read "nothing there yet" from both inserting, because @@unique([repoId, headSha])
// never engages on a NULL headSha (NULLs are distinct in Postgres). scanDedupKey is the value that gets
// PERSISTED and constrained, so the database itself rejects the second insert.
describe("scanDedupKey — persisted idempotency identity for sha-less scans", () => {
  const at = new Date("2026-06-18T09:30:00.000Z");
  const contentKey = "70|L3|60|80|anthropic|claude|D1:90,D2:55";

  it("is DETERMINISTIC: the same (scannedAt, content) always yields the same key", () => {
    expect(scanDedupKey(at, contentKey)).toBe(scanDedupKey(new Date(at.getTime()), contentKey));
  });

  it("CHANGES when the content changes at the same instant (two distinct same-ms results, both kept)", () => {
    // This is the collision the timestamp-only dedup used to silently drop. Different key ⇒ no unique
    // violation ⇒ both rows persist, which is the correct outcome.
    expect(scanDedupKey(at, `${contentKey.slice(0, -1)}6`)).not.toBe(scanDedupKey(at, contentKey));
  });

  it("CHANGES when the instant changes with identical content (a genuine later re-score is not suppressed)", () => {
    expect(scanDedupKey(new Date(at.getTime() + 1), contentKey)).not.toBe(scanDedupKey(at, contentKey));
  });

  it("is a bounded, versioned token — it lives in a UNIQUE INDEX, so its length must not grow with the report", () => {
    const short = scanDedupKey(at, "a");
    const long = scanDedupKey(at, "x".repeat(50_000));
    expect(short).toMatch(/^v1:[0-9a-f]{64}$/);
    expect(long).toHaveLength(short.length);
  });

  it("never throws on an invalid Date (a malformed scannedAt must not break the persist path)", () => {
    expect(() => scanDedupKey(new Date("nope"), contentKey)).not.toThrow();
    expect(scanDedupKey(new Date("nope"), contentKey)).toMatch(/^v1:[0-9a-f]{64}$/);
  });

  it("findScanByDedupKey recovers the race WINNER by (repoId, dedupKey) — the P2002 recovery read", () => {
    const findFirst = vi.fn(async () => ({ id: "scan_winner" }));
    mockGetPrisma.mockReturnValue({ scan: { findFirst } });

    return findScanByDedupKey("repo_1", "v1:abc").then((row) => {
      expect(row).toEqual({ id: "scan_winner" });
      const args = findFirst.mock.calls[0][0] as { where: unknown };
      expect(args.where).toEqual({ repoId: "repo_1", dedupKey: "v1:abc" });
    });
  });

  it("returns null when nothing matches, and when persistence is off", async () => {
    mockGetPrisma.mockReturnValue({ scan: { findFirst: vi.fn(async () => null) } });
    await expect(findScanByDedupKey("repo_1", "v1:abc")).resolves.toBeNull();

    mockIsDbConfigured.mockReturnValue(false);
    await expect(findScanByDedupKey("repo_1", "v1:abc")).resolves.toBeNull();
    mockIsDbConfigured.mockReturnValue(true);
  });
});
