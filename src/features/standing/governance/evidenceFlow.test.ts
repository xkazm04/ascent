// The evidence pack's headline funnel.
//
// Two things this must never do, both of them the failure the ribbon exists to prevent: print a 0
// for a population nobody could read, and fold sampled changes that never merged into the shortfall
// between "sampled" and "reviewed" — the pre-merge control was never due to operate on those, so
// counting them as unreviewed would be the over-claim the card's limitations section forbids.

import { describe, expect, it } from "vitest";
import { evidenceFlow, periodBound } from "./evidenceFlow";
import type { AiChangePopulation } from "@/lib/db/ai-changes";

const change = (prNumber: number, over: Record<string, unknown> = {}) =>
  ({
    repoFullName: "acme/api",
    prNumber,
    title: `pr ${prNumber}`,
    authorLogin: "octocat",
    authorIsBot: false,
    aiSignal: "authored",
    aiTools: [],
    state: "MERGED",
    createdAt: "2026-01-01T00:00:00.000Z",
    mergedAt: "2026-01-02T00:00:00.000Z",
    approved: true,
    approverLogin: "reviewer",
    approvedAt: "2026-01-02T00:00:00.000Z",
    reviewCount: 1,
    source: "scan",
    approvalObservedAt: "2026-01-02T00:00:00.000Z",
    ...over,
  }) as unknown as AiChangePopulation["changes"][number];

const pop = (changes: AiChangePopulation["changes"]): AiChangePopulation =>
  ({ changes, environments: [], observedFrom: null, observedTo: null, asOfByPr: {}, asOfAttempted: 0 }) as AiChangePopulation;

describe("periodBound", () => {
  it("states an open end as all-time rather than fabricating a boundary", () => {
    expect(periodBound(null)).toBe("all-time");
    expect(periodBound(new Date("2026-03-01T00:00:00.000Z"))).toBe("2026-03-01");
  });
});

describe("evidenceFlow", () => {
  it("draws three VOIDS when the population could not be read — never three zeros", () => {
    const flow = evidenceFlow(null, "acme", "2026-01-01", "2026-03-31");
    expect(flow.unmeasured).toBe(true);
    expect(flow.stages.map((s) => s.value)).toEqual([null, null, null]);
  });

  it("nests population ⊇ sampled ⊇ reviewed", () => {
    const flow = evidenceFlow(pop([change(1), change(2), change(3)]), "acme", "2026-01-01", "2026-03-31");
    const [population, sampled, reviewed] = flow.stages;
    expect(population!.value).toBe(3);
    expect(sampled!.value).toBe(3);
    expect(reviewed!.value).toBe(3);
    expect(sampled!.value!).toBeLessThanOrEqual(population!.value!);
    expect(reviewed!.value!).toBeLessThanOrEqual(sampled!.value!);
  });

  it("counts a merged change with no approving review out of `reviewed`", () => {
    const flow = evidenceFlow(
      pop([change(1), change(2, { approved: false, reviewCount: 0, approverLogin: null, approvedAt: null })]),
      "acme",
      "2026-01-01",
      "2026-03-31",
    );
    expect(flow.stages[2]!.value).toBe(1);
    expect(flow.notApplicable).toBe(0);
  });

  it("keeps a change that never merged OUT of the shortfall and states it separately", () => {
    const flow = evidenceFlow(
      pop([change(1), change(2, { state: "OPEN", mergedAt: null, approved: false, reviewCount: 0 })]),
      "acme",
      "2026-01-01",
      "2026-03-31",
    );
    expect(flow.stages[2]!.value).toBe(1);
    expect(flow.notApplicable).toBe(1);
  });

  it("reproduces the same draw for the same org and period — the seed the manifest publishes", () => {
    const many = Array.from({ length: 60 }, (_, i) => change(i + 1));
    const a = evidenceFlow(pop(many), "acme", "2026-01-01", "2026-03-31");
    const b = evidenceFlow(pop(many), "acme", "2026-01-01", "2026-03-31");
    expect(a.stages[1]!.value).toBe(b.stages[1]!.value);
    expect(a.stages[2]!.value).toBe(b.stages[2]!.value);
    // And the draw is a SAMPLE, not the whole population.
    expect(a.stages[1]!.value!).toBeLessThan(a.stages[0]!.value!);
  });
});
