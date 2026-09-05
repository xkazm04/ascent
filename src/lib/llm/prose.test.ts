// deEmDash is the guarantee behind the no-em-dash rule: the prompt asks, this enforces. So what it
// must never do matters as much as what it does — it runs on EVERY model-supplied string via cap()
// in provider.ts, including text that was already fine.

import { describe, it, expect } from "vitest";
import { deEmDash, hasEmDash, PROSE_STYLE_RULE } from "./prose";

describe("deEmDash — the connector cases", () => {
  it("replaces a spaced connector with a comma", () => {
    expect(deEmDash("The gate is deterministic — the LLM only adds nuance.")).toBe(
      "The gate is deterministic, the LLM only adds nuance.",
    );
  });

  it("replaces an unspaced connector too (models emit both)", () => {
    expect(deEmDash("Scores are guardbanded—never invented.")).toBe("Scores are guardbanded, never invented.");
  });

  it("handles a pair of dashes wrapping an aside", () => {
    expect(deEmDash("Public scans — always free — never touch credits.")).toBe(
      "Public scans, always free, never touch credits.",
    );
  });
});

describe("deEmDash — the cases a naive replace gets wrong", () => {
  it("does not invent a comma after punctuation that is already there", () => {
    expect(deEmDash("Three things: — CI, tests, docs.")).toBe("Three things: CI, tests, docs.");
  });

  it("drops a leading dash instead of starting the text with a comma", () => {
    expect(deEmDash("— the fleet moved up a level.")).toBe("the fleet moved up a level.");
    expect(deEmDash("Line one\n— line two")).toBe("Line one\nline two");
  });

  it("drops a trailing dash instead of leaving a dangling comma", () => {
    expect(deEmDash("the widest gap is testing —")).toBe("the widest gap is testing");
  });

  it("never produces ', .' before terminal punctuation", () => {
    expect(deEmDash("It shipped —.")).toBe("It shipped.");
    expect(deEmDash("Did it ship —?")).toBe("Did it ship?");
  });

  it("does not strand a comma against a bracket or quote", () => {
    expect(deEmDash("the score (72 — provisional) held")).toBe("the score (72, provisional) held");
    expect(deEmDash("the score (— provisional) held")).toBe("the score (provisional) held");
    expect(deEmDash('he said "— maybe"')).toBe('he said "maybe"');
  });

  it("never leaves a doubled separator", () => {
    expect(deEmDash("a — , b")).toBe("a, b");
    expect(deEmDash("a, — b")).toBe("a, b");
  });
});

describe("deEmDash — what it must leave alone", () => {
  it("returns text with no em dash byte-identical", () => {
    const clean = "A perfectly ordinary sentence, with a comma and a hyphen-joined word.";
    expect(deEmDash(clean)).toBe(clean);
  });

  it("leaves en dashes and hyphens alone (only U+2014 is in scope)", () => {
    expect(deEmDash("scores 51–200, a well-known range")).toBe("scores 51–200, a well-known range");
  });

  it("preserves markdown line breaks (two trailing spaces) and indentation", () => {
    const md = "first line  \n  indented — second";
    expect(deEmDash(md)).toBe("first line  \n  indented, second");
  });

  it("is idempotent — running it twice changes nothing further", () => {
    const once = deEmDash("A — B — C.");
    expect(deEmDash(once)).toBe(once);
  });

  it("removes every em dash it is given, whatever the shape", () => {
    for (const s of ["a—b", "a — b", "— a", "a —", "a—", "—", " — ", "a — b — c —"]) {
      expect(hasEmDash(deEmDash(s))).toBe(false);
    }
  });
});

describe("PROSE_STYLE_RULE", () => {
  it("names the substitutions, not just the prohibition", () => {
    // "Avoid em dashes" on its own reliably yields a page of double hyphens instead.
    expect(PROSE_STYLE_RULE).toContain("--");
    expect(PROSE_STYLE_RULE).toContain("colon");
    expect(PROSE_STYLE_RULE).toContain("parentheses");
  });

  it("does not itself contain an em dash used as a connector", () => {
    // The rule quotes the character once, to name it. It must not model the habit it forbids.
    expect(PROSE_STYLE_RULE.split("—").length - 1).toBe(1);
  });
});
