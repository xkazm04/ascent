// Pure tests for the registry-map parse (#18), against the real `rkb-registry-map/1` shape taken
// from this repo's own `.ai/registry-map.json`.
//
// Two rules carry the whole item and are pinned first: `state: "unknown"` becomes `unjudged` (never
// `conformant` — "nobody looked" and "this follows the standard" are opposite facts), and a
// truncated document returns `{ok:false}` instead of throwing, because the sweep must degrade ONE
// repo into a warning rather than fail the fleet.

import { describe, expect, it } from "vitest";
import { countConsults, MAP_SCHEMA, parseConformanceMap, toConformanceState } from "./conformance-map";

const map = (over: Record<string, unknown> = {}) => ({
  schema: MAP_SCHEMA,
  project: "ascent",
  generatedAt: "2026-08-23T14:01:43Z",
  projectSha: "3a82110d",
  contextMapRevision: "ecad2b58ad5f",
  domains: ["software-engineering"],
  bundleDigests: { "software-engineering": "sha256:1117665ec59c1168" },
  stats: { contexts: 2, pairs: 2, unmatched: 0, weaklyGoverned: 1, judged: 1, deviations: 1 },
  contexts: [
    {
      context: "Repository Scanning & Scoring/CI Gate & Status Checks",
      name: "CI Gate & Status Checks",
      group: "Repository Scanning & Scoring",
      governance: "governed",
      subjects: [
        { subject: "quality-gates", bundle: "software-engineering", score: 705.5, confidence: "strong", state: "unknown" },
      ],
    },
    {
      context: "Identity & GitHub Connectivity/GitHub Repo Data Access",
      name: "GitHub Repo Data Access",
      group: "Identity & GitHub Connectivity",
      governance: "weak",
      subjects: [
        {
          subject: "data-access",
          bundle: "software-engineering",
          score: 324.7,
          confidence: "probable",
          state: "deviation",
          evidence: "governance/posture fetches still .catch(()=>null) with score-bearing folds",
          evaluatedAt: "2026-08-29",
          evaluatedAgainst: "sha256:1117665ec59c1168",
        },
      ],
    },
  ],
  ...over,
});

const parsed = (over?: Record<string, unknown>) => {
  const r = parseConformanceMap(JSON.stringify(map(over)));
  if (!r.ok) throw new Error(r.reason);
  return r;
};

describe("toConformanceState", () => {
  it("maps the generator's `unknown` to unjudged, never to conformant", () => {
    expect(toConformanceState("unknown")).toBe("unjudged");
    expect(toConformanceState(undefined)).toBe("unjudged");
    expect(toConformanceState("")).toBe("unjudged");
    expect(toConformanceState("something-new")).toBe("unjudged");
  });

  it("keeps the three real verdicts and normalizes the not-applicable spellings", () => {
    expect(toConformanceState("conformant")).toBe("conformant");
    expect(toConformanceState("Deviation")).toBe("deviation");
    expect(toConformanceState("not_applicable")).toBe("not-applicable");
    expect(toConformanceState("n/a")).toBe("not-applicable");
  });
});

