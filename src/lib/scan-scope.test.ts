// Scan SCOPE — the pure half (src/lib/scan-scope.ts). These are the predicates the two scan routes,
// the cache-key builder and the scan form all share, so every collision/trust rule the ref + sub-path
// features rest on is pinned here rather than re-argued at each call site.

import { describe, it, expect } from "vitest";
import {
  isScopedScan,
  isUnderSubPath,
  isValidGitRef,
  normalizeSubPath,
  scopeCacheSegment,
  scopeWarning,
} from "./scan-scope";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

describe("isValidGitRef", () => {
  it("accepts ordinary branch, tag and sha refs", () => {
    for (const ref of ["main", "develop", "release/2.1", "v1.0.0", "feature/JIRA-42_fix", SHA_A]) {
      expect(isValidGitRef(ref), ref).toBe(true);
    }
  });

  it("rejects anything that could escape a URL path segment", () => {
    // The ref is interpolated into GitHub REST/raw URLs, so a query string, a fragment, whitespace or
    // a traversal must never reach the builders — this is the guard that keeps that true.
    for (const ref of [
      "main?x=1",
      "main#frag",
      "main branch",
      "../../etc/passwd",
      "a..b",
      "refs//heads",
      "/main",
      "main/",
      "-delete",
      "main.lock",
      "feature/.hidden",
      "héllo",
      "",
      "a".repeat(256),
    ]) {
      expect(isValidGitRef(ref), ref).toBe(false);
    }
  });
});

describe("normalizeSubPath", () => {
  it("normalizes the shapes users actually type", () => {
    expect(normalizeSubPath("packages/api")).toBe("packages/api");
    expect(normalizeSubPath("/packages/api/")).toBe("packages/api");
    expect(normalizeSubPath("./packages/api")).toBe("packages/api");
    expect(normalizeSubPath("  apps/web  ")).toBe("apps/web");
  });

  it("rejects traversal, absolute-ish and out-of-charset paths", () => {
    for (const p of ["..", "packages/../..", "a//b", "C:\\win", "pkg/*", "pkg?x", "", "   ", "a".repeat(201)]) {
      expect(normalizeSubPath(p), p).toBeNull();
    }
  });
});

describe("isUnderSubPath — prefix safety", () => {
  it("matches the directory and its descendants only", () => {
    expect(isUnderSubPath("packages/api", "packages/api")).toBe(true);
    expect(isUnderSubPath("packages/api/src/index.ts", "packages/api")).toBe(true);
  });

  it("does not match a SIBLING whose name merely starts with the prefix", () => {
    // The bug a naive startsWith() would have: `packages/api` must not swallow `packages/api-client`.
    expect(isUnderSubPath("packages/api-client/src/index.ts", "packages/api")).toBe(false);
    expect(isUnderSubPath("packages/apiary", "packages/api")).toBe(false);
  });
});

describe("isScopedScan — what may enter the shared corpus", () => {
  it("an unscoped request is never scoped", () => {
    expect(isScopedScan({}, SHA_A)).toBe(false);
  });

  it("a ref that resolves to the DEFAULT head is not scoped (full cache reuse, normal persistence)", () => {
    // `?ref=main` must not be demoted: same commit, same tree, same score as a plain scan.
    expect(isScopedScan({ ref: "main", refSha: SHA_A }, SHA_A)).toBe(false);
    expect(isScopedScan({ ref: "MAIN", refSha: SHA_A.toUpperCase() }, SHA_A)).toBe(false);
  });

  it("a ref that resolves to a DIFFERENT commit is scoped", () => {
    expect(isScopedScan({ ref: "develop", refSha: SHA_B }, SHA_A)).toBe(true);
  });

  it("a sub-path is always scoped, even at the default head", () => {
    expect(isScopedScan({ subPath: "packages/api" }, SHA_A)).toBe(true);
    expect(isScopedScan({ ref: "main", refSha: SHA_A, subPath: "packages/api" }, SHA_A)).toBe(true);
  });

  it("fails to the SAFE side when the default head is unknown", () => {
    // No proof it's the default branch ⇒ treat as scoped ⇒ don't persist. Never the other way round.
    expect(isScopedScan({ ref: "develop", refSha: SHA_B }, null)).toBe(true);
  });
});

describe("scopeCacheSegment", () => {
  it("is undefined for a ref-only scan — two ref NAMES at one commit are the same scan", () => {
    expect(scopeCacheSegment({ ref: "develop", refSha: SHA_B })).toBeUndefined();
  });

  it("carries the sub-path, which changes what is read at the SAME commit", () => {
    expect(scopeCacheSegment({ subPath: "packages/api" })).toBe("path:packages/api");
  });
});

describe("scopeWarning", () => {
  it("says nothing for an unscoped scan", () => {
    expect(scopeWarning({})).toBeNull();
  });

  it("names both consequences: not comparable, and not saved", () => {
    const w = scopeWarning({ ref: "develop", refSha: SHA_B, subPath: "packages/api" });
    expect(w).toContain("develop");
    expect(w).toContain("packages/api");
    expect(w).toMatch(/not comparable/i);
    expect(w).toMatch(/not saved/i);
  });

  it("does not claim a ref was used when only the sub-path is scoped", () => {
    expect(scopeWarning({ subPath: "apps/web" })).not.toMatch(/ref/i);
  });
});
