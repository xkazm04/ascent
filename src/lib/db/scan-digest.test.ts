// The PURE half of retention compaction: bucketing, grouping, the exactness of the merge, the
// "unknown" rubric sentinel, and the honest-null dimension rule. No DB, no clock.

import { describe, expect, it } from "vitest";
import {
  digestPeriod,
  digestScans,
  digestToPoint,
  mergeDigest,
  monthsBefore,
  resolveCompaction,
  toDigestRow,
  UNKNOWN_RUBRIC,
  type DigestInputScan,
  type ScanDigestRow,
} from "@/lib/db/scan-digest";

function scan(over: Partial<DigestInputScan> & { id: string; scannedAt: string }): DigestInputScan {
  return {
    headSha: `sha_${over.id}`,
    overallScore: 60,
    adoptionScore: 55,
    rigorScore: 65,
    confidence: 0.8,
    level: "L3",
    levelName: "Practicing",
    posture: "balanced",
    rubricVersion: "r9",
    engineProvider: "bedrock",
    engineModel: "sonnet",
    dimensions: [{ dimId: "D1", score: 70, signalScore: 60, llmScore: 80 }],
    recsOpened: 2,
    recsClosed: 1,
    ...over,
    scannedAt: new Date(over.scannedAt),
  };
}

/** A stored row equivalent to a draft, so a second page can be merged onto a "persisted" first. */
function storedFrom(draftIndex: number, drafts: ReturnType<typeof digestScans>): ScanDigestRow {
  const w = mergeDigest(null, drafts[draftIndex]!);
  return toDigestRow({
    id: `dg_${draftIndex}`,
    repoId: "repo_1",
    ...w,
  });
}

describe("digestPeriod", () => {
  it("buckets by UTC month, and a UTC month boundary splits the two sides", () => {
    // 23:30 on the last day of March UTC, and 00:30 on the first of April UTC.
    expect(digestPeriod(new Date("2026-03-31T23:30:00Z"))).toBe("2026-03");
    expect(digestPeriod(new Date("2026-04-01T00:30:00Z"))).toBe("2026-04");
  });

  it("pads single-digit months", () => {
    expect(digestPeriod(new Date("2026-01-15T12:00:00Z"))).toBe("2026-01");
  });
});

