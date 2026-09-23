// Pure model behind "Correct" on a Memory card (challenge-2026-09-23b, org-memory#B). A correction is
// a supersede aimed at ONE known row: the draft prefills what the corrector is fixing, arms that row as
// the supersede target, and starts at the High band (memory-governance: a human correction is the
// highest evidence grade). The check verdict must not re-aim an armed correction at another row.

import { describe, expect, it } from "vitest";
import { canCorrectMemory, correctionDraft, supersedeAfterCheck } from "./memoryCorrectionModel";

describe("correctionDraft", () => {
  it("prefills the row, arms supersedeId, and starts at the High band", () => {
    const draft = correctionDraft({
      id: "m1",
      content: "CI runs on Node 18",
      kind: "procedural",
      namespace: "acme/api",
      visibility: "shared",
      tags: ["ci"],
      confidence: 0.6,
    });
    expect(draft).toEqual({
      form: {
        content: "CI runs on Node 18",
        kind: "procedural",
        namespace: "acme/api",
        visibility: "shared",
        tagsText: "ci",
        confidence: 1,
        // Provenance of the correction is the human making it, not the row it replaces.
        source: "",
      },
      supersedeId: "m1",
    });
  });

  it("joins several tags and keeps a private row private", () => {
    const draft = correctionDraft({
      id: "m2",
      content: "x",
      kind: "semantic",
      namespace: "",
      visibility: "private",
      tags: ["a", "b"],
      confidence: 0.3,
    });
    expect(draft.form.tagsText).toBe("a, b");
    expect(draft.form.visibility).toBe("private");
  });
});

describe("canCorrectMemory", () => {
  it("offers a correction on a hosted row the viewer can write", () => {
    expect(canCorrectMemory({ origin: "hosted" }, true)).toBe(true);
  });
  it("never on a registry mirror (the pull request is the change path)", () => {
    expect(canCorrectMemory({ origin: "registry" }, true)).toBe(false);
  });
  it("never without write access", () => {
    expect(canCorrectMemory({ origin: "hosted" }, false)).toBe(false);
  });
});

describe("supersedeAfterCheck", () => {
  const verdict = (recommendation: "supersede" | "novel" | "duplicate") =>
    ({ recommendation, duplicates: [{ id: "dup1" }] }) as Parameters<typeof supersedeAfterCheck>[0];

  it("guard: with no correction armed, a supersede verdict pre-selects duplicates[0]", () => {
    expect(supersedeAfterCheck(verdict("supersede"), null)).toBe("dup1");
  });
  it("guard: a non-supersede verdict arms nothing", () => {
    expect(supersedeAfterCheck(verdict("novel"), null)).toBeNull();
    expect(supersedeAfterCheck(verdict("duplicate"), null)).toBeNull();
  });
  it("keeps an armed correction's target whatever the verdict says", () => {
    expect(supersedeAfterCheck(verdict("supersede"), "m1")).toBe("m1");
    expect(supersedeAfterCheck(verdict("novel"), "m1")).toBe("m1");
  });
});
