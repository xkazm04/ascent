// The one shared parser behind every repo input (the hero ScanForm among them). These pin the
// forgiveness contract: any common way a developer copies a repo reference — https URL, www, SSH,
// @handle, .git, trailing slash — must coerce to the same owner/repo everywhere.

import { describe, it, expect } from "vitest";
import { normalizeRepo, parseOwnerRepo, stripRepoRef, validRepoNamePart, REPO_URL_LIKE } from "./repo-ref";

describe("normalizeRepo", () => {
  it.each([
    ["facebook/react", "facebook/react"],
    ["https://github.com/facebook/react", "facebook/react"],
    ["http://www.github.com/facebook/react/", "facebook/react"],
    ["github.com/facebook/react", "facebook/react"],
    ["git@github.com:facebook/react.git", "facebook/react"],
    ["https://github.com/facebook/react.git", "facebook/react"],
    ["@facebook/react", "facebook/react"],
    ["  facebook/react  ", "facebook/react"],
    // Extra path segments (a deep link) keep the leading owner/repo — matches the historic behavior.
    ["https://github.com/facebook/react/tree/main", "facebook/react"],
  ])("coerces %s → %s", (input, expected) => {
    expect(normalizeRepo(input)).toBe(expected);
  });

  it.each([[""], ["   "], ["facebook"], ["owner//"], ["own er/repo"], ["owner/re po"], ["https://github.com/owner"]])(
    "rejects %s",
    (input) => {
      expect(normalizeRepo(input)).toBeNull();
    },
  );
});

describe("parseOwnerRepo", () => {
  it("splits into parts for consumers that need owner and repo separately (badge URLs)", () => {
    expect(parseOwnerRepo("git@github.com:vercel/next.js.git")).toEqual({ owner: "vercel", repo: "next.js" });
    expect(parseOwnerRepo("nonsense")).toBeNull();
  });
});

describe("REPO_URL_LIKE + stripRepoRef (the paste-collapse pair)", () => {
  it("flags URL/SSH chrome and passes bare references through", () => {
    expect(REPO_URL_LIKE.test("https://github.com/a/b")).toBe(true);
    expect(REPO_URL_LIKE.test("git@github.com:a/b.git")).toBe(true);
    expect(REPO_URL_LIKE.test("github.com/a/b")).toBe(true);
    expect(REPO_URL_LIKE.test("a/b")).toBe(false);
  });

  it("peels a partial reference (owner but no repo yet) without validating it", () => {
    expect(stripRepoRef("https://github.com/facebook")).toBe("facebook");
  });
});

// `validRepoNamePart` is the SINGLE SOURCE for GitHub-name-grammar validity: every surface that
// validates a routed or pasted owner/repo segment narrows against this one predicate rather than its
// own regex. The rejections below are the load-bearing half — a leading or doubled dot is what turns
// a name like `owner/.git` into a traversal-shaped segment, and a rule duplicated per call site is a
// rule that drifts until one caller accepts what another rejects.
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
