// credits-1: the credit backlog is "watched repos whose NEWEST rescore job was skipped for credits",
// and the resume plan is what one click can honestly scan against balance + allowance.

import { describe, expect, it } from "vitest";
import { foldCreditBacklog, resumePlan, type CreditSkipJob, type CreditBacklogRepo } from "./credit-backlog-model";
import { immediateScanCredits } from "@/components/credit/WatchCostTail";

const job = (repoFullName: string, at: string, over: Partial<CreditSkipJob> = {}): CreditSkipJob => ({
  repoFullName,
  lane: "rescore",
  reason: "cadence",
  state: "skipped",
  error: "insufficient credits",
  at,
  ...over,
});

describe("foldCreditBacklog", () => {
  it("owes a repo only when its newest rescore job is a credit skip", () => {
    const out = foldCreditBacklog([
      job("acme/a", "2026-10-03T10:00:00.000Z"),
      job("acme/a", "2026-10-05T10:00:00.000Z", { state: "done", error: null }),
      job("acme/b", "2026-10-01T10:00:00.000Z", { state: "done", error: null }),
      job("acme/b", "2026-10-04T10:00:00.000Z", { reason: "webhook:push" }),
    ]);
    expect(out.count).toBe(1);
    expect(out.repos).toEqual([{ repo: "acme/b", skippedAt: "2026-10-04T10:00:00.000Z", via: "push" }]);
    expect(typeof out.repos[0].skippedAt).toBe("string");
    expect(out.oldestSkippedAt).toBe("2026-10-04T10:00:00.000Z");
  });

  it("excludes probe-lane jobs and rescore skips with any other error", () => {
    const out = foldCreditBacklog([
      job("acme/p", "2026-10-04T10:00:00.000Z", { lane: "probe" }),
      job("acme/t", "2026-10-04T10:00:00.000Z", { error: "no token" }),
      job("acme/d", "2026-10-04T10:00:00.000Z", { error: "degraded" }),
    ]);
    expect(out).toEqual({ count: 0, repos: [], oldestSkippedAt: null });
  });

  it("a newer unsettled job or a newer scan on the repo clears the debt", () => {
    const out = foldCreditBacklog(
      [
        job("acme/q", "2026-10-04T10:00:00.000Z"),
        job("acme/q", "2026-10-06T10:00:00.000Z", { state: "queued", error: null }),
        job("acme/s", "2026-10-04T10:00:00.000Z", { reason: "import" }),
        job("acme/i", "2026-10-02T10:00:00.000Z", { reason: "import" }),
      ],
      { "acme/s": "2026-10-05T00:00:00.000Z", "acme/i": "2026-10-01T00:00:00.000Z" },
    );
    expect(out.repos).toEqual([{ repo: "acme/i", skippedAt: "2026-10-02T10:00:00.000Z", via: "import" }]);
  });
});

const owed = (n: number): CreditBacklogRepo[] =>
  // Deliberately NOT in skip order: the plan picks the oldest skips itself.
  Array.from({ length: n }, (_, i) => ({
    repo: `acme/r${i}`,
    skippedAt: `2026-10-${String(10 - i).padStart(2, "0")}T00:00:00.000Z`,
    via: "cadence" as const,
  }));

describe("resumePlan", () => {
  it("takes the oldest-skipped repos up to balance + allowance and states the draw", () => {
    const credit = { balance: 3, allowanceRemaining: 2, unlimited: false };
    const plan = resumePlan(owed(7), credit);
    expect(plan.repos).toEqual(["acme/r6", "acme/r5", "acme/r4", "acme/r3", "acme/r2"]);
    expect(plan.deferred).toBe(2);
    expect(plan.drawsUpTo).toBe(3);
    expect(plan.drawsUpTo).toBe(immediateScanCredits(5, credit));
    expect(plan.reason).toBeNull();
  });

  it("disables the action with 'top-up-first' when nothing can be scanned", () => {
    const plan = resumePlan(owed(7), { balance: 0, allowanceRemaining: 0, unlimited: false });
    expect(plan.repos).toEqual([]);
    expect(plan.reason).toBe("top-up-first");
    expect(plan.deferred).toBe(7);
  });

  it("an unlimited plan resumes everything and quotes no draw", () => {
    const plan = resumePlan(owed(7), { balance: 0, allowanceRemaining: null, unlimited: true });
    expect(plan.repos).toHaveLength(7);
    expect(plan.deferred).toBe(0);
    expect(plan.drawsUpTo).toBeNull();
    expect(plan.reason).toBeNull();
  });
});
