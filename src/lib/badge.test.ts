// G5-28: `validRepoNamePart` is the SINGLE SOURCE for GitHub-name-grammar validity, shared by the
// client (`BadgeGenerator`'s `parseRepo`) and the server (`/api/badge/[owner]/[repo]`'s `validName`,
// which layers a per-segment length cap on top of this same function). Before this fix each side had
// its own regex and the client's didn't reject leading/consecutive dots, so a name like `owner/.git`
// passed client-side validation and produced a snippet the server always rendered as "unknown" — a
// generated badge URL that 404s in spirit (renders as broken/unknown) for the user who just built it.
// Pinning the shared predicate here is what makes "client and server accept exactly the same names"
// true by construction rather than by two regexes staying accidentally in sync.

import { describe, it, expect } from "vitest";
import { validRepoNamePart } from "./badge";

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
