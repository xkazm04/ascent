// Regression tests for SHA-drift prevention (scan-and-decide idea 744fc886): when the routes
// pass the head sha already resolved for the cache key, the scan must pin ingestion to it and
// stamp it as the report's commit identity — so the cache key and the scored commit agree even
// if a push lands between the head lookup and the tree read. An explicit PR `ref` still wins.
//
// A mock RepoSource keeps this fully offline; mock:true + no token avoids every network call.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { scanRepository } from "./scan";
import type { FetchOptions, ParsedRepo, RepoSource } from "@/lib/github/source";
import type { RepoSnapshot } from "@/lib/types";

const NOW = "2026-06-02T00:00:00Z";

/** A RepoSource that returns a fixed snapshot (its meta.headSha is the TREE sha) and records the
 *  FetchOptions it was called with, so a test can assert which ref ingestion was pinned to. */
function mockSource(treeSha: string) {
  let captured: FetchOptions | undefined;
  const source: RepoSource = {
    async fetchSnapshot(_repo: ParsedRepo, opts: FetchOptions = {}): Promise<RepoSnapshot> {
      captured = opts;
      return {
        meta: { owner: "o", name: "r", url: "", stars: 0, forks: 0, defaultBranch: "main", headSha: treeSha },
        tree: [{ path: "README.md", type: "blob" }],
        files: [{ path: "README.md", content: "# r", bytes: 3 }],
        commits: [{ message: "feat: x" }],
        truncated: false,
        coverage: 1,
      };
    },
  };
  return { source, ref: () => captured?.ref };
}

describe("scanRepository — head sha threading (#6)", () => {
  // Ensure no ambient GITHUB_TOKEN triggers PR/governance network calls.
  beforeEach(() => vi.stubEnv("GITHUB_TOKEN", ""));
  afterEach(() => vi.unstubAllEnvs());

  it("stamps the report with the resolved commit sha (not the tree sha) and pins ingestion to it", async () => {
    const { source, ref } = mockSource("treesha-aaa");
    const report = await scanRepository("o/r", { source, mock: true, now: NOW, headSha: "commitsha-zzz" });
    expect(report.repo.headSha).toBe("commitsha-zzz");
    expect(ref()).toBe("commitsha-zzz");
  });

  it("leaves the snapshot's own headSha and an unpinned ref when none is threaded", async () => {
    const { source, ref } = mockSource("treesha-aaa");
    const report = await scanRepository("o/r", { source, mock: true, now: NOW });
    expect(report.repo.headSha).toBe("treesha-aaa");
    expect(ref()).toBeUndefined();
  });

  it("lets an explicit PR ref win over headSha (no stamping)", async () => {
    const { source, ref } = mockSource("treesha-aaa");
    const report = await scanRepository("o/r", {
      source,
      mock: true,
      now: NOW,
      ref: "pr-branch",
      headSha: "commitsha-zzz",
    });
    expect(ref()).toBe("pr-branch");
    expect(report.repo.headSha).toBe("treesha-aaa");
  });
});
