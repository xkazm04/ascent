import { describe, expect, it } from "vitest";
import { normalizeScanRepo, scanFormLooksLikeGitlab } from "./normalizeScanRepo";

describe("normalizeScanRepo", () => {
  it("keeps GitHub pastes as owner/repo — github-first, same as parseForgeUrl", () => {
    expect(normalizeScanRepo("facebook/react")).toBe("facebook/react");
    expect(normalizeScanRepo("https://github.com/facebook/react")).toBe("facebook/react");
    expect(normalizeScanRepo("git@github.com:facebook/react.git")).toBe("facebook/react");
  });

  it("routes a gitlab.com paste to the gitlab: identity scanRepository already persists", () => {
    expect(normalizeScanRepo("https://gitlab.com/group/project")).toBe("gitlab:group/project");
    expect(normalizeScanRepo("https://gitlab.com/group/sub/project")).toBe("gitlab:group/sub/project");
    expect(normalizeScanRepo("git@gitlab.com:group/project.git")).toBe("gitlab:group/project");
    expect(normalizeScanRepo("gitlab.com/group/project")).toBe("gitlab:group/project");
    expect(normalizeScanRepo("https://gitlab.com/g/p/-/tree/main")).toBe("gitlab:g/p");
    expect(normalizeScanRepo("gitlab:group/sub/project")).toBe("gitlab:group/sub/project");
  });

  it("does not GitHub-mangle a GitLab URL into gitlab.com/<first-segment>", () => {
    expect(normalizeScanRepo("https://gitlab.com/group/project")).not.toBe("gitlab.com/group");
  });

  it("rejects a GitLab host with no project segment instead of inventing a GitHub coordinate", () => {
    expect(normalizeScanRepo("https://gitlab.com/group")).toBeNull();
  });

  it("rejects empty and unparseable input", () => {
    expect(normalizeScanRepo("")).toBeNull();
    expect(normalizeScanRepo("   ")).toBeNull();
    expect(normalizeScanRepo("not-a-repo")).toBeNull();
  });
});

describe("scanFormLooksLikeGitlab", () => {
  it("claims gitlab.com URLs, SSH, host-qualified paths, and the gitlab: prefix", () => {
    expect(scanFormLooksLikeGitlab("https://gitlab.com/g/p")).toBe(true);
    expect(scanFormLooksLikeGitlab("git@gitlab.com:g/p.git")).toBe(true);
    expect(scanFormLooksLikeGitlab("gitlab.com/g/p")).toBe(true);
    expect(scanFormLooksLikeGitlab("gitlab:g/p")).toBe(true);
  });

  it("does not claim a GitHub coordinate or a lookalike host", () => {
    expect(scanFormLooksLikeGitlab("facebook/react")).toBe(false);
    expect(scanFormLooksLikeGitlab("https://github.com/o/r")).toBe(false);
    expect(scanFormLooksLikeGitlab("https://notgitlab.com/a/b")).toBe(false);
    expect(scanFormLooksLikeGitlab("https://gitlab.com.evil.com/a/b")).toBe(false);
  });
});
