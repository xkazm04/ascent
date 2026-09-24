// @vitest-environment node
//
// The weekly digest as MAIL (backlog develop-2026-09-17 row 16). A `mailto:` sink used to receive the
// Slack plain-text fallback in a <pre> block: a wall of bullets without the standing, the cohort, the
// dimension table or the follow-ups the Weekly digest tab already computes. `buildDigestMailPart`
// renders the digest ARTEFACT (`WeeklyDigest`) plus the alert-only blocks the cron computes
// (controls with their coverage, standing concerns, credits, trajectory) as the card body.
//
// Every interpolated value is customer data (org slug, repository names, recommendation titles,
// observations), so the escaping case below is not decoration: an unescaped repo name in a mail body
// is script in the reader's mail client.

import { describe, expect, it } from "vitest";
import type { FleetDigestInput } from "@/lib/alerts";
import type { WeeklyDigest } from "@/lib/org/digest-types";
import { buildDigestMailPart } from "./digest-mail";

function digest(overrides: Partial<WeeklyDigest> = {}): WeeklyDigest {
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
      { dimId: "D1", label: "Testing", now: 74, delta: 5, cohortSize: 8, band: "up" },
      { dimId: "D3", label: "Context Engineering", now: 58, delta: 1, cohortSize: 8, band: "flat" },
      { dimId: "D4", label: "Security Posture", now: 66, delta: null, cohortSize: null, band: "unmeasured" },
    ],
    followups: {
      closed: 2,
      dismissed: 1,
      closedRows: [
        { title: "Add a CI test gate", dimId: "D1", dimLabel: "Testing", repo: "acme/api", at: "2026-08-27T09:00:00.000Z", how: "scan" },
        { title: "Document the deploy path", dimId: "D2", dimLabel: "Documentation", repo: "acme/web", at: "2026-08-29T14:30:00.000Z", how: "human" },
      ],
      opened: 1,
      openedRows: [{ title: "No CODEOWNERS file", dimId: "D4", dimLabel: "Security Posture", repo: "acme/infra", at: null, how: null }],
      openedMeasurable: true,
      unmeasuredRepos: 2,
    },
    actions: [
      { rank: 1, title: "Roll out the test gate", dimId: "D1", dimLabel: "Testing", impact: "high", repoCount: 4, projectedPoints: 7, liftsRepos: 4, line: "Roll out the test gate to 4 repositories." },
      { rank: 2, title: "Write the deploy runbook", dimId: "D2", dimLabel: "Documentation", impact: "medium", repoCount: 3, projectedPoints: 4, liftsRepos: 3, line: "Write the deploy runbook in 3 repositories." },
    ],
    movement: {
      gainers: [{ name: "api", fullName: "acme/api", dOverall: 9, levelFrom: "L2", levelTo: "L3" }],
      regressers: [{ name: "web", fullName: "acme/web", dOverall: -7, levelFrom: "L3", levelTo: "L3" }],
      held: [{ name: "docs", fullName: "acme/docs", dOverall: 1, levelFrom: "L2", levelTo: "L2" }],
      onboarded: [{ name: "fresh", fullName: "acme/fresh", dOverall: null, levelFrom: "L1", levelTo: "L1" }],
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

function fleet(overrides: Partial<FleetDigestInput> = {}): FleetDigestInput {
  return {
    org: "acme",
    url: "https://ascent.test/org/acme?tab=digest",
    repoCount: 12,
    scannedCount: 10,
    avgOverall: 62,
    level: "L3 · Established",
    overallDelta: 4,
    cohortSize: 8,
    gainers: [],
    regressers: [],
    topRecommendation: null,
    percentile: 72,
    trajectory: "On pace for L4 by November (moderate confidence).",
    creditsRemaining: 3,
    controlsFailed: [{ repo: "acme/api", control: "Branch protection", detail: "was pass" }],
    controlCoverage: { pairs: 6, observations: 42, maxGapDays: 3, truncated: false },
    standingConcerns: [{ repo: "acme/web", observation: "D9 held 21 points below its earlier reading", evidence: ["scan 2026-08-01: 71", "scan 2026-08-30: 50"] }],
    ...overrides,
  };
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("buildDigestMailPart: the weekly artefact as the mail body", () => {
  it("carries the headline, the cohort it was measured over and the movers, not the Slack dump", () => {
    const part = buildDigestMailPart({ digest: digest(), fleet: fleet() });
    const body = text(part.bodyHtml);
    expect(body).toContain("62/100");
    expect(body).toContain("L3 Established");
    expect(body).toContain("+4 this week");
    expect(body).toContain("measured over 8 repositories scanned on both sides of the week");
    expect(body).toContain("10/12 repositories scanned");
    expect(body).toContain("72nd percentile");
    expect(body).toContain("api +9 (L2→L3)");
    expect(body).toContain("web -7");
    expect(body).toContain("docs +1 (held)");
    expect(body).toContain("fresh (onboarded)");
    expect(body).toContain("8 repositories compared");
    expect(part.bodyHtml).not.toContain("<pre");
  });

  it("renders the dimension table with the band's word, and an unmeasured cell as not measured, never 0", () => {
    const body = text(buildDigestMailPart({ digest: digest(), fleet: fleet() }).bodyHtml);
    expect(body).toContain("D1 Testing 74 +5 over 8 repositories");
    expect(body).toContain("D3 Context Engineering 58 flat (within noise) over 8 repositories");
    expect(body).toContain("D4 Security Posture 66 not measured");
  });

  it("carries follow-ups, the ranked actions, the alert-only blocks and the method footer", () => {
    const body = text(buildDigestMailPart({ digest: digest(), fleet: fleet() }).bodyHtml);
    expect(body).toContain("Closed this week: 2 (1 by rescan, 1 by hand) · Dismissed: 1");
    expect(body).toContain("Opened this week: 1 (2 repositories had no earlier scan and are not counted)");
    expect(body).toContain("Recommended next move: Roll out the test gate to 4 repositories.");
    expect(body).toContain("acme/api: Branch protection (was pass)");
    expect(body).toContain("Coverage: 42 observations across 6 repo/control pairs, largest gap 3d.");
    expect(body).toContain("acme/web: D9 held 21 points below its earlier reading");
    expect(body).toContain("observed, cause not attributed");
    expect(body).toContain("Credits remaining: 3");
    expect(body).toContain("On pace for L4 by November");
    expect(body).toContain("3 of 10 repositories were scored by the mock engine.");
    expect(body).toContain("Follow-up history for 1 repository was unreadable and is excluded.");
    expect(part().bodyHtml).toContain('href="https://ascent.test/org/acme?tab=digest"');
  });

  it("names the org and the window in the subject", () => {
    expect(part().subject).toBe("Weekly digest: acme · 2026-08-26 → 2026-09-01");
  });

  it("an unmeasurable cohort says so in words, never a delta", () => {
    const d = digest();
    const body = text(
      buildDigestMailPart({
        digest: { ...d, headline: { ...d.headline, dOverall: null, dAdoption: null, dRigor: null, cohortSize: null } },
        fleet: fleet(),
      }).bodyHtml,
    );
    expect(body).toContain("Not enough history yet for a week-over-week comparison.");
    expect(body).not.toContain("measured over");
    expect(body).toContain("AI Adoption 54 (not measured)");
  });

  it("three-state blocks: undefined omits the block, an empty list is the positive statement", () => {
    const omitted = text(buildDigestMailPart({ digest: digest(), fleet: fleet({ controlsFailed: undefined, controlCoverage: undefined, standingConcerns: undefined }) }).bodyHtml);
    expect(omitted).not.toContain("Controls");
    expect(omitted).not.toContain("Standing concerns");
    const clean = text(buildDigestMailPart({ digest: digest(), fleet: fleet({ controlsFailed: [], controlCoverage: { pairs: 0, observations: 0, maxGapDays: null, truncated: false }, standingConcerns: [] }) }).bodyHtml);
    expect(clean).toContain("None failed this week.");
    expect(clean).toContain("no control was observed in this window, so the all-clear above is not evidence");
    expect(clean).toContain("None open.");
  });

  it("HTML-escapes every interpolated value: a <script> in customer data is text, never markup", () => {
    const evil = "<script>alert(1)</script>";
    const d = digest({
      org: `acme${evil}`,
      dims: [{ dimId: "D1", label: evil, now: 1, delta: null, cohortSize: null, band: "unmeasured" }],
      actions: [{ rank: 1, title: evil, dimId: "D1", dimLabel: evil, impact: evil, repoCount: 1, projectedPoints: null, liftsRepos: 1, line: `Fix ${evil}` }],
      movement: { gainers: [{ name: evil, dOverall: 5, levelFrom: evil, levelTo: "L3" }], regressers: [], compared: 1 },
      provenance: { scansInWindow: 1, engineCaveat: evil, notes: [evil] },
    });
    const f = fleet({
      url: `javascript:alert(1)//${evil}`,
      trajectory: evil,
      controlsFailed: [{ repo: evil, control: evil, detail: evil }],
      standingConcerns: [{ repo: evil, observation: evil, evidence: [evil] }],
    });
    const out = buildDigestMailPart({ digest: d, fleet: f });
    expect(out.bodyHtml).not.toMatch(/<script/i);
    expect(out.bodyHtml).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    // A non-http(s) link is never rendered as an href.
    expect(out.bodyHtml).not.toMatch(/href="javascript:/i);
    // The subject is plain text; the shell escapes it as the heading.
    expect(out.subject).toContain("acme<script>");
  });

  it("fixture snapshot: the rendered body is stable", () => {
    expect(part().bodyHtml).toMatchSnapshot();
  });
});

function part() {
  return buildDigestMailPart({ digest: digest(), fleet: fleet() });
}
