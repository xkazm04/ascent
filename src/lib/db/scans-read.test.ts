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
  // Not used by getScanReportByCommit, but the module imports it at top level.
  dbReadSafe: <T,>(fn: () => Promise<T>) => fn(),
}));

// resolveOrgId is the only scans-shared seam getScanReportByCommit needs to reach the scan row;
// the rest are kept real-ish but inert (reconstruction never calls toPersistedRec on this path).
vi.mock("@/lib/db/scans-shared", () => ({
  DEFAULT_ORG_SLUG: "public",
  canonicalRepoFullName: (owner: string, name: string) => `${owner.trim().toLowerCase()}/${name.trim().toLowerCase()}`,
  resolveOrgId: vi.fn(async () => "org_1"),
  toPersistedRec: vi.fn(),
  // parseStringArray now lives in scans-shared (the dependency sink) and scans-read imports it from
  // here; provide the REAL implementation so the resilience assertions below exercise it unchanged.
  parseStringArray: (s: string | null | undefined): string[] => {
    if (!s) return [];
    try {
      const p = JSON.parse(s);
      return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  },
}));

import { getScanReportByCommit } from "./scans-read";

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
}) {
  const scan = {
    id: "scan_1",
    headSha: "sha_abc",
    overallScore: 70,
    level: "L3",
    archetype: "app",
    adoptionScore: 60,
    rigorScore: 80,
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
