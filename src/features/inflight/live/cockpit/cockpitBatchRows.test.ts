// THE BATCH LEDGER'S FOLD — what the run will actually dispatch, and the arithmetic printed above it.
// The number under this table is the one an operator commits a session on, so it answers to the same
// exclusions the run itself does: the focus, the pruning, and the pairing rule.

import { describe, expect, it } from "vitest";
import { batchRows, batchTotals } from "./cockpitBatchRows";
import type { FollowUpItem, LoopProposal } from "./loopTypes";

const item = (id: string, dimId = "D2", projectedPoints: number | null = 4): FollowUpItem => ({
  id,
  repo: "acme/one",
  title: `gap ${id}`,
  dimId,
  dimLabel: "Testing",
  impact: "high",
  effort: "low",
  rationale: "",
  explore: [],
  projectedPoints,
});

const proposal = (o: Partial<LoopProposal> = {}): LoopProposal => ({
  repo: "acme/one",
  items: [],
  projectedPoints: 0,
  kind: "backlog",
  practiceId: null,
  reason: "Works this repo's open follow-ups with a local agent.",
  ...o,
});

const none = new Set<string>();

describe("batchRows", () => {
  it("flattens each repo's items into one row apiece", () => {
    const rows = batchRows([proposal({ items: [item("a"), item("b")] })], none, null);
    expect(rows.map((r) => r.kind)).toEqual(["item", "item"]);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(rows[0]!.repoName).toBe("one");
  });

  it("applies the dimension focus, and says so when it empties a repo", () => {
    const rows = batchRows([proposal({ items: [item("a", "D2"), item("b", "D9")] })], none, "D9");
    expect(rows.map((r) => r.id)).toEqual(["b"]);
    expect(batchRows([proposal({ items: [item("a", "D2")] })], none, "D9")[0]).toMatchObject({
      kind: "lane",
      note: "nothing open on this dimension",
    });
  });

  it("gives an INSTALL lane its tag, its reason, and the fact that there is nothing to curate", () => {
    const [row] = batchRows([proposal({ kind: "foundation", reason: "No .ai/ foundation in this repo." })], none, null);
    expect(row).toMatchObject({ kind: "lane", laneTag: ".ai/ foundation", note: "No .ai/ foundation in this repo." });
    expect(row!.curation).toMatch(/no rows to curate/);
  });

  it("FLAGS an unpaired repo instead of offering items a lane could never work", () => {
    const rows = batchRows([proposal({ items: [item("a")] })], new Set(["acme/one"]), null);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "unpaired", note: "not paired · skipped" });
  });
});

describe("batchTotals", () => {
  const rows = batchRows(
    [
      proposal({ items: [item("a"), item("b", "D2", null)] }),
      proposal({ repo: "acme/two", items: [item("c")] }),
      proposal({ repo: "acme/three" }),
    ],
    new Set(["acme/four"]),
    null,
  );

  it("counts only what will dispatch, and prices only what carries a projection", () => {
    // `b` is a craft rung: no projected points by construction, and never given one.
    expect(batchTotals(rows, none)).toMatchObject({ items: 3, pruned: 0, repos: 2, points: 8 });
  });

  it("moves a pruned row out of the count and out of the projection", () => {
    expect(batchTotals(rows, new Set(["a"]))).toMatchObject({ items: 2, pruned: 1, points: 4 });
  });

  it("counts an unpaired repo as excluded rather than as work", () => {
    const withUnpaired = batchRows([proposal({ items: [item("a")] })], new Set(["acme/one"]), null);
    expect(batchTotals(withUnpaired, none)).toMatchObject({ items: 0, unpaired: 1, repos: 0 });
  });
});

// A MOVED CHECKOUT (challenge-2026-09-23b). A pairing that exists but no longer verifies is its own
// row: the verifier's sentence, no checkbox, excluded from the count, never an install lane.
describe("a broken pairing", () => {
  const moved = "Folder does not exist on the server's filesystem.";
  const broken = proposal({ repo: "acme/two", pairing: { ok: false, error: moved } });

  it("renders as exactly one 'broken' row carrying the verifier's sentence", () => {
    const rows = batchRows([broken], none, null);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "broken", repo: "acme/two", laneTag: null });
    expect((rows[0] as { note: string }).note).toContain(moved);
  });

  it("is counted as broken, not as a repo the run works", () => {
    const rows = batchRows([proposal({ items: [item("a")] }), broken], none, null);
    expect(batchTotals(rows, none)).toMatchObject({ items: 1, repos: 1, broken: 1, unpaired: 0 });
  });

  it("guard: a repo with no localPath at all still renders the unpaired row, unchanged", () => {
    const rows = batchRows([proposal({ repo: "acme/two", items: [item("a")] })], new Set(["acme/two"]), null);
    expect(rows).toEqual([{ kind: "unpaired", id: "unpaired:acme/two", repo: "acme/two", repoName: "two", laneTag: null, note: "not paired · skipped", curation: null }]);
  });
});
