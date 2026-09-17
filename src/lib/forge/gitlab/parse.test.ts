import { describe, expect, it } from "vitest";
import { gitlabForge } from "./source";
import { parseGitlabUrl } from "./parse";

describe("parseGitlabUrl is the routed GitLab parser", () => {
  it("is gitlabForge.parseUrl, so ScanForm and scanRepository cannot disagree", () => {
    expect(gitlabForge.parseUrl).toBe(parseGitlabUrl);
  });
});

describe("parseGitlabUrl", () => {
  it.each([
    ["https://gitlab.com/group/project", { owner: "group", repo: "project" }],
    ["https://gitlab.com/group/sub/project", { owner: "group/sub", repo: "project" }],
    ["https://www.gitlab.com/group/project.git", { owner: "group", repo: "project" }],
    ["git@gitlab.com:group/project.git", { owner: "group", repo: "project" }],
    ["gitlab.com/group/project", { owner: "group", repo: "project" }],
    ["https://gitlab.com/g/p/-/merge_requests/7", { owner: "g", repo: "p", prNumber: 7 }],
    ["https://gitlab.com/g/p/-/tree/main", { owner: "g", repo: "p", ref: "main" }],
    ["group/sub/project", { owner: "group/sub", repo: "project" }],
  ])("parses %s", (input, expected) => {
    expect(parseGitlabUrl(input)).toEqual(expected);
  });

  it("accepts a configured self-managed host", () => {
    const host = { apiBase: "https://gitlab.acme.com/api/v4", webBase: "https://gitlab.acme.com" };
    expect(parseGitlabUrl("https://gitlab.acme.com/acme/api", host)).toEqual({ owner: "acme", repo: "api" });
    expect(parseGitlabUrl("git@gitlab.acme.com:acme/api", host)).toEqual({ owner: "acme", repo: "api" });
  });

  it.each([
    "",
    "https://github.com/o/r",
    "https://evil.com/a/b",
    "https://gitlab.com.evil.com/a/b",
    "https://gitlab.com/group",
    "https://gitlab.com/../etc",
    "bitbucket.org/o/r",
  ])("rejects %s", (input) => {
    expect(parseGitlabUrl(input)).toBeNull();
  });
});