describe("digestScans — grouping", () => {
  it("splits one month into one draft per rubric version and per engine provider", () => {
    const drafts = digestScans([
      scan({ id: "a", scannedAt: "2026-03-02T00:00:00Z", rubricVersion: "r8" }),
      scan({ id: "b", scannedAt: "2026-03-09T00:00:00Z", rubricVersion: "r9" }),
      scan({ id: "c", scannedAt: "2026-03-16T00:00:00Z", rubricVersion: "r9", engineProvider: "gemini" }),
    ]);
    expect(drafts).toHaveLength(3);
    expect(drafts.map((d) => `${d.key.period}/${d.key.rubricVersion}/${d.key.engineProvider}`).sort()).toEqual([
      "2026-03/r8/bedrock",
      "2026-03/r9/bedrock",
      "2026-03/r9/gemini",
    ]);
  });

  it("folds a null rubricVersion into the 'unknown' sentinel — the key can never be null", () => {
    const [draft] = digestScans([scan({ id: "a", scannedAt: "2026-03-02T00:00:00Z", rubricVersion: null })]);
    expect(draft!.key.rubricVersion).toBe(UNKNOWN_RUBRIC);
  });

  it("advances *Last only forward and *first only backward, regardless of input order", () => {
    const drafts = digestScans([
      // Deliberately newest-first, the order the prune's `createdAt desc` page arrives in.
      scan({ id: "c", scannedAt: "2026-03-20T00:00:00Z", overallScore: 80, level: "L4", levelName: "Leading" }),
      scan({ id: "a", scannedAt: "2026-03-01T00:00:00Z", overallScore: 40 }),
      scan({ id: "b", scannedAt: "2026-03-10T00:00:00Z", overallScore: 60 }),
    ]);
    const d = drafts[0]!;
    expect(d.scanCount).toBe(3);
    expect(d.overallSum).toBe(180);
    expect(d.overallMin).toBe(40);
    expect(d.overallMax).toBe(80);
    expect(d.overallLast).toBe(80);
    expect(d.levelLast).toBe("L4");
    expect(d.firstHeadSha).toBe("sha_a");
    expect(d.lastHeadSha).toBe("sha_c");
    expect(d.firstScannedAt.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(d.lastScannedAt.toISOString()).toBe("2026-03-20T00:00:00.000Z");
  });

  it("collects DISTINCT engine models", () => {
    const [d] = digestScans([
      scan({ id: "a", scannedAt: "2026-03-01T00:00:00Z", engineModel: "sonnet" }),
      scan({ id: "b", scannedAt: "2026-03-02T00:00:00Z", engineModel: "haiku" }),
      scan({ id: "c", scannedAt: "2026-03-03T00:00:00Z", engineModel: "sonnet" }),
    ]);
    expect(d!.engines).toEqual(["sonnet", "haiku"]);
  });
});

describe("digestScans — unknown ≠ 0", () => {
  it("emits no entry for a dimension no scan in the period carried", () => {
    const [d] = digestScans([
      scan({ id: "a", scannedAt: "2026-03-01T00:00:00Z", dimensions: [{ dimId: "D1", score: 70, signalScore: 60, llmScore: 80 }] }),
      scan({ id: "b", scannedAt: "2026-03-02T00:00:00Z", dimensions: [{ dimId: "D1", score: 50, signalScore: 40, llmScore: 60 }] }),
    ]);
    // FAIL-BEFORE: a `?? 0` default over the DIMENSIONS list would put D2..D9 in here at zero, and
    // the reader would draw a hard floor for a dimension that was never measured.
    expect(Object.keys(d!.dimensions)).toEqual(["D1"]);
    expect(d!.dimensions.D1).toEqual({ sum: 120, n: 2, last: 50, signalSum: 100, llmSum: 140 });
  });

  it("counts n per dimension, not per scan — a dimension present in only some scans keeps its own n", () => {
    const [d] = digestScans([
      scan({ id: "a", scannedAt: "2026-03-01T00:00:00Z", dimensions: [{ dimId: "D1", score: 70, signalScore: 0, llmScore: 0 }] }),
      scan({
        id: "b",
        scannedAt: "2026-03-02T00:00:00Z",
        dimensions: [
          { dimId: "D1", score: 90, signalScore: 0, llmScore: 0 },
          { dimId: "D2", score: 30, signalScore: 0, llmScore: 0 },
        ],
      }),
    ]);
    expect(d!.dimensions.D1!.n).toBe(2);
    expect(d!.dimensions.D2!.n).toBe(1);
    // The D2 MEAN is 30 (its one reading), NOT 15 (30 spread over both scans).
    expect(digestToPoint(storedFrom(0, [d!])).dimensions).toContainEqual({ dimId: "D2", score: 30 });
  });
});

describe("mergeDigest — exactness across pages", () => {
  it("two unequal pages fold to exactly the same row as one combined page", () => {
    const all = [
      scan({ id: "a", scannedAt: "2026-03-01T00:00:00Z", overallScore: 40, confidence: 0.5 }),
      scan({ id: "b", scannedAt: "2026-03-05T00:00:00Z", overallScore: 50, confidence: 0.6 }),
      scan({ id: "c", scannedAt: "2026-03-09T00:00:00Z", overallScore: 90, confidence: 0.9 }),
    ];
    const oneGo = mergeDigest(null, digestScans(all)[0]!);

    // Page 1 = the two OLDEST (2 rows), page 2 = the single newest (1 row) — deliberately unequal.
    const page1 = mergeDigest(null, digestScans(all.slice(0, 2))[0]!);
    const stored = toDigestRow({ id: "dg", repoId: "repo_1", ...page1 });
    const twoPages = mergeDigest(stored, digestScans(all.slice(2))[0]!);

    // FAIL-BEFORE: storing a MEAN and averaging the two pages gives (45 + 90) / 2 = 67.5 → 68, not
    // the true 60. Sums + scanCount make the two paths identical.
    expect(twoPages.overallSum).toBe(oneGo.overallSum);
    expect(twoPages.scanCount).toBe(oneGo.scanCount);
    expect(twoPages.overallSum / twoPages.scanCount).toBe(60);
    expect(twoPages.confidenceSum).toBeCloseTo(oneGo.confidenceSum, 10);
    expect(twoPages.overallMin).toBe(40);
    expect(twoPages.overallMax).toBe(90);
    expect(twoPages.overallLast).toBe(90);
  });

  it("is order-independent: folding the newer page first gives the same row", () => {
    const older = digestScans([
      scan({ id: "a", scannedAt: "2026-03-01T00:00:00Z", overallScore: 40 }),
      scan({ id: "b", scannedAt: "2026-03-05T00:00:00Z", overallScore: 50 }),
    ])[0]!;
    const newer = digestScans([
      scan({ id: "c", scannedAt: "2026-03-09T00:00:00Z", overallScore: 90, level: "L4", levelName: "Leading" }),
    ])[0]!;

    const forward = mergeDigest(toDigestRow({ id: "dg", repoId: "r", ...mergeDigest(null, older) }), newer);
    const backward = mergeDigest(toDigestRow({ id: "dg", repoId: "r", ...mergeDigest(null, newer) }), older);

    expect(backward.overallSum).toBe(forward.overallSum);
    expect(backward.scanCount).toBe(forward.scanCount);
    expect(backward.overallMin).toBe(forward.overallMin);
    expect(backward.overallMax).toBe(forward.overallMax);
    // `*Last` follows the timestamp, not the merge order.
    expect(backward.overallLast).toBe(90);
    expect(backward.levelLast).toBe("L4");
    expect(backward.lastScannedAt.toISOString()).toBe(forward.lastScannedAt.toISOString());
    expect(backward.firstScannedAt.toISOString()).toBe(forward.firstScannedAt.toISOString());
  });

  it("merges engine models and per-dimension folds without double counting", () => {
    const p1 = digestScans([
      scan({ id: "a", scannedAt: "2026-03-01T00:00:00Z", engineModel: "sonnet", dimensions: [{ dimId: "D1", score: 40, signalScore: 10, llmScore: 30 }] }),
    ])[0]!;
    const p2 = digestScans([
      scan({ id: "b", scannedAt: "2026-03-02T00:00:00Z", engineModel: "haiku", dimensions: [{ dimId: "D1", score: 60, signalScore: 20, llmScore: 40 }] }),
    ])[0]!;
    const merged = mergeDigest(toDigestRow({ id: "dg", repoId: "r", ...mergeDigest(null, p1) }), p2);
    expect(JSON.parse(merged.enginesJson)).toEqual(["sonnet", "haiku"]);
    expect(JSON.parse(merged.dimensionsJson).D1).toEqual({ sum: 100, n: 2, last: 60, signalSum: 30, llmSum: 70 });
  });
});

describe("digestToPoint — the wire shape", () => {
  const rows = digestScans([
    scan({ id: "a", scannedAt: "2026-03-01T00:00:00Z", overallScore: 40, confidence: 0.4 }),
    scan({ id: "b", scannedAt: "2026-03-09T00:00:00Z", overallScore: 61, confidence: 0.8, level: "L3", levelName: "Practicing" }),
  ]);

  it("carries the compaction label, a synthetic id, and NO permalink handle", () => {
    const p = digestToPoint(storedFrom(0, rows));
    expect(p.compacted).toBe(true);
    expect(p.id).toBe("digest:dg_0");
    // The Scan row is gone, so reportPermalink would 404 — the handle is withheld, not stale.
    expect(p.headSha).toBeNull();
    expect(p.scanCount).toBe(2);
    expect(p.scannedAt).toBe("2026-03-09T00:00:00.000Z"); // the period's LAST scan
    expect(p.overallScore).toBe(51); // round((40 + 61) / 2)
    expect(p.confidence).toBeCloseTo(0.6, 10);
  });

  it("maps the 'unknown' sentinel back to null — the sentinel never leaks as knowledge", () => {
    const unknown = digestScans([scan({ id: "a", scannedAt: "2026-03-01T00:00:00Z", rubricVersion: null })]);
    expect(digestToPoint(storedFrom(0, unknown)).rubricVersion).toBeNull();
    // A real stamp still rides through untouched.
    expect(digestToPoint(storedFrom(0, rows)).rubricVersion).toBe("r9");
  });

  it("reports 'mixed' only when more than one model scored the period", () => {
    const one = digestScans([scan({ id: "a", scannedAt: "2026-03-01T00:00:00Z", engineModel: "sonnet" })]);
    expect(digestToPoint(storedFrom(0, one)).engineModel).toBe("sonnet");
    const many = digestScans([
      scan({ id: "a", scannedAt: "2026-03-01T00:00:00Z", engineModel: "sonnet" }),
      scan({ id: "b", scannedAt: "2026-03-02T00:00:00Z", engineModel: "haiku" }),
    ]);
    expect(digestToPoint(storedFrom(0, many)).engineModel).toBe("mixed");
  });
});

describe("toDigestRow", () => {
  it("degrades a corrupt JSON cell to empty instead of throwing", () => {
    const w = mergeDigest(null, digestScans([scan({ id: "a", scannedAt: "2026-03-01T00:00:00Z" })])[0]!);
    const row = toDigestRow({ id: "dg", repoId: "r", ...w, enginesJson: "{[", dimensionsJson: "nope" });
    expect(row.engines).toEqual([]);
    expect(row.dimensions).toEqual({});
  });
});

describe("resolveCompaction", () => {
  const saved = { c: process.env.RETENTION_COMPACT, m: process.env.RETENTION_DIGEST_MONTHS };
  const restore = () => {
    if (saved.c === undefined) delete process.env.RETENTION_COMPACT;
    else process.env.RETENTION_COMPACT = saved.c;
    if (saved.m === undefined) delete process.env.RETENTION_DIGEST_MONTHS;
    else process.env.RETENTION_DIGEST_MONTHS = saved.m;
  };

  it("is OFF and forever-keeping with nothing configured", () => {
    delete process.env.RETENTION_COMPACT;
    delete process.env.RETENTION_DIGEST_MONTHS;
    expect(resolveCompaction({ retentionCompact: null, retentionDigestMonths: null })).toEqual({
      compact: false,
      digestMonths: 0,
    });
    restore();
  });

  it("inherits the env defaults, and a per-org value (including an explicit false/0) wins", () => {
    process.env.RETENTION_COMPACT = "1";
    process.env.RETENTION_DIGEST_MONTHS = "24";
    expect(resolveCompaction({ retentionCompact: null, retentionDigestMonths: null })).toEqual({
      compact: true,
      digestMonths: 24,
    });
    expect(resolveCompaction({ retentionCompact: false, retentionDigestMonths: 0 })).toEqual({
      compact: false,
      digestMonths: 0,
    });
    restore();
  });
});

describe("monthsBefore", () => {
  it("moves back whole UTC months", () => {
    expect(monthsBefore(new Date("2026-03-15T00:00:00Z"), 24).toISOString()).toBe("2024-03-15T00:00:00.000Z");
  });
});
