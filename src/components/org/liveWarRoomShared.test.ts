import { describe, it, expect } from "vitest";
import { classifyRepoEvent } from "./liveWarRoomShared";

// The server contract (POST /api/org/scan) emits three `repo` shapes:
//   { repo, error }                            — the scan threw
//   { repo, skipped: "insufficient_credits" }  — credit reservation lost, no score produced
//   { repo, level, overall, posture, adoption, rigor } — scored
// The classifier is the consumers' single trust boundary: anything else is "invalid" and must
// never reach the scored fold (the NaN-tile bug was a skip falling through to Number(undefined)).

describe("classifyRepoEvent", () => {
  it("classifies a per-repo failure as error", () => {
    expect(classifyRepoEvent({ repo: "acme/api", error: "scan failed" })).toEqual({
      kind: "error",
      message: "scan failed",
    });
  });

  it("classifies a credit-skipped repo as skipped, NOT as scored-NaN", () => {
    expect(classifyRepoEvent({ repo: "acme/api", skipped: "insufficient_credits" })).toEqual({
      kind: "skipped",
      reason: "insufficient_credits",
    });
  });

  it("classifies a full scored payload with finite numbers", () => {
    expect(
      classifyRepoEvent({ repo: "acme/api", level: "L3", overall: 62, posture: "manual", adoption: 55, rigor: 70 }),
    ).toEqual({ kind: "scored", overall: 62, adoption: 55, rigor: 70, level: "L3", posture: "manual" });
  });

  it("error takes precedence over any score fields", () => {
    expect(classifyRepoEvent({ repo: "acme/api", error: "boom", overall: 62 })).toEqual({
      kind: "error",
      message: "boom",
    });
  });

  it("rejects a payload with a missing overall as invalid (the old NaN fold)", () => {
    expect(classifyRepoEvent({ repo: "acme/api" })).toEqual({ kind: "invalid" });
  });

  it("rejects a non-finite overall as invalid", () => {
    expect(classifyRepoEvent({ repo: "acme/api", overall: "not-a-number" })).toEqual({ kind: "invalid" });
    expect(classifyRepoEvent({ repo: "acme/api", overall: Infinity })).toEqual({ kind: "invalid" });
  });

  it("nulls non-finite secondary axes instead of folding NaN", () => {
    expect(classifyRepoEvent({ repo: "acme/api", overall: 40 })).toEqual({
      kind: "scored",
      overall: 40,
      adoption: null,
      rigor: null,
      level: null,
      posture: null,
    });
  });

  it("accepts a genuinely-zero overall (absent ≠ zero, but zero is a measurement)", () => {
    const ev = classifyRepoEvent({ repo: "acme/api", overall: 0, adoption: 0, rigor: 0 });
    expect(ev).toMatchObject({ kind: "scored", overall: 0, adoption: 0, rigor: 0 });
  });
});
