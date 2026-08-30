// MOONSHOT #33 — the full transition table.
//
// The two FAIL-BEFORE cases the spec names, both of which are false-alarm generators:
//   · a cosmetic edit (reworded prose under an unchanged heading) must NOT produce `drifted`;
//   · a truncated tree must NOT produce `removed`.

import { describe, expect, it } from "vitest";
import { reconcileAdoption, tallyTransitions, type CensusEntry, type LedgerRow } from "./reconcile";

const row = (over: Partial<LedgerRow> = {}): LedgerRow => ({
  id: "r1",
  artifactPath: "AGENTS.md",
  state: "adopted",
  adoptedHash: "sha256-n1:aaa",
  adoptedOutline: "sha256-n1:out",
  merged: true,
  ...over,
});

const seen = (over: Partial<CensusEntry> = {}): CensusEntry => ({
  path: "AGENTS.md",
  bodyHash: "sha256-n1:aaa",
  outlineHash: "sha256-n1:out",
  ...over,
});

describe("reconcileAdoption — removal", () => {
  it("marks a row removed when the path is gone from a COMPLETE tree", () => {
    expect(reconcileAdoption([row()], [], false)).toEqual([{ id: "r1", to: "removed" }]);
  });

  // FAIL-BEFORE. Absence in a truncated tree is a blind spot, not a deletion; a product that reports
  // "your team deleted this" because GitHub capped the tree listing has spent its credibility.
  it("emits NOTHING for a missing path when the tree was truncated", () => {
    expect(reconcileAdoption([row()], [], true)).toEqual([]);
  });

  it("does not re-stamp a row that is already removed", () => {
    expect(reconcileAdoption([row({ state: "removed" })], [], false)).toEqual([]);
  });

  it("returns a removed row to adopted when the file comes back", () => {
    expect(reconcileAdoption([row({ state: "removed" })], [seen()], false)).toEqual([
      { id: "r1", to: "adopted", adoptedHash: "sha256-n1:aaa", adoptedOutline: "sha256-n1:out" },
    ]);
  });
});

describe("reconcileAdoption — the unknowns", () => {
  it("says nothing about a path whose body was not fetched", () => {
    expect(reconcileAdoption([row()], [seen({ bodyHash: null, outlineHash: null })], false)).toEqual([]);
  });

  it("leaves a proposed row alone until its PR has merged", () => {
    const r = row({ state: "proposed", adoptedHash: null, adoptedOutline: null, merged: false });
    expect(reconcileAdoption([r], [seen()], false)).toEqual([]);
  });

  it("ignores a superseded row entirely", () => {
    expect(reconcileAdoption([row({ state: "superseded" })], [], false)).toEqual([]);
  });
});

describe("reconcileAdoption — first landing", () => {
  // The baseline is what LANDED. A reviewer who rewrote half the PR before merging has adopted the
  // practice; measuring them against `proposedHash` would call that drift on day one.
  it("stamps adoptedHash from the census, not from what was proposed", () => {
    const r = row({ state: "proposed", adoptedHash: null, adoptedOutline: null, merged: true });
    expect(reconcileAdoption([r], [seen({ bodyHash: "sha256-n1:edited", outlineHash: "sha256-n1:o2" })], false)).toEqual([
      { id: "r1", to: "adopted", adoptedHash: "sha256-n1:edited", adoptedOutline: "sha256-n1:o2" },
    ]);
  });
});

describe("reconcileAdoption — steady state and drift", () => {
  it("checks (no state change) when the body is byte-identical", () => {
    expect(reconcileAdoption([row()], [seen()], false)).toEqual([{ id: "r1", to: "checked" }]);
  });

  // FAIL-BEFORE. Reworded prose under an unchanged outline is someone MAINTAINING the document.
  it("does not call a cosmetic edit drift", () => {
    const census = [seen({ bodyHash: "sha256-n1:reworded" })];
    expect(reconcileAdoption([row()], census, false)).toEqual([{ id: "r1", to: "checked" }]);
  });

  it("calls it drift when the body AND the outline both moved", () => {
    const census = [seen({ bodyHash: "sha256-n1:gutted", outlineHash: "sha256-n1:other" })];
    expect(reconcileAdoption([row()], census, false)).toEqual([{ id: "r1", to: "drifted" }]);
  });

  // Two unknowns are not a match. A workflow yaml has no outline on either side, so the cosmetic
  // allowance must not fire for it — otherwise a gutted CI file would never read as drift.
  it("does not treat two null outlines as an unchanged outline", () => {
    const r = row({ artifactPath: ".github/workflows/ci.yml", adoptedOutline: null });
    const census = [seen({ path: ".github/workflows/ci.yml", bodyHash: "sha256-n1:gutted", outlineHash: null })];
    expect(reconcileAdoption([r], census, false)).toEqual([{ id: "r1", to: "drifted" }]);
  });

  it("does not re-stamp a row that is already drifted", () => {
    const census = [seen({ bodyHash: "sha256-n1:gutted", outlineHash: "sha256-n1:other" })];
    expect(reconcileAdoption([row({ state: "drifted" })], census, false)).toEqual([]);
  });

  it("returns a drifted row to adopted when the body matches again", () => {
    expect(reconcileAdoption([row({ state: "drifted" })], [seen()], false)).toEqual([
      { id: "r1", to: "adopted", adoptedHash: "sha256-n1:aaa", adoptedOutline: "sha256-n1:out" },
    ]);
  });

  it("compares paths case-insensitively — a case-only rename is not a removal", () => {
    expect(reconcileAdoption([row({ artifactPath: "agents.md" })], [seen({ path: "AGENTS.md" })], false)).toEqual([
      { id: "r1", to: "checked" },
    ]);
  });
});

describe("tallyTransitions", () => {
  it("counts by outcome and never counts a check", () => {
    const ts = reconcileAdoption(
      [
        row({ id: "a" }),
        row({ id: "b", artifactPath: "SECURITY.md" }),
        row({ id: "c", artifactPath: "docs/TESTING.md" }),
      ],
      [seen(), seen({ path: "docs/TESTING.md", bodyHash: "sha256-n1:x", outlineHash: "sha256-n1:y" })],
      false,
    );
    expect(tallyTransitions(ts)).toEqual({ adopted: 0, drifted: 1, removed: 1 });
  });
});
