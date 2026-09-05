import { describe, expect, it } from "vitest";
import { toDeploymentRecord, FAILED_STATES } from "./deployments";

const gh = { id: 42, environment: "production", sha: "AbC123", ref: "main", created_at: "2026-08-01T00:00:00Z" };

describe("toDeploymentRecord", () => {
  it("maps a deployment with its latest status", () => {
    expect(toDeploymentRecord(gh, { state: "success", created_at: "2026-08-01T00:05:00Z" })).toEqual({
      externalId: "42",
      environment: "production",
      sha: "abc123", // lower-cased — the join key must fold with the merge-sha index
      ref: "main",
      state: "success",
      createdAt: "2026-08-01T00:00:00Z",
      statusAt: "2026-08-01T00:05:00Z",
    });
  });

  // "We do not know how this ended" is a real state. Defaulting to success would understate the
  // failure rate; defaulting to failure would invent one.
  it("normalizes a missing status to pending — never success, never failure", () => {
    expect(toDeploymentRecord(gh, null)!.state).toBe("pending");
    expect(toDeploymentRecord(gh, {})!.state).toBe("pending");
  });

  it("normalizes an unrecognized status to pending rather than storing it raw", () => {
    expect(toDeploymentRecord(gh, { state: "something_new" })!.state).toBe("pending");
  });

  it("drops a deployment with nothing to key, join or window on", () => {
    expect(toDeploymentRecord({ ...gh, id: undefined }, null)).toBeNull();
    expect(toDeploymentRecord({ ...gh, sha: undefined }, null)).toBeNull();
    expect(toDeploymentRecord({ ...gh, created_at: undefined }, null)).toBeNull();
  });

  it("falls back to a named-unknown environment rather than dropping the row", () => {
    expect(toDeploymentRecord({ ...gh, environment: undefined }, null)!.environment).toBe("unknown");
  });

  it("treats failure and error — and only those — as failed deployments", () => {
    expect([...FAILED_STATES].sort()).toEqual(["error", "failure"]);
    for (const ok of ["success", "pending", "inactive", "in_progress", "queued"]) {
      expect(FAILED_STATES.has(ok)).toBe(false);
    }
  });
});
