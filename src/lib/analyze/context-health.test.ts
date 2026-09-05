// Context Health (W4) — derivation invariants:
//  · guidance-file pick is deterministic, root-first, capped at the freshness-lookup budget
//  · staleness is read off weekly commitActivity buckets (approximate, window-capped when the edit
//    predates the window) — never fabricated when there is nothing to count against
//  · drift = dead `@file` refs vs the tree index (the zero-fetch signal)
//  · KEYLESS/DEGRADED lookups narrow the result (freshness unknown, blend renormalized) — the scan
//    must never fail or fabricate a date because a freshness call was skipped or rate-limited
//  · the whole signal STAYS DISPLAY-ONLY: the scoring prompt/engine never read it (no rubric bump)

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { GuidanceFreshness, RepoFile, RepoSnapshot } from "@/lib/types";
import {
  CONTEXT_HEALTH_VERSION,
  commitsSince,
  decayPotency,
  deriveContextHealth,
  detectRefDrift,
  guidanceTolerance,
  halfLife,
  MAX_GUIDANCE_FILES,
  parseContextHealthJson,
  pickGuidanceFiles,
} from "./context-health";

const NOW = "2026-08-12T00:00:00.000Z";
const daysAgo = (n: number) => new Date(Date.parse(NOW) - n * 86_400_000).toISOString();

function snap(over: Partial<RepoSnapshot> = {}): RepoSnapshot {
  return {
    meta: { owner: "o", name: "r", url: "", stars: 0, forks: 0, openIssues: 0, isPrivate: false, defaultBranch: "main" },
    tree: [{ path: "README.md", type: "blob", size: 100 }],
    files: [],
    commits: [],
    truncated: false,
    coverage: 0.95,
    ...over,
  } as RepoSnapshot;
}

// Substantive guidance: clears several guidanceQuality rules (commands, structure, constraints,
// verify discipline, examples) so quality lands well above zero.
const GOOD_GUIDANCE = [
  "# Project guidance",
  "## Commands",
  "Run `npm run test` and `npm run build` before committing. Always test after changes.",
  "## Architecture",
  "The project structure is a Next.js app; see @src/lib/scan.ts and @docs/missing-file.md.",
  "Do not edit generated files. Important: never commit secrets.",
  "```bash\nnpm run dev\n```",
].join("\n");

describe("pickGuidanceFiles", () => {
  it("picks root guidance first, CLAUDE.md before AGENTS.md, capped at the lookup budget", () => {
    const tree: RepoFile[] = [
      { path: "packages/api/AGENTS.md", type: "blob", size: 10 },
      { path: ".cursorrules", type: "blob", size: 10 },
      { path: "AGENTS.md", type: "blob", size: 10 },
      { path: "CLAUDE.md", type: "blob", size: 10 },
      { path: "src/deep/CLAUDE.md", type: "blob", size: 10 },
      { path: "docs/guide.md", type: "blob", size: 10 }, // not guidance
    ];
    const picked = pickGuidanceFiles(tree).map((f) => f.path);
    expect(picked).toHaveLength(MAX_GUIDANCE_FILES);
    expect(picked).toEqual(["CLAUDE.md", "AGENTS.md", ".cursorrules"]);
  });

  it("ignores directories and non-guidance files", () => {
    const tree: RepoFile[] = [
      { path: "CLAUDE.md", type: "tree" }, // a dir named like guidance — not a blob
      { path: "src/index.ts", type: "blob" },
    ];
    expect(pickGuidanceFiles(tree)).toEqual([]);
  });
});

