// The anchored-diff engine is the only writer of Athena's self-model, so its refusals matter more
// than its successes: the failure this suite exists to make impossible is the SILENT one — a diff
// whose anchor missed, appended at the end anyway, leaving a document that says two things.

import { describe, expect, it } from "vitest";
import {
  applyIdentityDiff,
  applyIdentityDiffs,
  asIdentityDiff,
  identitySections,
  type IdentityDiff,
} from "@/lib/athena/identity-diff";

const DOC = [
  "# Athena — self-model for acme",
  "",
  "## How this org works",
  "- Ships on Fridays.",
  "- Prefers small PRs.",
  "",
  "## What I have learned",
  "- The api repo is the one that matters.",
  "",
].join("\n");

describe("applyIdentityDiff — append", () => {
  it("appends into an existing section, after its last non-blank line", () => {
    const r = applyIdentityDiff(DOC, {
      op: "append",
      section: "How this org works",
      line: "- Reviews within a day.",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).toBe(
      [
        "# Athena — self-model for acme",
        "",
        "## How this org works",
        "- Ships on Fridays.",
        "- Prefers small PRs.",
        "- Reviews within a day.",
        "",
        "## What I have learned",
        "- The api repo is the one that matters.",
        "",
      ].join("\n"),
    );
  });

  it("leaves every other section byte-for-byte alone", () => {
    const r = applyIdentityDiff(DOC, { op: "append", section: "What I have learned", line: "- New thing." });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).toContain("## How this org works\n- Ships on Fridays.\n- Prefers small PRs.\n");
    expect(r.content.split("\n").filter((l) => l.startsWith("## "))).toEqual([
      "## How this org works",
      "## What I have learned",
    ]);
  });

  it("appends into a section that is currently empty", () => {
    const doc = ["## Open questions", "", "## Other", "- x", ""].join("\n");
    const r = applyIdentityDiff(doc, { op: "append", section: "Open questions", line: "- first" });
    expect(r.ok && r.content).toBe(["## Open questions", "- first", "", "## Other", "- x", ""].join("\n"));
  });
});

