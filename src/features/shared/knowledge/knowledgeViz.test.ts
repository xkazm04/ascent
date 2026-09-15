// The epistemic derivations, pinned. Every case here is a place where the old surface printed a
// zero for something it had never measured.

import { describe, it, expect } from "vitest";
import { KNOWLEDGE_CELL_STATES } from "@/lib/org/knowledge-shape";
import { fixtureKnowledgeView } from "@/lib/org/knowledge-view.fixture";
import { VIZ_STATES } from "@/components/org/viz";
import { CELL_VIZ_STATE, STAGE_VIZ_STATE, indexCells, subjectsOf } from "./knowledgeModel";
import { bundleCoverage, subjectImpact, subjectVizState } from "./knowledgeViz";

const view = fixtureKnowledgeView("acme");
const se = view.domains.find((d) => d.name === "software-engineering")!;
const llm = view.domains.find((d) => d.name === "llm-observability")!;
const subject = view.subjects.find((s) => s.slug === "agent-memory")!;
const cells = indexCells(view.cells);

const unmapped = { ...view, repos: view.repos.map((r) => ({ ...r, hasMap: false })) };
const neverSwept = { ...view, sweep: { ...view.sweep, lastAt: null } };

describe("the domain vocabulary maps onto the kit's, totally", () => {
  it("gives every one of the eleven cell states exactly one VizState", () => {
    for (const s of KNOWLEDGE_CELL_STATES) {
      expect(CELL_VIZ_STATE[s], `cell state ${s} has no epistemic reading`).toBeTruthy();
      expect(VIZ_STATES).toContain(CELL_VIZ_STATE[s]);
    }
    // The two that carry the law: nothing judged them, and nothing can be known.
    expect(CELL_VIZ_STATE.unknown).toBe("not-judged");
    expect(CELL_VIZ_STATE["no-map"]).toBe("missing");
  });

  it("reads a repo with no context map as a void, not as a zero-context repo", () => {
    expect(STAGE_VIZ_STATE.populate).toBe("missing");
    expect(STAGE_VIZ_STATE.current).toBe("measured");
  });
});

describe("bundleCoverage", () => {
  it("measures a mirrored bundle and calls an unmirrored one DECLARED, with no score", () => {
    const cov = bundleCoverage(view, se);
    expect(cov.mirrored.state).toBe("measured");
    expect(cov.mirrored.have).toBe(subjectsOf(view, se.name).length);
    expect(cov.mirrored.of).toBe(se.subjects);

    // The registry publishes 17 subjects for this bundle and this index resolved none of them: a
    // claim we hold nothing against, which is not "0% coverage measured".
    const none = bundleCoverage(view, llm);
    expect(none.mirrored.state).toBe("declared");
    expect(none.mirrored.score).toBeNull();
    expect(none.mirrored.have).toBeNull();
  });

  it("has no judged reading at all when the fleet was never swept", () => {
    const cov = bundleCoverage(neverSwept, se);
    expect(cov.judged.state).toBe("missing");
    expect(cov.judged.score).toBeNull();
  });

  it("hatches the judged axis when no repository carries a registry map", () => {
    const cov = bundleCoverage(unmapped, se);
    expect(cov.judged.state).toBe("not-judged");
    expect(cov.judged.score).toBeNull();
  });
});

describe("subjectVizState — the warp's provenance", () => {
  it("is measured with a digest and a revision, declared without either, missing off-bundle", () => {
    expect(subjectVizState(view, subject)).toBe("measured");
    expect(subjectVizState(view, { ...subject, digest: null })).toBe("declared");
    expect(subjectVizState(view, { ...subject, revision: null })).toBe("declared");
    expect(subjectVizState(view, { ...subject, bundle: "not-a-bundle" })).toBe("missing");
  });

  it("finds the fixture's own unversioned subject and reads it as declared, never as fresh", () => {
    const unversioned = view.subjects.find((s) => s.revision == null)!;
    expect(subjectVizState(view, unversioned)).toBe("declared");
  });
});

describe("subjectImpact — the missing/zero conflation, fixed", () => {
  it("measures a real blast radius", () => {
    const impact = subjectImpact(view, subject, cells);
    expect(impact.state).toBe("measured");
    expect(impact.contexts).toBeGreaterThan(0);
    expect(impact.rows.length).toBe(view.repos.filter((r) => r.hasMap).length);
  });

  it("returns NULL counts — never 0 — when the fleet was never swept", () => {
    const impact = subjectImpact(neverSwept, subject, cells);
    expect(impact.state).toBe("missing");
    expect(impact.contexts).toBeNull();
    expect(impact.repos).toBeNull();
    expect(impact.stale).toBeNull();
  });

  it("returns NULL counts when no repository carries a map", () => {
    const impact = subjectImpact(unmapped, subject, cells);
    expect(impact.state).toBe("not-judged");
    expect(impact.contexts).toBeNull();
    expect(impact.rows).toHaveLength(0);
  });
});
