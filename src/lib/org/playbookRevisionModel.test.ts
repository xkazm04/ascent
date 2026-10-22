// playbooks-1: which repos are on an older version of an edited playbook, and which of them a revision
// rollout may touch. Pure: no db, no clock.

import { describe, expect, it } from "vitest";
import {
  classify,
  foldRevisionSets,
  isRevisable,
  pickLedgerRow,
  revisionConfirmCopy,
  revisionConfirmReady,
  revisionRolloutLine,
} from "./playbookRevisionModel";

const adopted = { state: "adopted", adoptedHash: "h1", patternVersion: null };

describe("classify", () => {
  it("an adopted v1 repo on a v3 playbook is behind (offered)", () => {
    expect(classify({ playbookVersion: 3, appliedVersion: 1, ledger: { state: "adopted", adoptedHash: "h1" } })).toBe("behind");
  });

  it("a hand-edited or removed file is diverged, never offered, whatever its version", () => {
    expect(classify({ playbookVersion: 3, appliedVersion: 1, ledger: { ...adopted, state: "drifted" } })).toBe("diverged");
    expect(classify({ playbookVersion: 3, appliedVersion: 1, ledger: { ...adopted, state: "removed" } })).toBe("diverged");
    expect(classify({ playbookVersion: 3, appliedVersion: 3, ledger: { ...adopted, state: "drifted" } })).toBe("diverged");
  });

  it("a mark with no version is unversioned; one on the current version is current", () => {
    expect(classify({ playbookVersion: 3, appliedVersion: null, ledger: adopted })).toBe("unversioned");
    expect(classify({ playbookVersion: 3, appliedVersion: 3, ledger: adopted })).toBe("current");
  });

  it("an open first PR, or an open revision PR for this version, is in-flight", () => {
    expect(classify({ playbookVersion: 3, appliedVersion: null, ledger: { ...adopted, state: "proposed" } })).toBe("in-flight");
    expect(classify({ playbookVersion: 3, appliedVersion: 1, ledger: { ...adopted, patternVersion: 3 } })).toBe("in-flight");
    // A revision drafted for v2 and then overtaken by a v3 edit is behind again.
    expect(classify({ playbookVersion: 3, appliedVersion: 1, ledger: { ...adopted, patternVersion: 2 } })).toBe("behind");
  });

  it("a mark with no ledger row (marked by hand, no file Ascent landed) is unversioned and not revisable", () => {
    expect(classify({ playbookVersion: 3, appliedVersion: 1, ledger: null })).toBe("unversioned");
    expect(isRevisable("unversioned", null)).toBe(false);
  });

  it("only behind / unversioned rows with an adopted digest are revisable", () => {
    expect(isRevisable("behind", adopted)).toBe(true);
    expect(isRevisable("unversioned", adopted)).toBe(true);
    expect(isRevisable("diverged", { ...adopted, state: "drifted" })).toBe(false);
    expect(isRevisable("behind", { ...adopted, adoptedHash: null })).toBe(false);
  });
});

describe("pickLedgerRow", () => {
  it("prefers the most conservative state when a repo carries several rows", () => {
    const rows = [{ state: "adopted" }, { state: "drifted" }, { state: "superseded" }];
    expect(pickLedgerRow(rows)?.state).toBe("drifted");
    expect(pickLedgerRow([{ state: "adopted" }, { state: "proposed" }])?.state).toBe("proposed");
    expect(pickLedgerRow([{ state: "superseded" }])).toBeNull();
  });
});

describe("foldRevisionSets + copy", () => {
  const sets = foldRevisionSets(3, [
    { repo: "acme/a", appliedVersion: 1, ledger: adopted },
    { repo: "acme/b", appliedVersion: 2, ledger: adopted },
    { repo: "acme/c", appliedVersion: 1, ledger: { ...adopted, state: "drifted" } },
    { repo: "acme/d", appliedVersion: null, ledger: adopted },
    { repo: "acme/e", appliedVersion: 3, ledger: adopted },
    { repo: "acme/f", appliedVersion: null, ledger: { ...adopted, state: "proposed" } },
  ]);

  it("splits the fleet into the five standings", () => {
    expect(sets.version).toBe(3);
    expect(sets.behind).toEqual([
      { repo: "acme/a", appliedVersion: 1 },
      { repo: "acme/b", appliedVersion: 2 },
    ]);
    expect(sets.diverged).toEqual([{ repo: "acme/c", state: "drifted" }]);
    expect(sets.unversioned).toEqual([{ repo: "acme/d", appliedVersion: null, revisable: true }]);
    expect(sets.current).toEqual(["acme/e"]);
    expect(sets.inFlight).toEqual(["acme/f"]);
  });

  it("names the version span on the rollout line", () => {
    expect(revisionRolloutLine(sets)).toBe("2 repos on v1-v2 -> update to v3");
    expect(revisionRolloutLine(foldRevisionSets(3, [{ repo: "acme/a", appliedVersion: 1, ledger: adopted }]))).toBe(
      "1 repo on v1 -> update to v3",
    );
    expect(revisionRolloutLine(foldRevisionSets(3, []))).toBe("Every adopter is on v3");
  });

  it("the typed confirm needs the exact org slug and the copy names the org and every repo", () => {
    expect(revisionConfirmReady("acme", "acme")).toBe(true);
    expect(revisionConfirmReady("Acme", "acme")).toBe(false);
    expect(revisionConfirmReady(" acme", "acme")).toBe(false);
    const copy = revisionConfirmCopy("acme", ["acme/a", "acme/b"], 3);
    expect(copy.body).toContain("acme/a");
    expect(copy.body).toContain("acme/b");
    expect(copy.title).toContain("acme");
    expect(copy.body).toContain("v3");
    expect(`${copy.title}${copy.body}`).not.toContain("—");
  });
});
