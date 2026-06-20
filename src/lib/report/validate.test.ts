import { describe, it, expect } from "vitest";
import { parseScanReport, parseRepositoryHistory } from "./validate";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A minimal-but-complete payload that satisfies every guard in parseScanReport.
 * Only the fields the validator actually dereferences are pinned; production
 * ScanReport has more, but the trust boundary checks exactly these. */
function validReport(): Record<string, unknown> {
  return {
    repo: { owner: "acme", name: "app", url: "https://github.com/acme/app", stars: 42 },
    level: { id: "L3", name: "Practicing", description: "desc" },
    posture: { label: "AI-native", blurb: "blurb" },
    engine: { provider: "anthropic", model: "claude" },
    aiUsage: { detected: true, commitFraction: 0.3 },
    overallScore: 71,
    adoptionScore: 60,
    rigorScore: 80,
    confidence: 0.9,
    headline: "A solid repo",
    archetype: "product",
    scannedAt: "2026-06-18T00:00:00.000Z",
    strengths: ["s1"],
    risks: ["r1"],
    dimensions: [
      {
        id: "D1",
        name: "Dim One",
        score: 70,
        signalScore: 65,
        llmScore: 75,
        weight: 0.2,
        summary: "ok",
        evidence: ["e1"],
        strengths: ["ds1"],
        gaps: ["g1"],
      },
    ],
    contributors: [{ login: "alice", commits: 10, aiCommits: 3 }],
    roadmap: [{ title: "Do X", dimension: "D1", impact: "high", effort: "low" }],
    discrepancies: [],
  };
}

/** Deep-ish clone so a mutation in one case never bleeds into another. */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

// ---------------------------------------------------------------------------
// parseScanReport — success path
// ---------------------------------------------------------------------------

describe("parseScanReport — valid", () => {
  it("parses a well-formed report to { ok: true } with the value intact", () => {
    const input = validReport();
    const result = parseScanReport(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The value is passed through unchanged (same reference, not a copy).
      expect(result.report).toBe(input as unknown);
      expect(result.report.overallScore).toBe(71);
      expect(result.report.dimensions).toHaveLength(1);
    }
  });

  it("tolerates extra/unknown top-level fields (passthrough, not stripped)", () => {
    const input = validReport();
    (input as Record<string, unknown>).somethingNew = { a: 1 };
    (input as Record<string, unknown>).warnings = ["caveat"];
    const result = parseScanReport(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Unknown fields survive — the validator returns the original object by reference.
      expect((result.report as unknown as Record<string, unknown>).somethingNew).toEqual({ a: 1 });
    }
  });
});

// ---------------------------------------------------------------------------
// parseScanReport — non-object / channel-error inputs (no white-screen)
// ---------------------------------------------------------------------------

