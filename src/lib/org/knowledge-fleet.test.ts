// The matrix is DENSE — subjects × swept repos, every cell either a folded verdict or a classified
// absence — and a verdict written against an older digest is flagged stale rather than shown as
// current. Pure: three arrays in, the contract's rows out.

import { describe, expect, it } from "vitest";
import type { ConformanceMapRow, ConformanceRow } from "@/lib/db/org-registry-conformance";
import type { KnowledgeSubject } from "./knowledge-shape";
import { buildKnowledgeFleet, lastSweepAt, sweepWarnings } from "./knowledge-fleet";

const subject = (slug: string, digest: string | null = `sha256:${slug}`): KnowledgeSubject => ({
  bundle: "software-engineering",
  slug,
  category: "ui-surfaces",
  subcategory: null,
  status: "forged",
  file: `knowledge/software-engineering/${slug}.md`,
  techniqueCount: 3,
  useWhen: [],
  laws: [],
  digest,
});

const map = (over: Partial<ConformanceMapRow>): ConformanceMapRow => ({
  repositoryId: "r-api",
  repoFullName: "acme/api",
  mapSha: "m1",
  schema: "rkb-registry-map/1",
  generatedAt: "2026-09-01T00:00:00.000Z",
  contexts: 4,
  pairs: 3,
  judged: 2,
  deviations: 1,
  weaklyGoverned: 1,
  weaklyGovernedContexts: ["A/B"],
  unmatched: 0,
  domains: ["software-engineering"],
  consults30d: null,
  hasContextMap: true,
  hasManifest: true,
  scope: { outOfScopeCategories: [], outOfScopeSubjects: [] },
  directions: [],
  warnings: [],
  ingestedAt: "2026-09-04T12:00:00.000Z",
  ...over,
});

const pair = (over: Partial<ConformanceRow>): ConformanceRow => ({
  repositoryId: "r-api",
  repoFullName: "acme/api",
  contextName: "A/B",
  contextGroup: "A",
  bundle: "software-engineering",
  subjectSlug: "table",
  state: "conformant",
  confidence: "strong",
  score: 700,
  evidence: null,
  evaluatedAt: null,
  evaluatedAgainst: "sha256:table",
  mapSha: "m1",
  ingestedAt: "2026-09-04T12:00:00.000Z",
  ...over,
});

describe("buildKnowledgeFleet", () => {
  it("emits one cell per subject × swept repo, mapped or not", () => {
    const subjects = [subject("table"), subject("feed"), subject("search")];
    const maps = [map({}), map({ repositoryId: "r-web", repoFullName: "acme/web", mapSha: null, hasContextMap: false, contexts: 0, pairs: 0, judged: 0, deviations: 0 })];
    const { repos, cells } = buildKnowledgeFleet(subjects, maps, [pair({})]);
    expect(repos.map((r) => r.fullName)).toEqual(["acme/api", "acme/web"]);
    expect(cells).toHaveLength(6);
    const at = (s: string, r: string) => cells.find((c) => c.subject === s && c.repositoryId === r)!;
    expect(at("table", "r-api")).toMatchObject({ state: "conformant", contexts: 1, stale: false });
    // In domain, in scope, undecided, no pair → the direction backlog.
    expect(at("feed", "r-api").state).toBe("candidate");
    // The unmapped repo: every cell is `no-map`, whatever its manifest says.
    expect(cells.filter((c) => c.repositoryId === "r-web").every((c) => c.state === "no-map")).toBe(true);
  });

  it("folds worst-wins across contexts and carries the worst pair's evidence", () => {
    const pairs = [
      pair({ contextName: "A/B", state: "conformant" }),
      pair({ contextName: "A/C", state: "deviation", evidence: "src/x.ts:12 no gate" }),
      pair({ contextName: "A/D", state: "unjudged", evaluatedAgainst: null }),
    ];
    const { cells } = buildKnowledgeFleet([subject("table")], [map({})], pairs);
    expect(cells[0]).toMatchObject({ state: "deviation", contexts: 3, evidence: "src/x.ts:12 no gate" });
  });

  it("maps the map's unjudged pair to the contract's `unknown`", () => {
    const { cells } = buildKnowledgeFleet([subject("table")], [map({})], [pair({ state: "unjudged", evaluatedAgainst: null })]);
    expect(cells[0]!.state).toBe("unknown");
  });

  it("flags a verdict written against an older digest as stale, and moves the repo to `conform`", () => {
    const { repos, cells } = buildKnowledgeFleet([subject("table", "sha256:new")], [map({})], [pair({ evaluatedAgainst: "sha256:old" })]);
    expect(cells[0]).toMatchObject({ state: "conformant", stale: true });
    expect(repos[0]!.stage).toBe("conform");
  });

  it("does not call a verdict stale when either digest is unknown", () => {
    expect(buildKnowledgeFleet([subject("table", null)], [map({})], [pair({ evaluatedAgainst: "sha256:old" })]).cells[0]!.stale).toBe(false);
    expect(buildKnowledgeFleet([subject("table")], [map({})], [pair({ evaluatedAgainst: null })]).cells[0]!.stale).toBe(false);
  });

  it("derives the stage from the foundation facts and the pairs", () => {
    const stage = (m: Partial<ConformanceMapRow>, pairs: ConformanceRow[] = []) => buildKnowledgeFleet([subject("table")], [map(m)], pairs).repos[0]!.stage;
    expect(stage({ hasContextMap: false, mapSha: null })).toBe("populate");
    expect(stage({ hasContextMap: true, mapSha: null })).toBe("map");
    expect(stage({}, [pair({ state: "unjudged", evaluatedAgainst: null })])).toBe("conform");
    expect(stage({}, [pair({})])).toBe("current");
  });

  it("classifies absences from the repo's own foundation facts", () => {
    const subjects = [subject("table"), subject("feed"), subject("search")];
    const m = map({
      domains: ["software-engineering"],
      scope: { outOfScopeCategories: [], outOfScopeSubjects: ["software-engineering/feed"] },
      directions: [{ subject: "search", bundle: "software-engineering", decision: "declined" }],
    });
    const { cells } = buildKnowledgeFleet(subjects, [m], []);
    expect(cells.map((c) => c.state)).toEqual(["candidate", "out-of-scope", "declined"]);
    expect(buildKnowledgeFleet([subject("table")], [map({ domains: ["media-craft"] })], []).cells[0]!.state).toBe("out-of-domain");
  });

  it("carries the map's weakly-governed contexts by name and the sweep time", () => {
    const { repos } = buildKnowledgeFleet([], [map({})], []);
    expect(repos[0]).toMatchObject({ weaklyGoverned: ["A/B"], sweptAt: "2026-09-04T12:00:00.000Z", hasMap: true, hasManifest: true });
  });
});

describe("sweep summary", () => {
  it("lastSweepAt is the newest ingest, null when nothing was swept", () => {
    expect(lastSweepAt([])).toBeNull();
    expect(lastSweepAt([map({ ingestedAt: "2026-09-01T00:00:00.000Z" }), map({ ingestedAt: "2026-09-04T00:00:00.000Z" })])).toBe("2026-09-04T00:00:00.000Z");
  });
  it("sweepWarnings unions the repos' warnings with their names", () => {
    expect(sweepWarnings([map({ warnings: ["context-map.json: presence could not be probed"] }), map({ repoFullName: "acme/web", warnings: [] })])).toEqual([
      "acme/api: context-map.json: presence could not be probed",
    ]);
  });
});