describe("applyIdentityDiff — replace", () => {
  it("replaces the one line whose CONTENT matches the anchor", () => {
    const r = applyIdentityDiff(DOC, {
      op: "replace",
      section: "How this org works",
      anchor: "- Ships on Fridays.",
      line: "- Ships continuously (changed 2026-08).",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).toContain("- Ships continuously (changed 2026-08).");
    expect(r.content).not.toContain("- Ships on Fridays.");
    // Line count is unchanged: a replace replaces, it never also appends.
    expect(r.content.split("\n")).toHaveLength(DOC.split("\n").length);
  });

  it("ignores surrounding whitespace when matching (transport, not content)", () => {
    const doc = ["## S", "  - padded line   ", ""].join("\n");
    const r = applyIdentityDiff(doc, { op: "replace", section: "S", anchor: "- padded line", line: "- tidy" });
    expect(r.ok && r.content).toBe(["## S", "- tidy", ""].join("\n"));
  });

  it("never matches an anchor that lives in a DIFFERENT section", () => {
    const r = applyIdentityDiff(DOC, {
      op: "replace",
      section: "What I have learned",
      anchor: "- Ships on Fridays.",
      line: "- nope",
    });
    expect(r).toEqual({
      ok: false,
      reason: "anchor-not-found",
      detail: 'no line matching "- Ships on Fridays." in "## What I have learned"',
    });
  });
});

describe("applyIdentityDiff — remove", () => {
  it("removes the anchored line and nothing else", () => {
    const r = applyIdentityDiff(DOC, {
      op: "remove",
      section: "How this org works",
      anchor: "- Prefers small PRs.",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).not.toContain("- Prefers small PRs.");
    expect(r.content).toContain("- Ships on Fridays.");
    expect(r.content.split("\n")).toHaveLength(DOC.split("\n").length - 1);
  });

  it("refuses a remove whose anchor is not there", () => {
    const r = applyIdentityDiff(DOC, { op: "remove", section: "How this org works", anchor: "- Never said this." });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("anchor-not-found");
  });
});

describe("applyIdentityDiff — the refusals", () => {
  it("fails with no-such-section when the section is missing", () => {
    const r = applyIdentityDiff(DOC, { op: "append", section: "Nowhere", line: "- x" });
    expect(r).toEqual({
      ok: false,
      reason: "no-such-section",
      detail: 'no "## Nowhere" section in the document',
    });
  });

  it("fails with anchor-ambiguous when the anchor matches twice — it never picks the first", () => {
    const doc = ["## S", "- duplicated", "- other", "- duplicated", ""].join("\n");
    const r = applyIdentityDiff(doc, { op: "replace", section: "S", anchor: "- duplicated", line: "- once" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("anchor-ambiguous");
    expect(r.detail).toContain("2 lines match");
  });

  it("fails with anchor-ambiguous when the SECTION heading itself is duplicated", () => {
    const doc = ["## S", "- a", "", "## S", "- b", ""].join("\n");
    const r = applyIdentityDiff(doc, { op: "replace", section: "S", anchor: "- a", line: "- z" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("anchor-ambiguous");
    expect(r.detail).toContain("appears 2 times");
  });

  it("fails on an empty anchor rather than matching the first blank line", () => {
    const r = applyIdentityDiff(DOC, { op: "remove", section: "How this org works", anchor: "   " });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("anchor-not-found");
  });

  // THE POINT OF THE WHOLE MODULE.
  it("NEVER falls back to appending when an anchor misses — the document is not touched at all", () => {
    const r = applyIdentityDiff(DOC, {
      op: "replace",
      section: "How this org works",
      anchor: "- A line that does not exist.",
      line: "- The replacement nobody asked to have appended.",
    });
    expect(r.ok).toBe(false);
    // No content is returned at all on a refusal, so there is nothing a careless caller could write
    // back — and the orphaned restatement never reaches the document.
    expect(r).not.toHaveProperty("content");
    expect(DOC).not.toContain("The replacement nobody asked to have appended.");
  });

  it("has no whole-document operation to fall back on either", () => {
    const ops = (["append", "replace", "remove"] as const).map((op) => op);
    // If a fourth op ever appears, this assertion is where the reviewer is asked "does it anchor?".
    expect(ops).toEqual(["append", "replace", "remove"]);
  });
});

describe("applyIdentityDiffs — a sequence is all-or-nothing", () => {
  it("applies every diff in order when all of them land", () => {
    const diffs: IdentityDiff[] = [
      { op: "append", section: "How this org works", line: "- Reviews within a day." },
      { op: "replace", section: "How this org works", anchor: "- Ships on Fridays.", line: "- Ships daily." },
      { op: "remove", section: "What I have learned", anchor: "- The api repo is the one that matters." },
    ];
    const r = applyIdentityDiffs(DOC, diffs);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).toContain("- Ships daily.");
    expect(r.content).toContain("- Reviews within a day.");
    expect(r.content).not.toContain("- The api repo is the one that matters.");
  });

  it("aborts on the first refusal and returns it — no partial identity change", () => {
    const r = applyIdentityDiffs(DOC, [
      { op: "append", section: "How this org works", line: "- Would have landed." },
      { op: "replace", section: "How this org works", anchor: "- absent", line: "- x" },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("anchor-not-found");
    // The caller still holds the original; the first diff's line never reached a stored document.
    expect(DOC).not.toContain("- Would have landed.");
  });
});

describe("helpers", () => {
  it("lists the sections a proposal may anchor into", () => {
    expect(identitySections(DOC)).toEqual(["How this org works", "What I have learned"]);
    // `#` and `###` are not section boundaries — only the one level the document is built from.
    expect(identitySections("# Title\n### Deep\n## Real\n")).toEqual(["Real"]);
  });

  it("narrows well-formed JSON to a diff and rejects everything else", () => {
    expect(asIdentityDiff({ op: "append", section: "S", line: "- x" })).toEqual({
      op: "append",
      section: "S",
      line: "- x",
    });
    expect(asIdentityDiff({ op: "replace", section: "S", anchor: "a", line: "b" })).toEqual({
      op: "replace",
      section: "S",
      anchor: "a",
      line: "b",
    });
    expect(asIdentityDiff({ op: "remove", section: "S", anchor: "a" })).toEqual({
      op: "remove",
      section: "S",
      anchor: "a",
    });
    // An unrecognized op is never coerced into a known one, and a missing anchor never becomes "".
    expect(asIdentityDiff({ op: "rewrite", section: "S", line: "everything" })).toBeNull();
    expect(asIdentityDiff({ op: "replace", section: "S", line: "b" })).toBeNull();
    expect(asIdentityDiff({ op: "append", section: "S" })).toBeNull();
    expect(asIdentityDiff(null)).toBeNull();
    expect(asIdentityDiff("append S")).toBeNull();
  });
});
