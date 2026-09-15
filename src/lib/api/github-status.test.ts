// The three divergences this mapping exists to end are asserted directly, because the whole point of
// consolidating was that two routes answered differently for one upstream condition.
// Architect ADR 2026-08-28-route-response-seam.

import { describe, expect, it } from "vitest";
import { GitHubError } from "@/lib/github/source";
import { githubErrorHeaders, githubErrorStatus } from "@/lib/api/github-status";

describe("githubErrorStatus", () => {
  // The scan route's old STATUS record, reproduced. Consolidating must not move any of these.
  it("preserves every value the scan route's local STATUS map produced", () => {
    expect(githubErrorStatus(new GitHubError("INVALID_URL", "bad url"))).toBe(400);
    expect(githubErrorStatus(new GitHubError("NOT_FOUND", "gone", 404))).toBe(404);
    expect(githubErrorStatus(new GitHubError("RATE_LIMITED", "slow down", 429))).toBe(429);
    expect(githubErrorStatus(new GitHubError("EMPTY", "empty"))).toBe(422);
    expect(githubErrorStatus(new GitHubError("UPSTREAM", "boom", 502))).toBe(502);
  });

  // ── The three cases practices/generate used to get wrong (`err.status ?? 502`) ──────────────────

  it("answers 429 for a SECONDARY rate limit, which GitHub reports as 403", () => {
    // src/lib/github/source.ts:390-400 classifies a secondary limit and passes GitHub's raw status.
    // `err.status ?? 502` surfaced that 403 — telling a client "forbidden, fix your credentials"
    // when the truth is "throttled, back off". This is the divergence that actively misleads.
    const err = new GitHubError("RATE_LIMITED", "rate limited", 403, 60);
    expect(githubErrorStatus(err)).toBe(429);
  });

  it("answers 422 for an empty repo, which carries no status at all", () => {
    // source.ts:596 throws EMPTY with no status, so `err.status ?? 502` reported a server fault for
    // a repo that is simply empty — a user-side outcome the scan route already called 422.
    expect(githubErrorStatus(new GitHubError("EMPTY", "Repository appears to be empty."))).toBe(422);
  });

  it("answers 400 for an invalid URL, which also carries no status", () => {
    expect(githubErrorStatus(new GitHubError("INVALID_URL", "not a repo url"))).toBe(400);
  });

  it("collapses UPSTREAM to 502 whatever GitHub returned", () => {
    // Both prior mappings already agreed here; pinned so a future edit does not quietly re-diverge.
    for (const status of [500, 502, 503, 504, undefined]) {
      expect(githubErrorStatus(new GitHubError("UPSTREAM", "upstream", status))).toBe(502);
    }
  });
});

describe("githubErrorHeaders", () => {
  it("surfaces GitHub's Retry-After when it sent one", () => {
    expect(githubErrorHeaders(new GitHubError("RATE_LIMITED", "slow", 403, 90))).toEqual({
      "retry-after": "90",
    });
  });

  it("is undefined when no Retry-After was sent", () => {
    expect(githubErrorHeaders(new GitHubError("UPSTREAM", "boom", 502))).toBeUndefined();
    expect(githubErrorHeaders(new GitHubError("EMPTY", "empty"))).toBeUndefined();
  });
});
