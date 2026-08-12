// buildDebtFleet (W5) — the real join: backlog repos × their latest-scan rework rows. Pins the
// null discipline (a backlog repo with no scan / a pre-W5 scan renders unmeasured, never zero), the
// pressure renormalization (a null rate drops its weight instead of counting as 0 pressure), and the
// fleet masthead numbers coming from the scan read, not fabricated from the backlog.

import { describe, expect, it } from "vitest";
import type { BacklogItem, OrgBacklog, OrgRework, RepoReworkRow } from "@/lib/db";
import { buildDebtFleet, fmtRate } from "./debtModel";

function item(over: Partial<BacklogItem>): BacklogItem {
  return {
    id: "rec1",
    title: "Add CI gate",
    dimId: "D2",
    dimLabel: "CI/CD",
    impact: "high",
    effort: "low",
    status: "open",
    assigneeLogin: null,
    targetDate: null,
    dueBucket: "no_date",
    dueInDays: null,
    overdue: false,
    repo: "acme/app",
    repoName: "app",
    lastActivityAt: "2026-01-01T00:00:00.000Z",
    projectedPoints: null,
    unlocks: null,
    rationale: "",
    explore: [],
    ...over,
  };
}

function backlogOf(items: BacklogItem[], over: Partial<OrgBacklog> = {}): OrgBacklog {
  return {
    org: "acme",
    includesClosed: false,
    repos: 1,
    tracked: items.length,
    active: items.length,
    assigned: 0,
    unassigned: items.length,
    dueSoon: 0,
    open: items.length,
    inProgress: 0,
    done: 0,
    dismissed: 0,
    overdue: items.filter((i) => i.overdue).length,
    byOwner: [{ login: null, active: items.length, open: items.length, inProgress: 0, done: 0, dismissed: 0, overdue: 0, items }],
    byDue: [],
    assignees: [],
    ...over,
  };
}

function reworkRow(over: Partial<RepoReworkRow>): RepoReworkRow {
  return {
    fullName: "acme/app",
    name: "app",
    analyzed: 20,
    merged: 15,
    revertRate: 5,
    reworkRate: 10,
    aiReworkRate: 12,
    aiTrailerRate: 30,
    aiInvolvedRate: 40,
    measured: true,
    ...over,
  };
}

function orgRework(perRepo: RepoReworkRow[], over: Partial<OrgRework> = {}): OrgRework {
  return {
    repos: perRepo.length,
    totalPrs: perRepo.reduce((a, r) => a + r.analyzed, 0),
    measuredRepos: perRepo.filter((r) => r.measured).length,
    avgReworkRate: 10,
    avgAiReworkRate: 12,
    avgRevertRate: 5,
    avgAiTrailerRate: 30,
    avgAiInvolvedRate: 40,
    perRepo,
    ...over,
  };
}

