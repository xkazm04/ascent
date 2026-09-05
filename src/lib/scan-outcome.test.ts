// The rejected/failed split IS the metric. If a typo'd URL or a client disconnect lands in the failed
// bucket, the "pipeline error rate" tracks funnel traffic instead of reliability and a healthy
// pipeline reads as broken — so the classification is asserted directly rather than only through the
// counters it feeds.

import { describe, it, expect } from "vitest";
import { classifyScanFailure } from "@/lib/scan-outcome";
import { GitHubError } from "@/lib/github/source";

describe("classifyScanFailure", () => {
  it("treats a client disconnect as rejected, not a pipeline failure", () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(classifyScanFailure(abort)).toEqual({ bucket: "rejected", scope: "aborted" });
  });

  it("treats user-side repo outcomes as rejected", () => {
    expect(classifyScanFailure(new GitHubError("INVALID_URL", "bad"))).toEqual({
      bucket: "rejected",
      scope: "invalid_url",
    });
    expect(classifyScanFailure(new GitHubError("NOT_FOUND", "gone", 404))).toEqual({
      bucket: "rejected",
      scope: "not_found",
    });
    expect(classifyScanFailure(new GitHubError("EMPTY", "empty"))).toEqual({
      bucket: "rejected",
      scope: "empty_repo",
    });
  });

  it("counts rate limiting and upstream errors as pipeline failures", () => {
    expect(classifyScanFailure(new GitHubError("RATE_LIMITED", "slow down", 403))).toEqual({
      bucket: "failed",
      scope: "github_rate_limited",
    });
    // The status is carried into the scope so a 403 (our auth) is distinguishable from a 502 (theirs)
    // without a second counter kind.
    expect(classifyScanFailure(new GitHubError("UPSTREAM", "boom", 502))).toEqual({
      bucket: "failed",
      scope: "github_502",
    });
  });

  it("defaults an unrecognised throw to a failure", () => {
    // The default must be `failed`: an unhandled exception is exactly the invisible case these
    // counters exist to catch, so an unknown error can never be quietly excused as user-side.
    expect(classifyScanFailure(new TypeError("undefined is not a function"))).toEqual({
      bucket: "failed",
      scope: "unknown",
    });
    expect(classifyScanFailure("a thrown string")).toEqual({ bucket: "failed", scope: "unknown" });
  });
});