describe("parseScanReport — non-object inputs never throw", () => {
  for (const [label, input] of [
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["a number", 42],
    ["a boolean", true],
    ["an array", [1, 2, 3]],
  ] as const) {
    it(`${label} → { ok: false } with the generic message, no throw`, () => {
      let result: ReturnType<typeof parseScanReport>;
      expect(() => {
        result = parseScanReport(input);
      }).not.toThrow();
      expect(result!.ok).toBe(false);
      if (!result!.ok) expect(result!.error).toBe("The scan returned an unexpected response.");
    });
  }

  it("surfaces an { error } channel message verbatim", () => {
    const result = parseScanReport({ error: "boom from the engine" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("boom from the engine");
  });
});

// ---------------------------------------------------------------------------
// parseScanReport — one corrupted REQUIRED field per case → { ok: false }
// Table-driven: mutate exactly one field, assert the specific guard message.
// ---------------------------------------------------------------------------

type Mutate = (r: Record<string, unknown>) => void;

const failureCases: Array<[string, Mutate, string]> = [
  // repo block
  ["repo missing", (r) => delete r.repo, "The report is missing repository details."],
  ["repo not an object", (r) => (r.repo = "x"), "The report is missing repository details."],
  ["repo.owner non-string", (r) => ((r.repo as Record<string, unknown>).owner = 1), "The report's repository info is incomplete."],
  ["repo.name missing", (r) => delete (r.repo as Record<string, unknown>).name, "The report's repository info is incomplete."],
  ["repo.url non-string", (r) => ((r.repo as Record<string, unknown>).url = null), "The report's repository info is incomplete."],
  ["repo.stars non-number (null)", (r) => ((r.repo as Record<string, unknown>).stars = null), "The report's repository stats are malformed."],
  ["repo.stars non-number (string)", (r) => ((r.repo as Record<string, unknown>).stars = "42"), "The report's repository stats are malformed."],
  ["repo.stars NaN", (r) => ((r.repo as Record<string, unknown>).stars = NaN), "The report's repository stats are malformed."],

  // level / posture / engine / aiUsage
  ["level missing", (r) => delete r.level, "The report's maturity level is malformed."],
  ["level.id missing", (r) => delete (r.level as Record<string, unknown>).id, "The report's maturity level is malformed."],
  ["level.name non-string", (r) => ((r.level as Record<string, unknown>).name = 3), "The report's maturity level is malformed."],
  ["posture missing", (r) => delete r.posture, "The report's posture is malformed."],
  ["posture.blurb non-string", (r) => ((r.posture as Record<string, unknown>).blurb = 7), "The report's posture is malformed."],
  ["engine missing", (r) => delete r.engine, "The report's engine info is malformed."],
  ["engine.provider non-string", (r) => ((r.engine as Record<string, unknown>).provider = 0), "The report's engine info is malformed."],
  ["engine.model missing", (r) => delete (r.engine as Record<string, unknown>).model, "The report's engine info is malformed."],
  ["aiUsage missing", (r) => delete r.aiUsage, "The report's AI-usage summary is malformed."],
  ["aiUsage.detected non-boolean", (r) => ((r.aiUsage as Record<string, unknown>).detected = "yes"), "The report's AI-usage summary is malformed."],
  ["aiUsage.commitFraction non-number", (r) => ((r.aiUsage as Record<string, unknown>).commitFraction = "0.3"), "The report's AI-usage summary is malformed."],

  // scores
  ["overallScore non-number (string)", (r) => (r.overallScore = "71"), "The report's scores are malformed."],
  ["adoptionScore missing", (r) => delete r.adoptionScore, "The report's scores are malformed."],
  ["rigorScore NaN", (r) => (r.rigorScore = NaN), "The report's scores are malformed."],
  ["confidence non-number", (r) => (r.confidence = null), "The report's scores are malformed."],

  // summary fields
  ["headline non-string", (r) => (r.headline = 1), "The report's summary fields are malformed."],
  ["archetype missing", (r) => delete r.archetype, "The report's summary fields are malformed."],
  ["scannedAt non-string", (r) => (r.scannedAt = 1234), "The report's summary fields are malformed."],

  // strengths / risks
  ["strengths not a string[]", (r) => (r.strengths = [1, 2]), "The report's strengths/risks are malformed."],
  ["risks missing", (r) => delete r.risks, "The report's strengths/risks are malformed."],

  // dimensions
  ["dimensions not an array", (r) => (r.dimensions = "x"), "The report has no dimension scores."],
  ["dimensions empty", (r) => (r.dimensions = []), "The report has no dimension scores."],
  ["dimension entry not an object", (r) => (r.dimensions = ["x"]), "A dimension score is malformed."],
  ["dimension missing evidence", (r) => delete (r.dimensions as Record<string, unknown>[])[0].evidence, "A dimension score is malformed."],
  ["dimension.score non-number", (r) => ((r.dimensions as Record<string, unknown>[])[0].score = "70"), "A dimension score is malformed."],
  ["dimension.gaps not string[]", (r) => ((r.dimensions as Record<string, unknown>[])[0].gaps = [1]), "A dimension score is malformed."],

  // contributors
  ["contributors not an array", (r) => (r.contributors = {}), "The report's contributors are malformed."],
  ["contributor missing login", (r) => delete (r.contributors as Record<string, unknown>[])[0].login, "A contributor entry is malformed."],
  ["contributor.commits non-number", (r) => ((r.contributors as Record<string, unknown>[])[0].commits = "10"), "A contributor entry is malformed."],

  // roadmap
  ["roadmap not an array", (r) => (r.roadmap = null), "The report's roadmap is malformed."],
  ["roadmap item missing impact", (r) => delete (r.roadmap as Record<string, unknown>[])[0].impact, "A roadmap item is malformed."],

  // discrepancies
  ["discrepancies not an array", (r) => (r.discrepancies = "x"), "The report's discrepancies are malformed."],
];

describe("parseScanReport — each corrupted required field fails with its message (never throws)", () => {
  for (const [label, mutate, message] of failureCases) {
    it(`${label} → { ok: false, error }`, () => {
      const input = clone(validReport());
      mutate(input);
      let result: ReturnType<typeof parseScanReport>;
      expect(() => {
        result = parseScanReport(input);
      }).not.toThrow();
      expect(result!.ok).toBe(false);
      if (!result!.ok) expect(result!.error).toBe(message);
    });
  }
});

// ---------------------------------------------------------------------------
// parseRepositoryHistory — always returns a well-formed object, never throws
// ---------------------------------------------------------------------------

function validHistoryPoint(): Record<string, unknown> {
  return {
    id: "scan_1",
    headSha: "abc123",
    overallScore: 70,
    level: "L3",
    levelName: "Practicing",
    confidence: 0.8,
    engineProvider: "anthropic",
    engineModel: "claude-3-7",
    scannedAt: "2026-06-18T00:00:00.000Z",
    dimensions: [{ dimId: "D1", score: 70 }],
  };
}

describe("parseRepositoryHistory — junk input is coerced, never throws", () => {
  const EMPTY = { repo: { owner: "", name: "", fullName: "" }, scans: [] };

  for (const [label, input] of [
    ["null", null],
    ["undefined", undefined],
    ["a number", 42],
    ["empty string", ""],
    ["an array", []],
    ["scans not an array", { scans: "x" }],
    ["empty object", {}],
  ] as const) {
    it(`${label} → empty well-formed history`, () => {
      let result: ReturnType<typeof parseRepositoryHistory>;
      expect(() => {
        result = parseRepositoryHistory(input);
      }).not.toThrow();
      expect(result!).toEqual(EMPTY);
    });
  }

  it("coerces a partial repo object, defaulting missing string fields to ''", () => {
    const result = parseRepositoryHistory({ repo: { owner: "acme", name: 123 }, scans: [] });
    expect(result.repo).toEqual({ owner: "acme", name: "", fullName: "" });
  });

  it("keeps a fully valid point intact", () => {
    const pt = validHistoryPoint();
    const result = parseRepositoryHistory({
      repo: { owner: "acme", name: "app", fullName: "acme/app" },
      scans: [pt],
    });
    expect(result.repo).toEqual({ owner: "acme", name: "app", fullName: "acme/app" });
    expect(result.scans).toHaveLength(1);
    expect(result.scans[0]).toEqual({
      id: "scan_1",
      headSha: "abc123",
      overallScore: 70,
      level: "L3",
      levelName: "Practicing",
      confidence: 0.8,
      engineProvider: "anthropic",
      engineModel: "claude-3-7",
      scannedAt: "2026-06-18T00:00:00.000Z",
      dimensions: [{ dimId: "D1", score: 70 }],
    });
  });

  it("drops a point with a non-numeric overallScore but keeps valid ones, preserving order", () => {
    const good1 = { ...validHistoryPoint(), id: "good1" };
    const bad = { ...validHistoryPoint(), id: "bad", overallScore: "40" };
    const good2 = { ...validHistoryPoint(), id: "good2" };
    const result = parseRepositoryHistory({ scans: [good1, bad, good2] });
    expect(result.scans.map((s) => s.id)).toEqual(["good1", "good2"]);
    for (const s of result.scans) expect(Number.isFinite(s.overallScore)).toBe(true);
  });

  it("drops a point whose scannedAt is unparseable (Date.parse → NaN)", () => {
    const bad = { ...validHistoryPoint(), id: "bad", scannedAt: "not-a-date" };
    const good = { ...validHistoryPoint(), id: "good" };
    const result = parseRepositoryHistory({ scans: [bad, good] });
    expect(result.scans.map((s) => s.id)).toEqual(["good"]);
    for (const s of result.scans) expect(Number.isNaN(Date.parse(s.scannedAt))).toBe(false);
  });

  it("drops a point missing scannedAt entirely", () => {
    const bad = { ...validHistoryPoint() };
    delete (bad as Record<string, unknown>).scannedAt;
    const result = parseRepositoryHistory({ scans: [bad] });
    expect(result.scans).toHaveLength(0);
  });

  it("within a retained point, drops only the malformed dimension entries", () => {
    const pt = {
      ...validHistoryPoint(),
      dimensions: [
        { dimId: "D1", score: 70 }, // good
        { dimId: "D2" }, // missing score → dropped
        { score: 50 }, // missing dimId → dropped
        { dimId: "D3", score: "60" }, // non-numeric score → dropped
        "garbage", // not an object → dropped
      ],
    };
    const result = parseRepositoryHistory({ scans: [pt] });
    expect(result.scans).toHaveLength(1);
    expect(result.scans[0].dimensions).toEqual([{ dimId: "D1", score: 70 }]);
  });

  it("coerces optional string fields of a retained point to safe defaults", () => {
    const pt = {
      overallScore: 55,
      scannedAt: "2026-06-18T00:00:00.000Z",
      // everything else missing / wrong type
      id: 5,
      headSha: 9,
      level: null,
      levelName: undefined,
      confidence: "high",
      engineProvider: 1,
      dimensions: "not-an-array",
    };
    const result = parseRepositoryHistory({ scans: [pt] });
    expect(result.scans).toHaveLength(1);
    expect(result.scans[0]).toEqual({
      id: "",
      headSha: null,
      overallScore: 55,
      level: "",
      levelName: "",
      confidence: 0,
      engineProvider: "",
      engineModel: "",
      scannedAt: "2026-06-18T00:00:00.000Z",
      dimensions: [],
    });
  });
});