describe("parseConformanceMap", () => {
  it("reads pairs with their verdict, evidence and provenance", () => {
    const { pairs } = parsed();
    expect(pairs).toHaveLength(2);
    expect(pairs[0]).toEqual({
      contextName: "Repository Scanning & Scoring/CI Gate & Status Checks",
      contextGroup: "Repository Scanning & Scoring",
      bundle: "software-engineering",
      subjectSlug: "quality-gates",
      state: "unjudged",
      confidence: "strong",
      score: 705.5,
      evidence: null,
      evaluatedAt: null,
      evaluatedAgainst: null,
    });
    expect(pairs[1]).toMatchObject({
      state: "deviation",
      evaluatedAgainst: "sha256:1117665ec59c1168",
      evaluatedAt: "2026-08-29",
    });
  });

  it("surfaces which contexts the map calls weakly governed, not just how many", () => {
    const { header } = parsed();
    expect(header.weaklyGoverned).toBe(1);
    expect(header.weaklyGovernedContexts).toEqual(["Identity & GitHub Connectivity/GitHub Repo Data Access"]);
  });

  it("carries the generator's stats verbatim rather than recounting them", () => {
    // The two disagreeing is information; silently substituting our own count would erase it.
    const { header } = parsed({ stats: { contexts: 52, pairs: 180, judged: 8, deviations: 7, weaklyGoverned: 9, unmatched: 3 } });
    expect(header).toMatchObject({ contexts: 52, pairs: 180, judged: 8, deviations: 7, weaklyGoverned: 9, unmatched: 3 });
  });

  it("falls back to what it parsed when a stat is absent", () => {
    const { header } = parsed({ stats: {} });
    expect(header).toMatchObject({ contexts: 2, pairs: 2, judged: 1, deviations: 1, weaklyGoverned: 1 });
  });

  it("returns {ok:false} for a truncated document and never throws", () => {
    const body = JSON.stringify(map()).slice(0, 400);
    const r = parseConformanceMap(body);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toContain("not valid JSON");
  });

  it("refuses a foreign schema by name", () => {
    const r = parseConformanceMap(JSON.stringify({ schema: "something/2", contexts: [] }));
    expect(r.ok === false && r.reason).toContain("expected rkb-registry-map/1");
  });

  it("refuses a document with no contexts array", () => {
    const r = parseConformanceMap(JSON.stringify({ schema: MAP_SCHEMA }));
    expect(r.ok === false && r.reason).toBe("no contexts array");
  });

  it("drops a pair naming no subject or no bundle — it could join to nothing", () => {
    const { pairs } = parsed({
      contexts: [{ context: "c", subjects: [{ subject: "x" }, { bundle: "b" }, { subject: "y", bundle: "b" }] }],
    });
    expect(pairs.map((p) => p.subjectSlug)).toEqual(["y"]);
  });

  it("keeps an absent score NULL rather than 0 — 0 would read as `no match`", () => {
    const { pairs } = parsed({ contexts: [{ context: "c", subjects: [{ subject: "s", bundle: "b" }] }] });
    expect(pairs[0]!.score).toBeNull();
    expect(pairs[0]!.confidence).toBeNull();
  });

  it("caps evidence without dropping it", () => {
    const long = "x".repeat(5000);
    const { pairs } = parsed({
      contexts: [{ context: "c", subjects: [{ subject: "s", bundle: "b", state: "deviation", evidence: long }] }],
    });
    expect(pairs[0]!.evidence).toHaveLength(2000);
  });
});

describe("countConsults", () => {
  const NOW = new Date("2026-08-29T00:00:00Z");
  const line = (ts: string, subjects: string[]) => JSON.stringify({ ts, bundle: "se", subjects });

  it("counts entries inside the window, per subject and in total", () => {
    const jsonl = [
      line("2026-08-23T00:00:00Z", ["plan-entitlements", "cost-metering"]),
      line("2026-08-25T00:00:00Z", ["cost-metering"]),
    ].join("\n");
    expect(countConsults(jsonl, 30, NOW)).toEqual({
      total: 2,
      bySubject: { "plan-entitlements": 1, "cost-metering": 2 },
    });
  });

  it("excludes entries outside the window", () => {
    const jsonl = [line("2026-01-01T00:00:00Z", ["a"]), line("2026-08-28T00:00:00Z", ["a"])].join("\n");
    expect(countConsults(jsonl, 30, NOW).total).toBe(1);
  });

  it("skips a torn last line rather than reporting the repo as silent", () => {
    const jsonl = `${line("2026-08-25T00:00:00Z", ["a"])}\n{"ts":"2026-08-26T00`;
    expect(countConsults(jsonl, 30, NOW).total).toBe(1);
  });

  it("drops an entry with no parseable ts — it cannot be windowed", () => {
    const jsonl = [JSON.stringify({ subjects: ["a"] }), line("2026-08-25T00:00:00Z", ["a"])].join("\n");
    expect(countConsults(jsonl, 30, NOW)).toEqual({ total: 1, bySubject: { a: 1 } });
  });

  it("returns zeroes for an empty file — the file existing IS the measurement", () => {
    expect(countConsults("", 30, NOW)).toEqual({ total: 0, bySubject: {} });
  });
});
