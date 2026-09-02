// A full `WeeklyDigest` for the tab's render tests — one fixture that exercises every branch the page
// has to present differently: a measured delta, a flat (within-noise) one, an unmeasured one, closed
// rows by both routes, an "opened" column that IS measurable, three ranked actions, and movement in
// both directions. `variant()` shallow-overrides a top-level field so a test can flip exactly one
// thing (e.g. `openedMeasurable`) without restating the shape.

import type { WeeklyDigest } from "@/lib/org/digest-types";

export function digestFixture(overrides: Partial<WeeklyDigest> = {}): WeeklyDigest {
  return {
    org: "acme",
    generatedOn: "2026-09-01",
    window: {
      from: "2026-08-26",
      to: "2026-09-01",
      start: "2026-08-26T00:00:00.000Z",
      endExclusive: "2026-09-02T00:00:00.000Z",
      title: "2026-08-26 → 2026-09-01",
    },
    headline: {
      overall: 62,
      adoption: 54,
      rigor: 68,
      levelId: "L3",
      levelName: "Established",
      dOverall: 4,
      dAdoption: 6,
      dRigor: -1,
      cohortSize: 8,
      onboarded: 2,
      departed: 1,
      scanned: 10,
      total: 12,
    },
    dims: [
      // A real move, a within-noise hold, and a dimension with no scan on one side of the window.
      { dimId: "D1", label: "Testing", now: 74, delta: 5, band: "up" },
      { dimId: "D2", label: "Documentation", now: 41, delta: -6, band: "down" },
      { dimId: "D3", label: "Context Engineering", now: 58, delta: 1, band: "flat" },
      { dimId: "D4", label: "Security Posture", now: 66, delta: null, band: "unmeasured" },
    ],
    followups: {
      closed: 5,
      dismissed: 2,
      closedRows: [
        {
          title: "Add a CI test gate",
          dimId: "D1",
          dimLabel: "Testing",
          repo: "acme/api",
          at: "2026-08-27T09:00:00.000Z",
          how: "scan",
        },
        {
          title: "Document the deploy path",
          dimId: "D2",
          dimLabel: "Documentation",
          repo: "acme/web",
          at: "2026-08-29T14:30:00.000Z",
          how: "human",
        },
      ],
      opened: 3,
      openedRows: [
        {
          title: "No CODEOWNERS file",
          dimId: "D4",
          dimLabel: "Security Posture",
          repo: "acme/infra",
          at: null,
          how: null,
        },
      ],
      openedMeasurable: true,
      unmeasuredRepos: 2,
    },
    actions: [
      {
        rank: 1,
        title: "Roll out the test gate",
        dimId: "D1",
        dimLabel: "Testing",
        impact: "highest projected fleet gain",
        repoCount: 4,
        projectedPoints: 7,
        liftsRepos: 4,
        line: "Roll out the test gate to 4 repositories — the highest projected fleet gain this week.",
      },
      {
        rank: 2,
        title: "Write the deploy runbook",
        dimId: "D2",
        dimLabel: "Documentation",
        impact: "second",
        repoCount: 3,
        projectedPoints: 4,
        liftsRepos: 3,
        line: "Write the deploy runbook in 3 repositories.",
      },
      {
        rank: 3,
        title: "Add CODEOWNERS",
        dimId: "D4",
        dimLabel: "Security Posture",
        impact: "third",
        repoCount: 2,
        projectedPoints: null,
        liftsRepos: 2,
        line: "Add CODEOWNERS to 2 repositories.",
      },
    ],
    movement: {
      gainers: [{ name: "api", fullName: "acme/api", dOverall: 9, levelFrom: "L2", levelTo: "L3" }],
      regressers: [{ name: "web", fullName: "acme/web", dOverall: -7, levelFrom: "L3", levelTo: "L2" }],
      compared: 8,
    },
    provenance: {
      scansInWindow: 14,
      engineCaveat: "3 of 10 repositories were scored by the mock engine.",
      notes: ["Follow-up history for 1 repository was unreadable and is excluded."],
    },
    ...overrides,
  };
}
