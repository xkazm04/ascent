// openFoundationPrBatch — the fleet fan-out's two load-bearing properties:
//
//   1. PER-REPO ISOLATION. One repo throwing (a spine 409 "already installed", a 403 from an
//      installation without write access, a bare network error) must never abort the pool: an N-repo
//      batch always returns N rows, in input order, with the failures reported rather than raised.
//      Without this, one already-installed repo silently costs the user the whole rollout.
//   2. BOUNDED CONCURRENCY. At most `concurrency` PRs are in flight at once — the reason this route
//      can be pointed at a 25-repo fleet without hammering GitHub or blowing the function ceiling.
//
// openDraftPr is mocked; openFoundationPr (the real one) sits between it and the batch, so the
// spine-vs-later-file collision policy is exercised for real too.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { AppApiError } = await vi.importActual<typeof import("@/lib/github/app")>("@/lib/github/app");

vi.mock("@/lib/github/write", () => ({ openDraftPr: vi.fn() }));

import { openFoundationPrBatch } from "./pr";
import { openDraftPr } from "@/lib/github/write";
import type { GeneratedFile } from "./types";

const mockPr = vi.mocked(openDraftPr);

const files = (n = 2): GeneratedFile[] =>
  Array.from({ length: n }, (_, i) => ({ path: i === 0 ? ".ai/manifest.yaml" : `.ai/f${i}.md`, body: "x" }));

const repo = (name: string) => ({ name, files: files(), prTitle: "t", prBody: "b" });

/** Track in-flight PUTs so the concurrency bound is measured, not assumed. */
let inFlight = 0;
let peak = 0;

beforeEach(() => {
  mockPr.mockReset();
  inFlight = 0;
  peak = 0;
});

/** Default: every file succeeds; `fail` decides which repo throws what. */
function route(fail: (repoName: string) => unknown = () => undefined) {
  mockPr.mockImplementation(async (args: { repo: string; path: string }) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    try {
      await new Promise((r) => setTimeout(r, 1));
      const thrown = fail(args.repo);
      if (thrown !== undefined) throw thrown;
      return { url: `https://gh/${args.repo}/pull/7`, number: 7, branch: "ascent/ai-foundation", reused: false };
    } finally {
      inFlight -= 1;
    }
  });
}

describe("openFoundationPrBatch", () => {
  it("returns one row per repo, in input order, with owner/name attribution", async () => {
    route();
    const results = await openFoundationPrBatch({
      token: "t",
      owner: "acme",
      repos: [repo("a"), repo("b"), repo("c")],
    });
    expect(results.map((r) => r.repo)).toEqual(["acme/a", "acme/b", "acme/c"]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results[0]).toMatchObject({ url: "https://gh/a/pull/7", number: 7, reused: false, committed: 2 });
  });

  it("one repo failing leaves every other repo ok:true", async () => {
    route((name) => (name === "b" ? new AppApiError(403, "/x", "Resource not accessible") : undefined));
    const results = await openFoundationPrBatch({
      token: "t",
      owner: "acme",
      repos: [repo("a"), repo("b"), repo("c")],
    });
    expect(results.map((r) => r.ok)).toEqual([true, false, true]);
    expect(results[1]!.error).toMatch(/permissions/i);
  });

  it("a SPINE 409 becomes an ok:false row carrying GitHub's own message, not a throw", async () => {
    route((name) => (name === "b" ? new AppApiError(409, "/x", "already exists") : undefined));
    const results = await openFoundationPrBatch({ token: "t", owner: "acme", repos: [repo("a"), repo("b")] });
    expect(results[1]!.ok).toBe(false);
    expect(results[1]!.error).toContain("409");
  });

  it("a non-App error still reports rather than rejecting the pool", async () => {
    route((name) => (name === "a" ? new TypeError("socket hang up") : undefined));
    const results = await openFoundationPrBatch({ token: "t", owner: "acme", repos: [repo("a"), repo("b")] });
    expect(results[0]).toMatchObject({ ok: false, error: "Failed to open the foundation PR." });
    expect(results[1]!.ok).toBe(true);
  });

  it("a LATER file's 409 is skipped (not fatal) — the rest of the foundation still lands", async () => {
    // openFoundationPr's own policy: the spine may not collide, but a pre-existing CONTEXT.md may.
    mockPr.mockImplementation(async (args: { repo: string; path: string }) => {
      if (args.path !== ".ai/manifest.yaml") throw new AppApiError(409, "/x", "exists");
      return { url: "https://gh/a/pull/7", number: 7, branch: "ascent/ai-foundation", reused: false };
    });
    const results = await openFoundationPrBatch({ token: "t", owner: "acme", repos: [repo("a")] });
    expect(results[0]).toMatchObject({ ok: true, committed: 1, skipped: [".ai/f1.md"] });
  });

  it("never runs more than `concurrency` repos at once", async () => {
    route();
    await openFoundationPrBatch({
      token: "t",
      owner: "acme",
      concurrency: 2,
      repos: ["a", "b", "c", "d", "e", "f"].map(repo),
    });
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBeGreaterThan(1); // the pool really is parallel, not accidentally serial
  });

  it("an empty batch is a no-op, not an error", async () => {
    route();
    await expect(openFoundationPrBatch({ token: "t", owner: "acme", repos: [] })).resolves.toEqual([]);
    expect(mockPr).not.toHaveBeenCalled();
  });
});
