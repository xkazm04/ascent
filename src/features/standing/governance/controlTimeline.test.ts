import { describe, expect, it } from "vitest";
import { coverageSentence, groupTimeline, timelineTotals } from "./controlTimeline";
import type { ControlObservationRow } from "@/lib/db/control-observations";

const obs = (over: Partial<ControlObservationRow> = {}): ControlObservationRow => ({
  id: `o${Math.random()}`,
  orgId: "org_1",
  repoId: "r1",
  repoFullName: "acme/api",
  controlId: "branch-protection",
  state: "pass",
  value: "true",
  prevState: null,
  prevValue: null,
  evidenceJson: "{}",
  source: "probe",
  actorLogin: null,
  transition: false,
  occurredAt: "2026-08-20T00:00:00.000Z",
  observedAt: "2026-08-20T00:00:00.000Z",
  scanId: null,
  jobId: null,
  deliveryId: null,
  createdAt: "2026-08-20T00:00:00.000Z",
  ...over,
});

describe("groupTimeline", () => {
  it("takes the state from the NEWEST row of each pair (the feed is newest-first)", () => {
    const rows = groupTimeline([
      obs({ occurredAt: "2026-08-20T00:00:00.000Z", state: "fail", value: "false" }),
      obs({ occurredAt: "2026-08-01T00:00:00.000Z", state: "pass", value: "true" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.state).toBe("fail");
    expect(rows[0]!.observations).toHaveLength(2);
  });

  it("reports the most recent CHANGE with its actor, and null when nothing ever changed", () => {
    const changed = groupTimeline([
      obs({ occurredAt: "2026-08-20T00:00:00.000Z", state: "fail", transition: true, actorLogin: "octocat", source: "webhook" }),
      obs({ occurredAt: "2026-08-01T00:00:00.000Z" }),
    ]);
    expect(changed[0]!.lastChangeAt).toBe("2026-08-20T00:00:00.000Z");
    expect(changed[0]!.lastChangeActor).toBe("octocat");

    // Two heartbeats and no transition: "unchanged since we started looking", not a date.
    const unchanged = groupTimeline([obs({ occurredAt: "2026-08-20T00:00:00.000Z" }), obs({ occurredAt: "2026-08-01T00:00:00.000Z" })]);
    expect(unchanged[0]!.lastChangeAt).toBeNull();
  });

  it("orders by repository, then by CATALOGUE order — not alphabetically", () => {
    const rows = groupTimeline([
      obs({ controlId: "advisories" }),
      obs({ controlId: "branch-protection" }),
      obs({ repoFullName: "acme/zzz", controlId: "branch-protection" }),
    ]);
    expect(rows.map((r) => [r.repoFullName, r.controlId])).toEqual([
      ["acme/api", "branch-protection"],
      ["acme/api", "advisories"],
      ["acme/zzz", "branch-protection"],
    ]);
  });

  it("labels an uncatalogued control with its raw id rather than a blank", () => {
    expect(groupTimeline([obs({ controlId: "future-control" })])[0]!.label).toBe("future-control");
  });

  it("attaches coverage only when the caller supplied a matching row", () => {
    const cov = {
      repoFullName: "acme/api",
      controlId: "branch-protection",
      firstObservedAt: "2026-08-01T00:00:00.000Z",
      lastObservedAt: "2026-08-20T00:00:00.000Z",
      observations: 4,
      sources: ["probe" as const],
      maxGapDays: 2.5,
      lastState: "pass" as const,
    };
    expect(groupTimeline([obs()], [cov])[0]!.coverage).toBe(cov);
    expect(groupTimeline([obs({ controlId: "signed-commits" })], [cov])[0]!.coverage).toBeNull();
  });
});

describe("coverageSentence", () => {
  const cov = {
    repoFullName: "acme/api",
    controlId: "branch-protection",
    firstObservedAt: "2026-08-01T00:00:00.000Z",
    lastObservedAt: "2026-08-20T00:00:00.000Z",
    observations: 4,
    sources: ["probe" as const, "scan" as const],
    maxGapDays: 2.5,
    lastState: "pass" as const,
  };

  it("states the N and the largest gap", () => {
    expect(coverageSentence(cov)).toBe("4 observations · largest gap 2.5d · via probe, scan");
  });

  it("refuses to claim continuity from a single observation", () => {
    expect(coverageSentence({ ...cov, observations: 1, maxGapDays: null })).toContain("no continuity is claimed");
  });

  // A placeholder in the same slot as a number invites the reader to average the two.
  it("is null — not a placeholder — when there is no coverage row", () => {
    expect(coverageSentence(null)).toBeNull();
    expect(coverageSentence({ ...cov, observations: 0 })).toBeNull();
  });
});

describe("timelineTotals", () => {
  it("counts unmeasurable SEPARATELY and never folds it into failing", () => {
    const rows = groupTimeline([
      obs({ state: "fail" }),
      obs({ controlId: "signed-commits", state: "unmeasurable", value: null }),
      obs({ repoFullName: "acme/zzz", state: "pass" }),
    ]);
    expect(timelineTotals(rows)).toEqual({ pairs: 3, failing: 1, unmeasurable: 1, repos: 2 });
  });
});
