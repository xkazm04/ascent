// The worst-wins fold and the context×path rows it now carries (spark knowledge-context-matrix).
// Two invariants are pinned: the rows are ORDERED worst state first then by name (a deviation must
// never hide below a conformant row), and `contexts === contextRows.length` — the count and the
// list are the same fact stated twice, and a reader may trust either.

import { describe, expect, it } from "vitest";
import { foldPairs, isStalePair, isUnknownOrStale, toContextRows, type FoldablePair } from "./conformance-fold";

const pair = (over: Partial<FoldablePair> & { contextName: string }): FoldablePair => ({
  state: "conformant",
  evidence: null,
  evaluatedAgainst: "sha256:cur",
  contextGroup: "A",
  ...over,
});

describe("foldPairs", () => {
  it("returns null for no pairs — absence is classified elsewhere, never folded", () => {
    expect(foldPairs([], "sha256:cur")).toBeNull();
  });

  it("orders contextRows worst state first, then by name, and keeps contexts === contextRows.length", () => {
    const folded = foldPairs(
      [
        pair({ contextName: "A/Zeta", state: "conformant" }),
        pair({ contextName: "A/Beta", state: "unjudged", evaluatedAgainst: null }),
        pair({ contextName: "A/Mid", state: "deviation", evidence: "src/x.ts:3" }),
        pair({ contextName: "A/Alpha", state: "conformant" }),
        pair({ contextName: "A/NA", state: "not-applicable" }),
      ],
      "sha256:cur",
    )!;
    expect(folded.state).toBe("deviation");
    expect(folded.evidence).toBe("src/x.ts:3");
    expect(folded.contextRows.map((r) => `${r.name}:${r.state}`)).toEqual([
      "A/Mid:deviation",
      "A/Alpha:conformant",
      "A/Zeta:conformant",
      "A/NA:not-applicable",
      "A/Beta:unknown",
    ]);
    expect(folded.contexts).toBe(folded.contextRows.length);
  });

  it("wires judgedRevision and arrived through from the pair, defaulting to null / false", () => {
    const rows = toContextRows(
      [
        pair({ contextName: "A/B", evaluatedRevision: 12, arrived: false }),
        pair({ contextName: "A/C", state: "unjudged", evaluatedAgainst: null, arrived: true }),
        pair({ contextName: "A/D" }),
      ],
      "sha256:cur",
    );
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(by["A/B"]).toMatchObject({ judgedRevision: 12, arrived: false, group: "A" });
    expect(by["A/C"]).toMatchObject({ judgedRevision: null, arrived: true, state: "unknown" });
    expect(by["A/D"]).toMatchObject({ judgedRevision: null, arrived: false });
  });

  it("flags a row stale on its OWN verdict, not the cell's worst", () => {
    const folded = foldPairs(
      [pair({ contextName: "A/Old", state: "conformant", evaluatedAgainst: "sha256:old" }), pair({ contextName: "A/Bad", state: "deviation" })],
      "sha256:cur",
    )!;
    // The worst pair (deviation) is current, so the cell is not stale — but the conformant row is.
    expect(folded.stale).toBe(false);
    expect(folded.contextRows.find((r) => r.name === "A/Old")!.stale).toBe(true);
    expect(folded.contextRows.find((r) => r.name === "A/Bad")!.stale).toBe(false);
  });
});

describe("isStalePair / isUnknownOrStale", () => {
  it("needs both digests known, and never calls an unjudged pair stale", () => {
    expect(isStalePair(pair({ contextName: "x", evaluatedAgainst: "sha256:old" }), "sha256:cur")).toBe(true);
    expect(isStalePair(pair({ contextName: "x", evaluatedAgainst: null }), "sha256:cur")).toBe(false);
    expect(isStalePair(pair({ contextName: "x", evaluatedAgainst: "sha256:old" }), null)).toBe(false);
    expect(isStalePair(pair({ contextName: "x", state: "unjudged", evaluatedAgainst: "sha256:old" }), "sha256:cur")).toBe(false);
    expect(isUnknownOrStale(pair({ contextName: "x", state: "unjudged", evaluatedAgainst: null }), "sha256:cur")).toBe(true);
  });
});
