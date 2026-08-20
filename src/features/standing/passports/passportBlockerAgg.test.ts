// Fleet blocker aggregation: what a bucket is keyed on, and what it counts.
//
// Both properties here were defects before passport 0.4.0. The bucket key was the rendered blocker
// STRING, so a copy edit split one fleet bucket in two; and the rows it reads are POST-OVERLAY, so
// every deliberately accepted gap silently shrank the fleet count for that blocker — the one problem
// everybody had accepted looked like the one nobody had.

import { describe, it, expect } from "vitest";
import { aggregateBlockers, type BlockerAggRow } from "@/features/standing/passports/passportBlockerAgg";

const row = (name: string, over: Partial<BlockerAggRow["detail"]> = {}): BlockerAggRow => ({
  name,
  fullName: `acme/${name}`,
  detail: { autoBlockers: [], prodBlockers: [], ...over },
});

const obs = (text = "Zero observability: no error tracking, structured logs, metrics, or tracing.") => ({
  id: "prod.zero-observability",
  code: "zero-observability",
  text,
  severity: "block" as const,
});

describe("aggregateBlockers — bucket identity", () => {
  it("keeps two differently-worded renderings of the SAME finding in one bucket", () => {
    const out = aggregateBlockers([
      row("a", { prodBlockers: [obs().text], prodFindings: [obs()] }),
      row("b", { prodBlockers: ["This service emits no telemetry."], prodFindings: [obs("This service emits no telemetry.")] }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.code).toBe("zero-observability");
    expect(out[0]!.repos.map((r) => r.name)).toEqual(["a", "b"]);
  });

  it("still buckets a pre-0.4.0 row that carries no findings, folding the variable self-verify line", () => {
    const out = aggregateBlockers([
      row("a", { autoBlockers: ["Agent can't self-verify: missing test script(s)."] }),
      row("b", { autoBlockers: ["Agent can't self-verify: missing lint, typecheck script(s)."] }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.repos).toHaveLength(2);
  });
});

describe("aggregateBlockers — declines are counted beside, never subtracted", () => {
  const declined = { path: "productionReadiness.observability", label: "Observability", findingId: "prod.zero-observability", blocker: obs().text };

  it("keeps the shared problem's TRUE size when teams have accepted it", () => {
    const out = aggregateBlockers([
      row("open1", { prodBlockers: [obs().text], prodFindings: [obs()] }),
      // The overlay already stripped the blocker from these two; only the decision remains.
      row("accepted1", { declined: [declined] }),
      row("accepted2", { declined: [declined] }),
    ]);
    expect(out[0]!.repos.map((r) => r.name)).toEqual(["open1"]);
    expect(out[0]!.declinedRepos.map((r) => r.name)).toEqual(["accepted1", "accepted2"]);
    // Ranked on the total, so the widely-accepted blocker does not sink to the bottom of the docket…
    expect(out[0]!.repos.length + out[0]!.declinedRepos.length).toBe(3);
    // …while staying separable, so a chart never shows a team its own decision as an open finding.
    expect(out[0]!.repos).not.toEqual(expect.arrayContaining([{ name: "accepted1", fullName: "acme/accepted1" }]));
  });

  it("ranks a mostly-accepted blocker above a smaller fully-open one", () => {
    const ci = { id: "prod.ci-not-gating", code: "ci-not-gating", text: "CI does not gate merges.", severity: "block" as const };
    const out = aggregateBlockers([
      row("x", { prodBlockers: [ci.text], prodFindings: [ci] }),
      row("y", { prodBlockers: [ci.text], prodFindings: [ci] }),
      row("p", { declined: [declined] }),
      row("q", { declined: [declined] }),
      row("r", { declined: [declined] }),
    ]);
    expect(out.map((a) => a.code)).toEqual(["zero-observability", "ci-not-gating"]);
  });

  it("does not double-count a RE-SURFACED decline, which is already an open blocker again", () => {
    const out = aggregateBlockers([
      row("z", {
        prodBlockers: [obs().text],
        prodFindings: [obs()],
        declined: [{ ...declined, needsReconfirm: true, reconfirmReason: "aged out" }],
      }),
    ]);
    expect(out[0]!.repos).toHaveLength(1);
    expect(out[0]!.declinedRepos).toHaveLength(0);
  });

  it("skips a pre-0.4.0 decline with no findingId rather than guessing it into a bucket", () => {
    const out = aggregateBlockers([row("legacy", { declined: [{ path: "productionReadiness.observability", label: "Observability" }] })]);
    expect(out).toEqual([]);
  });
});