describe("commitsSince — bucket-derived approximate staleness", () => {
  // 4 weekly buckets, oldest→newest.
  const activity = [10, 20, 30, 40];

  it("sums whole trailing weeks exactly (edit 2 weeks ago → the newest 2 buckets)", () => {
    expect(commitsSince(activity, daysAgo(14), Date.parse(NOW))).toEqual({ count: 70, windowCapped: false });
  });

  it("pro-rates the partial oldest week (edit 1.5 weeks ago → newest bucket + half the next)", () => {
    expect(commitsSince(activity, daysAgo(10.5), Date.parse(NOW))).toEqual({ count: 40 + 15, windowCapped: false });
  });

  it("flags a LOWER BOUND when the edit predates the window", () => {
    const r = commitsSince(activity, daysAgo(365), Date.parse(NOW));
    expect(r).toEqual({ count: 100, windowCapped: true });
  });

  it("returns 0 for an edit newer than the clock and null when there is nothing to count against", () => {
    expect(commitsSince(activity, NOW, Date.parse(NOW))).toEqual({ count: 0, windowCapped: false });
    expect(commitsSince(null, daysAgo(7), Date.parse(NOW))).toBeNull();
    expect(commitsSince([], daysAgo(7), Date.parse(NOW))).toBeNull();
    expect(commitsSince(activity, "not-a-date", Date.parse(NOW))).toBeNull();
  });
});

describe("decay math (the P4 survivors)", () => {
  it("decayPotency halves per tolerance-worth of churn; zero tolerance floors", () => {
    expect(decayPotency(0, 50)).toBe(100);
    expect(decayPotency(50, 50)).toBe(50);
    expect(decayPotency(100, 50)).toBe(25);
    expect(decayPotency(10, 0)).toBe(0);
  });

  it("halfLife is tolerance÷rate in days, Infinity for a quiet repo", () => {
    expect(halfLife(50, 7)).toBeCloseTo(50);
    expect(halfLife(50, 0)).toBe(Infinity);
  });

  it("guidanceTolerance floors at 8 and scales with size×quality", () => {
    expect(guidanceTolerance(undefined, 0)).toBe(8);
    expect(guidanceTolerance(6000, 60)).toBe(30);
  });
});

describe("detectRefDrift — dead @file refs vs the tree", () => {
  const treePaths = new Set(["src/lib/scan.ts", "docs/setup.md"]);

  it("splits live vs dead refs, de-duplicated", () => {
    const text = "See @src/lib/scan.ts and @docs/setup.md, but also @docs/gone.md and again @docs/gone.md.";
    expect(detectRefDrift(text, "CLAUDE.md", treePaths)).toEqual({ refsTotal: 3, deadRefs: ["docs/gone.md"] });
  });

  it("resolves refs relative to the guidance file's own directory", () => {
    const text = "Read @setup.md first."; // lives at docs/setup.md relative to docs/CLAUDE.md
    expect(detectRefDrift(text, "docs/CLAUDE.md", treePaths)).toEqual({ refsTotal: 1, deadRefs: [] });
  });

  it("no refs → zero drift surface", () => {
    expect(detectRefDrift("no references here", "CLAUDE.md", treePaths)).toEqual({ refsTotal: 0, deadRefs: [] });
  });
});

