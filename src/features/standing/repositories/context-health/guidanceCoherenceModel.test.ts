import { describe, expect, it } from "vitest";
import {
  buildCoherenceRows,
  coherenceFleetSummary,
  orderByIncoherence,
} from "./guidanceCoherenceModel";
import type { GuidanceGraph } from "@/lib/types";
import type { OrgRepoRow } from "@/lib/db/org-rollup";

const graph = (over: Partial<GuidanceGraph> = {}): GuidanceGraph => ({
  version: "1",
  nodes: [
    { path: "AGENTS.md", agent: "agents", bytes: 100, contentSampled: true, commands: [], rules: [], pointers: [], pointerOnly: false, lastCommitAt: null },
    { path: ".cursorrules", agent: "cursor", bytes: 100, contentSampled: true, commands: [], rules: [], pointers: [], pointerOnly: false, lastCommitAt: null },
  ],
  edges: [],
  canonical: "AGENTS.md",
  canonicalBasis: "manifest",
  contradictions: [],
  coherence: 100,
  penalties: [],
  ...over,
});

const repo = (fullName: string, g: GuidanceGraph | null): OrgRepoRow =>
  ({ fullName, name: fullName.split("/")[1], guidanceGraph: g }) as unknown as OrgRepoRow;

describe("a null graph is not assessed — never a zero bar", () => {
  it("renders no coherence number and says re-scan", () => {
    const [row] = buildCoherenceRows([repo("o/pre-r11", null)]);
    expect(row!.assessed).toBe(false);
    // FAIL-BEFORE: any implementation defaulting this to 0 asserts a verdict about a repo that was
    // never assessed under r11. `null` and 0 must not render the same.
    expect(row!.coherence).toBeNull();
    expect(row!.verdict).toMatch(/not assessed/i);
  });

  it("is excluded from the fleet denominator, and the headline says so", () => {
    const rows = buildCoherenceRows([repo("o/a", graph()), repo("o/pre-r11", null)]);
    const s = coherenceFleetSummary(rows);
    expect(s.measured).toBe(1);
    expect(s.unmeasured).toBe(1);
    expect(s.headline).toContain("of 1 assessed");
    expect(s.headline).toMatch(/excluded/);
  });

  it("reports no denominator at all rather than 0% when nothing was assessed", () => {
    const s = coherenceFleetSummary(buildCoherenceRows([repo("o/a", null)]));
    expect(s.meanCoherence).toBeNull();
    expect(s.headline).toMatch(/no repository has been assessed/i);
  });

  it("tells an EMPTY fleet to add repositories, and a scanned-but-unassessed fleet to re-scan", () => {
    // The list region reached one message for three different facts. An org with no repositories in
    // scope was told to "re-scan" — an instruction with nothing to act on. Each state now gets the
    // remedy that applies to it, and neither restates the headline rendered directly above it.
    const none = coherenceFleetSummary([]);
    expect(none.emptyMessage).toMatch(/no repositories in scope/i);
    expect(none.emptyMessage).not.toMatch(/re-scan/i);

    const unassessed = coherenceFleetSummary(buildCoherenceRows([repo("o/a", null), repo("o/b", null)]));
    expect(unassessed.emptyMessage).toMatch(/re-scan/i);
    expect(unassessed.emptyMessage).toContain("2 repositories in scope");

    // …and the message is null exactly when the list has rows to draw, so the card's branch and the
    // copy can never disagree about which one is showing.
    expect(coherenceFleetSummary(buildCoherenceRows([repo("o/a", graph())])).emptyMessage).toBeNull();
  });

  it("a repo with a graph but no guidance document has a null coherence, not 0", () => {
    const [row] = buildCoherenceRows([repo("o/bare", graph({ nodes: [], canonical: null, canonicalBasis: null, coherence: null }))]);
    expect(row!.assessed).toBe(true);
    expect(row!.coherence).toBeNull();
    expect(row!.verdict).toMatch(/no agent guidance/i);
  });
});

describe("the verdict and the chips", () => {
  it("counts a contradicting repo without calling it a failure", () => {
    const g = graph({
      coherence: 60,
      contradictions: [
        {
          kind: "command",
          subject: "test",
          a: { path: "AGENTS.md", quote: "npm test" },
          b: { path: ".cursorrules", quote: "npm run test:ci" },
          confidence: "deterministic",
        },
      ],
    });
    const rows = buildCoherenceRows([repo("o/drift", g)]);
    expect(rows[0]!.verdict).toMatch(/different answer/);
    expect(rows[0]!.verdict).not.toMatch(/fail|error|violation/i);
    expect(coherenceFleetSummary(rows).contradicting).toBe(1);
  });

  it("labels the canonical node and classifies an in-sync projection", () => {
    const g = graph({ edges: [{ from: ".cursorrules", to: "AGENTS.md", kind: "projects-from", detail: "in-sync" }] });
    const chips = buildCoherenceRows([repo("o/a", g)])[0]!.projections;
    expect(chips.find((c) => c.path === "AGENTS.md")!.state).toBe("canonical");
    expect(chips.find((c) => c.path === ".cursorrules")!.state).toBe("in-sync");
  });

  it("marks an unfetched document unsampled rather than independent", () => {
    const g = graph();
    g.nodes[1]!.contentSampled = false;
    expect(buildCoherenceRows([repo("o/a", g)])[0]!.projections[1]!.state).toBe("unsampled");
  });
});

describe("ordering", () => {
  it("puts the worst coherence first and the unassessed last", () => {
    const rows = buildCoherenceRows([
      repo("o/good", graph({ coherence: 100 })),
      repo("o/none", null),
      repo("o/bad", graph({ coherence: 40 })),
    ]);
    expect(orderByIncoherence(rows).map((r) => r.fullName)).toEqual(["o/bad", "o/good", "o/none"]);
  });
});
