// The Copilot connector's ONE load-bearing invariant: it never produces a cost figure.
//
// This is not a style rule. The ROI model's `allocated` branch divides a connected org total across
// repos by git weight, so a zero-cost source admitted to that branch renders the whole fleet as
// "$0 spend / shadow AI" — a confident, connected-looking, entirely fabricated answer.
// `OrgUsageRollup.hasAllocatedCost` keeps this connector out of that branch, and these tests keep the
// connector's own output honest at the source: `costCents` is 0 because nothing was reported, and no
// future edit may start inventing one from seats × a guessed price.

import { describe, it, expect } from "vitest";
import { buildCopilotUsage, summarizeCopilotSync, type CopilotSyncInput } from "./copilot";

function input(over: Partial<CopilotSyncInput> = {}): CopilotSyncInput {
  return {
    seats: { total_seats: 42 },
    metrics: [
      { date: "2026-08-01", total_active_users: 30, total_engaged_users: 11 },
      { date: "2026-08-02", total_active_users: 28, total_engaged_users: 17 },
    ],
    seatsFailure: null,
    metricsFailure: null,
    ...over,
  };
}

describe("buildCopilotUsage — seats and engagement, never money", () => {
  it("emits zero cost on EVERY record, whatever the seats and engagement are", () => {
    const rows = buildCopilotUsage("Acme", input());
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.costCents === 0)).toBe(true);
    // …and no other field smuggles a price in: tokens are not reported by this API either.
    expect(rows.every((r) => r.tokens === 0)).toBe(true);
  });

  it("stamps the seat LEVEL on every day bucket and carries engaged users as sessions", () => {
    const rows = buildCopilotUsage("acme", input());
    expect(rows.map((r) => r.seats)).toEqual([42, 42]);
    expect(rows.map((r) => r.sessions)).toEqual([11, 17]);
  });

  it("scopes to the org, lower-cased, with one UTC day bucket per reported day", () => {
    const rows = buildCopilotUsage("ACME", input());
    expect(rows.every((r) => r.source === "copilot" && r.scope === "org" && r.scopeKey === "acme")).toBe(true);
    expect(rows.map((r) => r.periodStart.toISOString())).toEqual(["2026-08-01T00:00:00.000Z", "2026-08-02T00:00:00.000Z"]);
  });

  it("drops a malformed day rather than bucketing it to the epoch", () => {
    const rows = buildCopilotUsage("acme", input({ metrics: [{ date: "not-a-date", total_engaged_users: 9 }, { date: "2026-08-03" }] }));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.periodStart.toISOString()).toBe("2026-08-03T00:00:00.000Z");
    expect(rows[0]!.sessions).toBe(0);
  });

  it("degrades to zero seats when the billing half was denied, and still reports engagement", () => {
    const rows = buildCopilotUsage("acme", input({ seats: null, seatsFailure: "denied" }));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.seats === 0)).toBe(true);
    expect(rows.map((r) => r.sessions)).toEqual([11, 17]);
    expect(rows.every((r) => r.costCents === 0)).toBe(true);
  });

  it("returns nothing at all when the metrics half reported no days", () => {
    expect(buildCopilotUsage("acme", input({ metrics: [] }))).toEqual([]);
  });
});

describe("summarizeCopilotSync — the shape the route answers with", () => {
  it("counts days and takes the PEAK of seats and engaged users (both are levels, not sums)", () => {
    expect(summarizeCopilotSync(buildCopilotUsage("acme", input()))).toEqual({ days: 2, seats: 42, engagedPeak: 17 });
  });

  it("has no cost field to report — the summary cannot leak a figure the connector never had", () => {
    const summary = summarizeCopilotSync(buildCopilotUsage("acme", input()));
    expect(Object.keys(summary).sort()).toEqual(["days", "engagedPeak", "seats"]);
  });

  it("is zero-valued rather than undefined on an empty pull", () => {
    expect(summarizeCopilotSync([])).toEqual({ days: 0, seats: 0, engagedPeak: 0 });
  });
});
