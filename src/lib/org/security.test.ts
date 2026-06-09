// The security "Copy for LLM" brief is a product contract — lock its shape: standing, distribution,
// governance coverage, the weakest repos (with a no-protection flag), and a trailing remediation ASK.

import { describe, it, expect } from "vitest";
import { securityMarkdown, type SecurityOverview } from "./security";

const fixture: SecurityOverview = {
  org: "acme",
  periodTitle: "last 90 days",
  generatedOn: "2026-06-09",
  dimLabel: "Supply Chain & Security",
  avgSecurity: 48,
  scanned: 10,
  band: { critical: 2, weak: 3, ok: 4, strong: 1 },
  weakest: [
    { name: "legacy-api", fullName: "acme/legacy-api", score: 22, protected: false },
    { name: "web", fullName: "acme/web", score: 51, protected: true },
  ],
  governance: { repos: 10, protectedRate: 60, requireReviewRate: 50, requireChecksRate: 40, signedRate: 10 },
  unprotected: [{ name: "legacy-api", fullName: "acme/legacy-api" }],
  securityGate: {
    minSecurity: 50,
    passing: 5,
    failing: 5,
    failingRepos: [{ name: "legacy-api", fullName: "acme/legacy-api", score: 22, reason: "Security 22 < 50" }],
  },
};

describe("securityMarkdown", () => {
  const md = securityMarkdown(fixture);

  it("summarizes standing, distribution and governance coverage", () => {
    expect(md).toContain("Average Security (Supply Chain & Security, D9): 48/100 across 10 repos");
    expect(md).toContain("2 critical (<40) · 3 weak (40–59) · 4 ok (60–79) · 1 strong (80+)");
    expect(md).toContain("Branch protection: 60% protected · 50% require review · 40% require checks · 10% signed");
  });

  it("lists the weakest repos and flags missing branch protection", () => {
    expect(md).toContain("legacy-api: 22/100 (no branch protection)");
    expect(md).toContain("web: 51/100");
    expect(md).not.toContain("web: 51/100 (no branch protection)");
    expect(md).toContain("## Repos with no default-branch protection");
  });

  it("reports the security gate status", () => {
    expect(md).toContain('Policy: Security (D9) >= 50, no "ungoverned" posture');
    expect(md).toContain("5 of 10 repos FAIL the gate");
    expect(md).toContain("legacy-api: Security 22 < 50");
  });

  it("ends with a remediation ASK", () => {
    expect(md).toContain("## Ask");
    expect(md).toMatch(/propose the top remediations/);
  });
});