describe("deriveContextHealth", () => {
  const guidanceSnap = snap({
    tree: [
      { path: "CLAUDE.md", type: "blob", size: GOOD_GUIDANCE.length },
      { path: "src/lib/scan.ts", type: "blob", size: 10 },
    ],
    files: [{ path: "CLAUDE.md", content: GOOD_GUIDANCE, bytes: GOOD_GUIDANCE.length }],
  });
  const freshness: GuidanceFreshness[] = [
    { path: "CLAUDE.md", lastModifiedAt: daysAgo(14), lastCommitSha: "a".repeat(40) },
  ];

  it("full inputs → present, real freshness (approximate), quality signals, and dead-ref drift", () => {
    const ch = deriveContextHealth({
      snapshot: guidanceSnap,
      freshness,
      commitActivity: [5, 5, 5, 5],
      now: NOW,
    });
    expect(ch.version).toBe(CONTEXT_HEALTH_VERSION);
    expect(ch.present).toBe(true);
    expect(ch.files).toHaveLength(1);
    expect(ch.files[0]).toMatchObject({ path: "CLAUDE.md", lastModifiedAt: freshness[0]!.lastModifiedAt, bytes: GOOD_GUIDANCE.length });
    expect(ch.files[0]!.sectionsScore).toBeGreaterThan(40);
    // 2 whole weeks of 5 commits since the edit.
    expect(ch.freshness).toMatchObject({ ageDays: 14, commitsSinceEdit: 10, approximate: true });
    expect(ch.freshness.score).toBeGreaterThan(0);
    // @src/lib/scan.ts resolves; @docs/missing-file.md does not.
    expect(ch.drift).toMatchObject({ refsTotal: 2, deadRefs: ["docs/missing-file.md"], score: 50 });
    expect(ch.quality.signals.length).toBeGreaterThan(2);
    expect(ch.score).toBeGreaterThan(0);
  });

  it("KEYLESS DEGRADATION: an unknown-freshness lookup narrows the result, never fails or fabricates", () => {
    const ch = deriveContextHealth({
      snapshot: guidanceSnap,
      freshness: [{ path: "CLAUDE.md" }], // the degraded entry fetchGuidanceFreshness emits on failure
      commitActivity: [5, 5, 5, 5],
      now: NOW,
    });
    expect(ch.present).toBe(true);
    expect(ch.freshness).toEqual({ score: null, ageDays: null, commitsSinceEdit: null, approximate: true });
    // Blend renormalizes over quality+drift — still a real composite, from the real halves.
    expect(ch.score).toBeGreaterThan(0);
    expect(ch.files[0]!.lastModifiedAt).toBeUndefined();
  });

  it("tokenless scan (date known, NO commitActivity): age is reported, potency stays unknown", () => {
    const ch = deriveContextHealth({ snapshot: guidanceSnap, freshness, commitActivity: null, now: NOW });
    expect(ch.freshness).toEqual({ score: null, ageDays: 14, commitsSinceEdit: null, approximate: true });
  });

  it("edit older than the window is window-capped (a labeled lower bound)", () => {
    const ch = deriveContextHealth({
      snapshot: guidanceSnap,
      freshness: [{ path: "CLAUDE.md", lastModifiedAt: daysAgo(400), lastCommitSha: "b".repeat(40) }],
      commitActivity: [5, 5, 5, 5],
      now: NOW,
    });
    expect(ch.freshness.windowCapped).toBe(true);
    expect(ch.freshness.commitsSinceEdit).toBe(20);
  });

  it("no guidance files → present:false, score 0, empty files (the honest 'absent')", () => {
    const ch = deriveContextHealth({ snapshot: snap(), freshness: [], commitActivity: [1, 2], now: NOW });
    expect(ch).toMatchObject({ present: false, score: 0, files: [] });
    expect(ch.drift).toEqual({ score: 100, refsTotal: 0, deadRefs: [] });
  });

  it("guidance detected but content NOT in the ingest sample → quality 0, no crash", () => {
    const ch = deriveContextHealth({
      snapshot: snap({ tree: [{ path: "AGENTS.md", type: "blob", size: 500 }] }),
      freshness: [],
      commitActivity: null,
      now: NOW,
    });
    expect(ch.present).toBe(true);
    expect(ch.files[0]).toMatchObject({ path: "AGENTS.md", sectionsScore: 0 });
    expect(ch.quality).toEqual({ score: 0, signals: [] });
  });
});

describe("parseContextHealthJson", () => {
  it("round-trips a derived blob; null on garbage/legacy shapes", () => {
    const ch = deriveContextHealth({ snapshot: snap(), freshness: [], commitActivity: null, now: NOW });
    expect(parseContextHealthJson(JSON.stringify(ch))).toEqual(ch);
    expect(parseContextHealthJson(null)).toBeNull();
    expect(parseContextHealthJson(undefined)).toBeNull();
    expect(parseContextHealthJson("")).toBeNull();
    expect(parseContextHealthJson("not json")).toBeNull();
    expect(parseContextHealthJson("{}")).toBeNull();
    expect(parseContextHealthJson(JSON.stringify({ version: "1", present: true }))).toBeNull();
  });
});

describe("Context Health stays DISPLAY-ONLY (no rubric bump)", () => {
  // The doctrine this wave ships under: contextHealth never feeds the scan score or the LLM prompt.
  // Folding it into D1 later is a deliberate SCORING_RUBRIC_VERSION event — this pin makes that
  // fold impossible to do by accident. (Same file-content style as init-sql.test.ts.)
  it.each(["src/lib/scoring/prompt.ts", "src/lib/scoring/engine.ts", "src/lib/scan-score-input.ts"])(
    "%s never references contextHealth",
    (file) => {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      expect(src).not.toMatch(/contextHealth/i);
    },
  );
});
