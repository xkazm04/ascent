// The one shared parser behind every repo input (ScanForm, BadgeGenerator). These pin the
// forgiveness contract: any common way a developer copies a repo reference — https URL, www, SSH,
// @handle, .git, trailing slash — must coerce to the same owner/repo everywhere.

import { describe, it, expect } from "vitest";
import { normalizeRepo, parseOwnerRepo, stripRepoRef, REPO_URL_LIKE } from "./repo-ref";

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
