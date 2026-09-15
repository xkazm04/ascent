// The router's contract: GITHUB FIRST, and nothing that parsed before parses differently now.
//
// FAIL-BEFORE (verified, see the handoff): with only `github` registered — the tree as it stood
// before this lane — `resolveForge({forge:"gitlab"})` returns the GitHub adapter and
// `parseForgeUrl("https://gitlab.com/g/p")` returns null. Both cases below go red.

import { describe, expect, it } from "vitest";
import {
  forgeCapabilities,
  forgeFullName,
  parseForgeUrl,
  registeredForges,
  resolveForge,
  splitForgeFullName,
} from "@/lib/forge/registry";
import { githubForge } from "@/lib/forge/github";
import { gitlabForge } from "@/lib/forge/gitlab/source";
import { localForge } from "@/lib/forge/local";
import { parseRepoUrl } from "@/lib/github/source";

describe("forge registry", () => {
  it("registers github FIRST — the ordering that makes every existing input parse identically", () => {
    expect(registeredForges().map((f) => f.id)).toEqual(["github", "gitlab", "local"]);
  });

  it("resolves each registered id, and defaults anything unrecognized to github", () => {
    expect(resolveForge({ forge: "github" })).toBe(githubForge);
    expect(resolveForge({ forge: "gitlab" })).toBe(gitlabForge);
    expect(resolveForge({ forge: "local" })).toBe(localForge);
    // A column written by an older build, a typo'd query param, a null — all mean GitHub, because
    // GitHub is what every pre-#4 row means. Guessing a different forge would point a scan at the
    // wrong API entirely.
    expect(resolveForge({ forge: "bitbucket" })).toBe(githubForge);
    expect(resolveForge({ forge: null })).toBe(githubForge);
    expect(resolveForge()).toBe(githubForge);
  });

  it("exposes the capability manifest, with unknown ids reading as github's", () => {
    expect(forgeCapabilities("gitlab").appInventory).toBe(false);
    expect(forgeCapabilities("gitlab").securityPosture).toBe(false);
    expect(forgeCapabilities("gitlab").write).toBe(false);
    expect(forgeCapabilities("github").appInventory).toBe(true);
    expect(forgeCapabilities("nope")).toBe(forgeCapabilities("github"));
  });

  describe("parseForgeUrl", () => {
    it("routes every shape parseRepoUrl accepts to github, with the same coordinate", () => {
      for (const input of [
        "owner/repo",
        "github.com/owner/repo",
        "https://github.com/owner/repo",
        "https://github.com/owner/repo/pull/123",
        "https://github.com/owner/repo/tree/main",
        "git@github.com:owner/repo.git",
      ]) {
        const routed = parseForgeUrl(input);
        expect(routed?.forge, input).toBe("github");
        const coordinate = { ...routed };
        delete (coordinate as { forge?: unknown }).forge;
        expect(coordinate, input).toEqual(parseRepoUrl(input));
      }
    });

    it("routes an explicit gitlab.com URL that parseRepoUrl rejects outright", () => {
      expect(parseRepoUrl("https://gitlab.com/group/project")).toBeNull();
      expect(parseForgeUrl("https://gitlab.com/group/project")).toEqual({
        forge: "gitlab",
        owner: "group",
        repo: "project",
      });
    });

    it("keeps a SUBGROUP path whole — losing it would 404 every read", () => {
      expect(parseForgeUrl("https://gitlab.com/group/sub/project")).toEqual({
        forge: "gitlab",
        owner: "group/sub",
        repo: "project",
      });
    });

    it("strips GitLab's /-/ deep-link segments", () => {
      expect(parseForgeUrl("https://gitlab.com/g/p/-/merge_requests/7")).toEqual({
        forge: "gitlab",
        owner: "g",
        repo: "p",
      });
    });

    it("honours an explicit <forge>: prefix without letting a URL scheme look like one", () => {
      expect(parseForgeUrl("gitlab:group/sub/project")).toEqual({
        forge: "gitlab",
        owner: "group/sub",
        repo: "project",
      });
      expect(parseForgeUrl("local:acme/app")).toEqual({ forge: "local", owner: "acme", repo: "app" });
      // `https://…` must never be read as a forge named "https".
      expect(parseForgeUrl("https://github.com/o/r")?.forge).toBe("github");
      expect(parseForgeUrl("bitbucket:o/r")).toBeNull();
    });

    it("keeps a BARE owner/repo meaning github, as it always has", () => {
      expect(parseForgeUrl("group/project")?.forge).toBe("github");
    });

    it("rejects traversal shapes on every forge", () => {
      expect(parseForgeUrl("https://gitlab.com/../etc")).toBeNull();
      expect(parseForgeUrl("gitlab:.hidden/project")).toBeNull();
      expect(parseForgeUrl("")).toBeNull();
    });
  });

  describe("identity", () => {
    it("leaves GitHub fullNames byte-identical, so the live unique needs no migration", () => {
      expect(forgeFullName("github", "acme", "app")).toBe("acme/app");
      expect(forgeFullName(undefined, "acme", "app")).toBe("acme/app");
    });

    it("namespaces a non-GitHub repo in the VALUE", () => {
      expect(forgeFullName("gitlab", "group/sub", "project")).toBe("gitlab:group/sub/project");
    });

    it("round-trips, and reads an unprefixed value as github", () => {
      expect(splitForgeFullName("gitlab:group/sub/project")).toEqual({
        forge: "gitlab",
        fullName: "group/sub/project",
      });
      expect(splitForgeFullName("acme/app")).toEqual({ forge: "github", fullName: "acme/app" });
    });
  });

  it("gives local no root-free source — the pairing is the seam, and it says so", () => {
    expect(() => localForge.source()).toThrow(/paired working copy/i);
  });

  it("builds honest permalinks per forge", () => {
    expect(githubForge.permalink({ owner: "o", repo: "r" })).toBe("https://github.com/o/r");
    expect(gitlabForge.permalink({ owner: "g/s", repo: "p" }, "abc")).toBe(
      "https://gitlab.com/g/s/p/-/tree/abc",
    );
    // A working copy has no web home; a fabricated github.com URL for unpushed code would be a lie.
    expect(localForge.permalink({ owner: "acme", repo: "app" })).toBe("local:acme/app");
  });
});