describe("buildDebtFleet — the real join", () => {
  it("joins backlog repos to their scan rework rows by fullName", () => {
    const fleet = buildDebtFleet(
      backlogOf([item({ repo: "acme/app", overdue: true, dueInDays: -10, projectedPoints: 4 })]),
      orgRework([reworkRow({ fullName: "acme/app" })]),
    );
    const row = fleet.rows[0]!;
    expect(row.q.hasScan).toBe(true);
    expect(row.q.measured).toBe(true);
    expect(row.q.reworkRate).toBe(10);
    expect(row.q.aiReworkRate).toBe(12);
    expect(row.q.revertRate).toBe(5);
    expect(row.q.exposure).toBe(30); // trailer-grounded
    expect(row.q.exposureGrounded).toBe(true);
    expect(row.principal).toBe(4);
  });

  it("a backlog repo with NO scan row renders unmeasured nulls — never zeros", () => {
    const fleet = buildDebtFleet(backlogOf([item({ repo: "acme/unscanned" })]), orgRework([]));
    const q = fleet.rows[0]!.q;
    expect(q.hasScan).toBe(false);
    expect(q.measured).toBe(false);
    expect(q.reworkRate).toBeNull();
    expect(q.exposure).toBeNull();
    expect(fmtRate(q.reworkRate)).toBe("—");
  });

  it("a pre-W5 scan (measured:false) keeps its nulls and is counted out of measuredRows", () => {
    const fleet = buildDebtFleet(
      backlogOf([item({ repo: "acme/old" })]),
      orgRework([reworkRow({ fullName: "acme/old", measured: false, reworkRate: null, aiReworkRate: null, aiTrailerRate: null })]),
    );
    const row = fleet.rows[0]!;
    expect(row.q.hasScan).toBe(true);
    expect(row.q.measured).toBe(false);
    expect(row.q.reworkRate).toBeNull();
    expect(row.q.exposure).toBe(40); // falls back to the marker-based aiInvolvedRate…
    expect(row.q.exposureGrounded).toBe(false); // …and says so
    expect(fleet.measuredRows).toBe(0);
  });

  it("a null OrgRework (DB off / no PR data) renders the whole quality half unmeasured", () => {
    const fleet = buildDebtFleet(backlogOf([item({})]), null);
    expect(fleet.reworkRate).toBeNull();
    expect(fleet.exposure).toBeNull();
    expect(fleet.rows[0]!.q.hasScan).toBe(false);
  });

  it("pressure renormalizes over measured terms — identical backlogs, one unmeasured, must not read as calmer", () => {
    const overdueItem = item({ repo: "acme/app", overdue: true, dueInDays: -30, projectedPoints: 6 });
    const measured0 = buildDebtFleet(
      backlogOf([overdueItem]),
      orgRework([reworkRow({ fullName: "acme/app", reworkRate: 0, revertRate: 0 })]),
    ).rows[0]!;
    const unmeasured = buildDebtFleet(backlogOf([overdueItem]), orgRework([])).rows[0]!;
    // Measured-zero rework REDUCES pressure below the unmeasured row's renormalized principal-only read:
    // absence of measurement is not evidence of calm.
    expect(measured0.pressure).toBeLessThan(unmeasured.pressure);
    expect(unmeasured.pressure).toBe(100); // principal term only (this repo IS the max principal)
  });

  it("fleet masthead rates come from the scan read (analyzed-weighted fleet), not the backlog", () => {
    const fleet = buildDebtFleet(
      backlogOf([item({})], { dueSoon: 3 }),
      orgRework([reworkRow({})], { avgReworkRate: 17, avgRevertRate: 4, avgAiTrailerRate: null, avgAiInvolvedRate: 22 }),
    );
    expect(fleet.reworkRate).toBe(17);
    expect(fleet.revertRate).toBe(4);
    expect(fleet.exposure).toBe(22); // trailer null fleet-wide → falls back to AI-involved…
    expect(fleet.exposureGrounded).toBe(false); // …and is labeled as the fallback
    expect(fleet.dueSoon).toBe(3);
  });

  it("sorts by pressure worst-first and computes the ledger median over measured rows only", () => {
    const fleet = buildDebtFleet(
      backlogOf([
        item({ id: "a", repo: "acme/hot", repoName: "hot", overdue: true, dueInDays: -20, projectedPoints: 6 }),
        item({ id: "b", repo: "acme/calm", repoName: "calm" }),
        item({ id: "c", repo: "acme/old", repoName: "old" }),
      ]),
      orgRework([
        reworkRow({ fullName: "acme/hot", reworkRate: 30 }),
        reworkRow({ fullName: "acme/calm", reworkRate: 2 }),
        reworkRow({ fullName: "acme/old", measured: false, reworkRate: null, aiReworkRate: null }),
      ]),
    );
    expect(fleet.rows[0]!.repoName).toBe("hot");
    expect(fleet.medianRework).toBe(16); // median of [2, 30] — the unmeasured row contributes nothing
    expect(fleet.measuredRows).toBe(2);
  });
});
