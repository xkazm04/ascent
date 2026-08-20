// G5-28: `validRepoNamePart` is the SINGLE SOURCE for GitHub-name-grammar validity, shared by the
// client (`BadgeGenerator`'s `parseRepo`) and the server (`/api/badge/[owner]/[repo]`'s `validName`,
// which layers a per-segment length cap on top of this same function). Before this fix each side had
// its own regex and the client's didn't reject leading/consecutive dots, so a name like `owner/.git`
// passed client-side validation and produced a snippet the server always rendered as "unknown" — a
// generated badge URL that 404s in spirit (renders as broken/unknown) for the user who just built it.
// Pinning the shared predicate here is what makes "client and server accept exactly the same names"
// true by construction rather than by two regexes staying accidentally in sync.

import { describe, it, expect } from "vitest";
import { rubricPinState, rubricQualifier, validRepoNamePart } from "./badge";

describe("validRepoNamePart", () => {
  const REJECT: ReadonlyArray<[string, string]> = [
    ["", "empty string"],
    [".", "bare single dot"],
    ["..", "bare parent dir (traversal)"],
    ["...", "all-dots"],
    [".git", "leading-dot dotfile"],
    ["..foo", "leading double-dot"],
    [".github", "leading-dot"],
    ["a..b", "embedded consecutive dots"],
    ["../etc", "traversal segment"],
    ["a/b", "embedded forward slash"],
    ["a b", "embedded space"],
    ["café", "non-ASCII letter"],
  ];

  const ACCEPT: ReadonlyArray<[string, string]> = [
    ["facebook", "plain owner"],
    ["react", "plain repo"],
    ["a.b", "single interior dot"],
    ["my-repo_1", "hyphen + underscore + digit"],
    ["node.js", "dotted name like node.js"],
    ["a", "single char"],
    ["repo-2.0.1", "version-style dotted name"],
  ];

  for (const [name, why] of REJECT) {
    it(`rejects ${JSON.stringify(name)} (${why})`, () => {
      expect(validRepoNamePart(name)).toBe(false);
    });
  }

  for (const [name, why] of ACCEPT) {
    it(`accepts ${JSON.stringify(name)} (${why})`, () => {
      expect(validRepoNamePart(name)).toBe(true);
    });
  }
});

// --- rubric pinning -----------------------------------------------------------------------------
// A badge is a verdict about someone, pasted into THEIR README and read by people who never click
// through. The generator already pins the gate's `min_level` so the badge can't advertise a bar its
// author never chose; the rubric behind a level/score verdict is the same kind of parameter, and
// SCORING_RUBRIC_VERSION has already moved r6→r7. Unpinned, a rubric revision makes the owner's pasted
// badge restate a claim they never made. These pin the two halves of the contract: WHICH pins are
// trusted (a narrow grammar, because this arrives on an unauthenticated public endpoint and widens the
// set of cacheable URLs), and WHEN the badge must disclose staleness in its value.
describe("rubricPinState", () => {
  it("reports no pin for an absent/empty param (a hand-written or pre-pinning URL)", () => {
    expect(rubricPinState(null, "r7")).toBe("unpinned");
    expect(rubricPinState(undefined, "r7")).toBe("unpinned");
    expect(rubricPinState("", "r7")).toBe("unpinned");
  });

  it("reports `current` only for an exact match with the live rubric", () => {
    expect(rubricPinState("r7", "r7")).toBe("current");
    expect(rubricPinState("R7", "r7")).toBe("malformed"); // case is not normalized — an id, not text
  });

  it("reports `superseded` for an older (or simply different) valid rubric id", () => {
    expect(rubricPinState("r6", "r7")).toBe("superseded");
    expect(rubricPinState("r1", "r7")).toBe("superseded");
    expect(rubricPinState("r8", "r7")).toBe("superseded"); // a pin from a newer deploy is still not ours
  });

  it("rejects anything that is not a rubric id as malformed (never rendered, never trusted)", () => {
    for (const junk of ["r", "7", "rr7", "r7 ", "r-7", "r1234", "<script>", "r7;a", "../r7"]) {
      expect(rubricPinState(junk, "r7")).toBe("malformed");
    }
  });
});

describe("rubricQualifier — staleness lives in the badge VALUE (G5-29 idiom)", () => {
  it("is EMPTY for a current pin, so a pinned badge renders byte-identically to the canonical one", () => {
    // This is load-bearing beyond cosmetics: identical bytes are what let the route keep a
    // current-rubric pin shared-cacheable and countable instead of `private` and untallied.
    expect(rubricQualifier("r7", "r7")).toBe("");
  });

  it("is empty for an unpinned or malformed param (nothing was promised; junk is never echoed)", () => {
    expect(rubricQualifier(null, "r7")).toBe("");
    expect(rubricQualifier("<script>", "r7")).toBe("");
  });

  it("names BOTH rubrics for a superseded pin, in the `· demo` value-qualifier idiom", () => {
    // Both halves matter: the reader learns what the author pasted under AND what it is being
    // scored under now. A cropped badge keeps only the value chip, which is why this is not a label.
    expect(rubricQualifier("r6", "r7")).toBe(" · rubric r6→r7");
  });
});
