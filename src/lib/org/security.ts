// Security posture overview — the data behind the org Security tab (Direction #2 phase 1). Assembles
// the per-repo Security dimension (D9) from the fleet rollup with branch-protection/governance coverage
// (both already collected), into a security-first view + a "Copy for LLM" remediation brief (#6).
// Pure assembly over @/lib/db; no new queries. Later phases add a security gate, alerts, and SBOM scans.

import { getOrgGovernance, getOrgRollup, type OrgWindow } from "@/lib/db";
import { DIMENSION_BY_ID } from "@/lib/maturity/model";

export interface SecurityRepo {
  name: string;
  fullName: string;
  score: number; // D9 score 0..100
  protected: boolean; // default-branch protection
}

export interface SecurityOverview {
  org: string;
  periodTitle: string;
  generatedOn: string;
  dimLabel: string; // D9 display name (e.g. "Supply Chain & Security")
  avgSecurity: number | null; // org D9 average
  scanned: number;
  /** Repo counts by D9 band: critical <40, weak 40–59, ok 60–79, strong 80+. */
  band: { critical: number; weak: number; ok: number; strong: number };
  weakest: SecurityRepo[]; // lowest-D9 repos, worst first
  governance: { repos: number; protectedRate: number; requireReviewRate: number; requireChecksRate: number; signedRate: number } | null;
  unprotected: { name: string; fullName: string }[]; // repos with no default-branch protection
}

export async function buildSecurityOverview(
  orgSlug: string,
  window?: OrgWindow,
  periodTitle = "all time",
): Promise<SecurityOverview | null> {
  const [rollup, gov] = await Promise.all([getOrgRollup(orgSlug, window), getOrgGovernance(orgSlug)]);
  if (!rollup || rollup.scannedCount === 0) return null;

  const dimLabel = DIMENSION_BY_ID.D9?.name ?? "Security";
  const avgSecurity = rollup.dimAverages.find((d) => d.dimId === "D9")?.avg ?? null;
  const govByRepo = new Map((gov?.perRepo ?? []).map((g) => [g.fullName, g]));

  const weakest: SecurityRepo[] = rollup.repos
    .filter((r) => r.latest)
    .map((r) => ({
      name: r.name,
      fullName: r.fullName,
      score: r.latest!.dims.find((d) => d.dimId === "D9")?.score ?? 0, // safe: filtered to r.latest above
      protected: govByRepo.get(r.fullName)?.protected ?? false,
    }))
    .sort((a, b) => a.score - b.score);

  const band = { critical: 0, weak: 0, ok: 0, strong: 0 };
  for (const r of weakest) {
    if (r.score < 40) band.critical += 1;
    else if (r.score < 60) band.weak += 1;
    else if (r.score < 80) band.ok += 1;
    else band.strong += 1;
  }

  return {
    org: orgSlug,
    periodTitle,
    generatedOn: new Date().toISOString().slice(0, 10),
    dimLabel,
    avgSecurity,
    scanned: weakest.length,
    band,
    weakest: weakest.slice(0, 8),
    governance: gov
      ? {
          repos: gov.repos,
          protectedRate: gov.protectedRate,
          requireReviewRate: gov.requireReviewRate,
          requireChecksRate: gov.requireChecksRate,
          signedRate: gov.signedRate,
        }
      : null,
    unprotected: (gov?.perRepo ?? []).filter((g) => !g.protected).slice(0, 8).map((g) => ({ name: g.name, fullName: g.fullName })),
  };
}

/** A security-focused markdown brief for the "Copy for LLM" action — ends with a remediation ASK. */
export function securityMarkdown(o: SecurityOverview): string {
  const out: string[] = [];
  out.push(`# Ascent — security posture: ${o.org}`);
  out.push(`Generated ${o.generatedOn} · period: ${o.periodTitle}`);
  out.push("");
  out.push("## Security standing");
  out.push(`- Average Security (${o.dimLabel}, D9): ${o.avgSecurity ?? "—"}/100 across ${o.scanned} repos`);
  out.push(`- Distribution: ${o.band.critical} critical (<40) · ${o.band.weak} weak (40–59) · ${o.band.ok} ok (60–79) · ${o.band.strong} strong (80+)`);
  if (o.governance) {
    const g = o.governance;
    out.push(`- Branch protection: ${g.protectedRate}% protected · ${g.requireReviewRate}% require review · ${g.requireChecksRate}% require checks · ${g.signedRate}% signed`);
  }
  out.push("");
  out.push("## Weakest repos (lowest security)");
  for (const r of o.weakest) out.push(`- ${r.name}: ${r.score}/100${r.protected ? "" : " (no branch protection)"}`);
  if (o.unprotected.length) {
    out.push("");
    out.push("## Repos with no default-branch protection");
    for (const r of o.unprotected) out.push(`- ${r.name}`);
  }
  out.push("");
  out.push("## Ask");
  out.push(
    "Given this security posture, propose the top remediations to raise the weakest repos' Security (D9) score and close the branch-protection gaps. For each: the concrete change, the repositories it applies to, and the expected risk reduction.",
  );
  return out.join("\n");
}
