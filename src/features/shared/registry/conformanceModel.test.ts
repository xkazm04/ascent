// The reading rules for the conformance surfaces (#18). What is pinned here is how each ABSENCE
// renders, because collapsing any two of them is what turns the instrument into a decoration:
// never swept ≠ no map ≠ unjudged ≠ conformant.

import { describe, expect, it } from "vitest";
import type { ConformanceMapRow, ConformanceRow, RegistryView } from "@/lib/org/registry-view";
import { buildMatrix, conformanceReading, readCount, signalRows, STATE_GLYPH, weakGovernance } from "./conformanceModel";

const repoRow = (over: Partial<ConformanceMapRow> = {}): ConformanceMapRow => ({
  repositoryId: "r1",
  repoFullName: "acme/api",
  mapSha: "sha",
  schema: "rkb-registry-map/1",
  generatedAt: "2026-08-23T00:00:00Z",
  contexts: 52,
  pairs: 180,
  judged: 8,
  deviations: 7,
  weaklyGoverned: 9,
  unmatched: 0,
  domains: ["software-engineering"],
  consults30d: null,
  warnings: [],
  ingestedAt: "2026-08-29T00:00:00Z",
  ...over,
});

const pair = (over: Partial<ConformanceRow> = {}): ConformanceRow => ({
  repositoryId: "r1",
  repoFullName: "acme/api",
  contextName: "A/B",
  contextGroup: "A",
  bundle: "software-engineering",
  subjectSlug: "quality-gates",
  state: "unjudged",
  confidence: "strong",
  score: 700,
  evidence: null,
  evaluatedAt: null,
  evaluatedAgainst: null,
  mapSha: "sha",
  ingestedAt: "2026-08-29T00:00:00Z",
  ...over,
});

const view = (over: Partial<RegistryView> = {}) => ({ ...over }) as RegistryView;

describe("buildMatrix", () => {
  it("folds a subject's contexts WORST-WINS, so one deviation cannot hide behind four conformants", () => {
    const m = buildMatrix(
      [
        pair({ contextName: "A/one", state: "conformant" }),
        pair({ contextName: "A/two", state: "deviation", evidence: "src/lib/x.ts:12 swallows the error" }),
        pair({ contextName: "A/three", state: "conformant" }),
      ],
      [repoRow()],
    );
    const cell = m.cell("quality-gates", "acme/api");
    expect(cell.state).toBe("deviation");
    expect(cell.contexts).toBe(3);
    expect(cell.evidence).toContain("src/lib/x.ts:12");
  });

  it("renders an unjudged pair as an em dash, never as a tick", () => {
    const m = buildMatrix([pair()], [repoRow()]);
    expect(m.cell("quality-gates", "acme/api").state).toBe("unjudged");
    expect(STATE_GLYPH.unjudged).toBe("—");
    expect(STATE_GLYPH.unjudged).not.toBe(STATE_GLYPH.conformant);
  });

  it("distinguishes a subject the repo's map never matched from one it judged", () => {
    const m = buildMatrix([pair()], [repoRow(), repoRow({ repositoryId: "r2", repoFullName: "acme/web" })]);
    expect(m.cell("quality-gates", "acme/web").state).toBe("absent");
    expect(STATE_GLYPH.absent).toBe("");
  });

  it("reports `empty` when every pair is still unjudged", () => {
    expect(buildMatrix([pair(), pair({ subjectSlug: "hitl-approval" })], [repoRow()]).empty).toBe(true);
    expect(buildMatrix([pair({ state: "conformant" })], [repoRow()]).empty).toBe(false);
  });

  it("orders repos worst-first and subjects by deviations", () => {
    const m = buildMatrix(
      [
        pair({ subjectSlug: "quiet", state: "conformant" }),
        pair({ subjectSlug: "loud", state: "deviation" }),
        pair({ subjectSlug: "loud", contextName: "A/two", state: "deviation" }),
      ],
      [repoRow({ deviations: 1, repoFullName: "acme/web" }), repoRow({ deviations: 7, repoFullName: "acme/api" })],
    );
    expect(m.repos).toEqual(["acme/api", "acme/web"]);
    expect(m.subjects.map((s) => s.slug)).toEqual(["loud", "quiet"]);
  });
});

describe("conformanceReading", () => {
  it("is null when nothing has been swept — the caller must say `no sweep`, not `no deviations`", () => {
    expect(conformanceReading(view())).toBeNull();
  });

  it("never states a deviation count without the population behind it", () => {
    const r = conformanceReading(
      view({ conformance: { repos: [repoRow()], pairs: [], truncated: false, reposWithoutMap: 3, subjects: 151 } }),
    )!;
    expect(r.headline).toBe("7 known deviations — 8 of 180 pairs judged across 1 repo · 3 with no map");
  });

  it("omits the no-map tail when every repo has a map", () => {
    const r = conformanceReading(
      view({ conformance: { repos: [repoRow()], pairs: [], truncated: false, reposWithoutMap: 0, subjects: 0 } }),
    )!;
    expect(r.headline).not.toContain("no map");
  });
});

describe("weakGovernance", () => {
  it("ranks repos by the share of contexts nothing governs confidently", () => {
    const rows = weakGovernance(
      view({
        conformance: {
          repos: [
            repoRow({ repoFullName: "acme/api", weaklyGoverned: 9, contexts: 52 }),
            repoRow({ repoFullName: "acme/web", weaklyGoverned: 5, contexts: 10 }),
            repoRow({ repoFullName: "acme/clean", weaklyGoverned: 0, contexts: 20 }),
          ],
          pairs: [],
          truncated: false,
          reposWithoutMap: 0,
          subjects: 0,
        },
      }),
    );
    expect(rows.map((r) => [r.repoFullName, r.share])).toEqual([
      ["acme/web", 50],
      ["acme/api", 17],
    ]);
  });

  it("is empty when nothing has been swept", () => {
    expect(weakGovernance(view())).toEqual([]);
  });
});

describe("signalRows / readCount", () => {
  it("renders a genuinely unmeasured count as a dash, not a zero", () => {
    expect(readCount(null)).toBe("—");
    expect(readCount(undefined)).toBe("—");
    expect(readCount(0)).toBe("0");
  });

  it("orders by what a curator acts on first: most deviated, then most consulted", () => {
    const s = (subjectSlug: string, deviations: number | null, consults: number | null) => ({
      bundle: "se",
      subjectSlug,
      contributors: 1,
      consults,
      deviations,
      citResolved: null,
      citMoved: null,
      citGone: null,
    });
    const out = signalRows(
      view({ signals: { contributors: 1, subjects: [s("a", 1, 90), s("b", 4, 2), s("c", null, 50)] } }),
    );
    expect(out.map((r) => r.subjectSlug)).toEqual(["b", "a", "c"]);
  });

  it("is empty when the lane has no witness", () => {
    expect(signalRows(view())).toEqual([]);
  });
});
