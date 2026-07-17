// Security posture overview — the data behind the org Security tab (Direction #2 phase 1). Assembles
// the per-repo Security dimension (D9) from the fleet rollup with branch-protection/governance coverage
// (both already collected), into a security-first view + a "Copy for LLM" remediation brief (#6).
// Pure assembly over @/lib/db; no new queries. Later phases add a security gate, alerts, and SBOM scans.

import { getOrgDimensionGaps, getOrgGovernance, getOrgRollup, type OrgWindow } from "@/lib/db";
import { DIMENSION_BY_ID } from "@/lib/maturity/model";
import { DEFAULT_SECURITY_MIN } from "@/lib/scoring/gate";
import type { OrgSupplyChain } from "@/lib/security/supply-chain";

export interface SecurityRepo {
  name: string;
  fullName: string;
  score: number; // D9 score 0..100
  protected: boolean; // default-branch protection
}

/** One deterministic security control check as parsed for the register grid. */
export interface SecurityRowCheck {
  id: string; // stable key from the check name (e.g. "branch-protection")
  name: string;
  group: "posture" | "exposure";
  risk: string;
  /** 0..10, or null when not applicable (rendered as an n/a chip). */
  score: number | null;
  detail: string;
}

/** One risk-register row: a scanned repo's D9 score, gate verdict, and the deterministic check grid. */
export interface SecurityRegisterRow {
  name: string;
  fullName: string;
  score: number; // D9 score 0..100
  /** Why the repo fails the security gate, or null when it passes. */
  gateReason: string | null;
  /** Default-branch rule detail from the latest scan, or null when governance wasn't readable. */
  rules: { protected: boolean; review: boolean; checks: boolean; signed: boolean } | null;
  /** The deterministic Security (D9) check battery for this repo, parsed from the scan's evidence —
   *  the graded control coverage the register grid renders. Empty for a legacy scan without it. */
  checks: SecurityRowCheck[];
  /** The prioritized remediation list (the check battery's gaps) — the "what to fix" text. */
  issues: string[];
  /** The D9 one-line summary (headline verdict), or "" when absent. */
  summary: string;
}

/** Parse the D9 evidence lines (`Name [group/risk]: score/10 — detail`) into structured checks. */
export function parseSecurityChecks(evidence: string[]): SecurityRowCheck[] {
  const re = /^(.+?) \[(posture|exposure)\/(\w+)\]:\s*(n\/a|-?\d+)\/10\s*—\s*(.*)$/;
  const out: SecurityRowCheck[] = [];
  for (const line of evidence) {
    const m = re.exec(line);
    if (!m) continue;
    out.push({
      id: m[1]!.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
      name: m[1]!,
      group: m[2] as "posture" | "exposure",
      risk: m[3]!,
      score: m[4] === "n/a" ? null : Number(m[4]),
      detail: m[5]!,
    });
  }
  return out;
}

export interface SecurityOverview {
  org: string;
  periodTitle: string;
  generatedOn: string;
  dimLabel: string; // D9 display name (e.g. "Supply Chain & Security")
  avgSecurity: number | null; // org D9 average
  /** Cohort-matched D9 movement over the window (rollup dimDeltas), or null (all-time / no overlap). */
  securityDelta: number | null;
  scanned: number;
  /** Repo counts by D9 band: critical <40, weak 40–59, ok 60–79, strong 80+. */
  band: { critical: number; weak: number; ok: number; strong: number };
  weakest: SecurityRepo[]; // lowest-D9 repos, worst first
  governance: { repos: number; protectedRate: number; requireReviewRate: number; requireChecksRate: number; signedRate: number } | null;
  unprotected: { name: string; fullName: string }[]; // repos with no default-branch protection
  /** Fleet status against the default security gate: Security (D9) >= minSecurity AND not "ungoverned". */
  securityGate: { minSecurity: number; passing: number; failing: number; failingRepos: { name: string; fullName: string; score: number; reason: string }[] };
  /** Every scanned repo as a risk-register row — gate-failing first, then lowest D9 first. */
  register: SecurityRegisterRow[];
}

export async function buildSecurityOverview(
  orgSlug: string,
  window?: OrgWindow,
  periodTitle = "all time",
  techGroupId?: string | null,
): Promise<SecurityOverview | null> {
  const [rollup, gov, d9Gaps] = await Promise.all([
    getOrgRollup(orgSlug, window, null, techGroupId),
    getOrgGovernance(orgSlug, null, techGroupId),
    // Per-repo D9 findings — the specific "what's wrong" list the register surfaces on each row.
    getOrgDimensionGaps(orgSlug, "D9", null, techGroupId),
  ]);
  if (!rollup || rollup.scannedCount === 0) return null;

  const dimLabel = DIMENSION_BY_ID.D9?.name ?? "Security";
  const avgSecurity = rollup.dimAverages.find((d) => d.dimId === "D9")?.avg ?? null;
  // `?.` on dimDeltas: older callers/fixtures may hand a rollup predating the field.
  const securityDelta = rollup.dimDeltas?.find((d) => d.dimId === "D9")?.delta ?? null;
  const govByRepo = new Map((gov?.perRepo ?? []).map((g) => [g.fullName, g]));

  // All scanned repos with their Security (D9) score, posture, and branch-protection state.
  const repos = rollup.repos
    .filter((r) => r.latest)
    .map((r) => ({
      name: r.name,
      fullName: r.fullName,
      score: r.latest!.dims.find((d) => d.dimId === "D9")?.score ?? 0, // safe: filtered to r.latest above
      posture: r.latest!.posture, // safe: filtered to r.latest above
      protected: govByRepo.get(r.fullName)?.protected ?? false,
    }))
    .sort((a, b) => a.score - b.score);

  const band = { critical: 0, weak: 0, ok: 0, strong: 0 };
  for (const r of repos) {
    if (r.score < 40) band.critical += 1;
    else if (r.score < 60) band.weak += 1;
    else if (r.score < 80) band.ok += 1;
    else band.strong += 1;
  }

  // Fleet security gate: Security (D9) >= minSecurity AND posture is not "ungoverned" (mirrors the CI
  // gate's `?security=1` policy). The register carries the verdict per repo; the gate summary and
  // failing list are derived from it so the predicate lives in exactly one place.
  const minSecurity = DEFAULT_SECURITY_MIN;
  const register: SecurityRegisterRow[] = repos
    .map((r) => {
      const g = govByRepo.get(r.fullName);
      const detail = d9Gaps?.get(r.fullName);
      return {
        name: r.name,
        fullName: r.fullName,
        score: r.score,
        gateReason:
          r.score < minSecurity ? `Security ${r.score} < ${minSecurity}` : r.posture === "ungoverned" ? "ungoverned posture" : null,
        rules: g ? { protected: g.protected, review: g.requiredApprovals >= 1, checks: g.requiresStatusChecks, signed: g.requiresSignatures } : null,
        checks: parseSecurityChecks(detail?.evidence ?? []),
        issues: detail?.gaps ?? [],
        summary: detail?.summary ?? "",
      };
    })
    // Stable sort over the score-ascending input: failing repos first, each group weakest-first.
    .sort((a, b) => Number(!a.gateReason) - Number(!b.gateReason));
  const failing = register
    .filter((r) => r.gateReason)
    .map((r) => ({ name: r.name, fullName: r.fullName, score: r.score, reason: r.gateReason! }));

  return {
    org: orgSlug,
    periodTitle,
    generatedOn: new Date().toISOString().slice(0, 10),
    dimLabel,
    avgSecurity,
    securityDelta,
    scanned: repos.length,
    band,
    weakest: repos.slice(0, 8).map((r) => ({ name: r.name, fullName: r.fullName, score: r.score, protected: r.protected })),
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
    securityGate: {
      minSecurity,
      passing: repos.length - failing.length,
      failing: failing.length,
      // DISPLAY cap only, sized for the failing-repos card. Anything that must be exhaustive (the CI
      // gate snippet — see buildGateSnippet) reads the full `register` instead; consuming this list as
      // "all failing repos" silently dropped every repo past the cap (security-posture-audit-log #4).
      failingRepos: failing.slice(0, FAILING_DISPLAY_CAP),
    },
    register,
  };
}

/** How many gate-failing repos the display surfaces (tiles/cards) list — a UI bound, NOT a data cap. */
export const FAILING_DISPLAY_CAP = 8;

/**
 * The paste-ready CI gate snippet ("Copy CI gate snippet") — one curl per gate-failing repo, built
 * from the FULL register, never the display-capped `securityGate.failingRepos`: an org with 20
 * failing repos previously copied a snippet that silently enforced only 8 of them while the tile
 * above said "20 fail" (security-posture-audit-log #4). When nothing fails, two example lines show
 * the shape. Pure — unit-tested.
 */
export function buildGateSnippet(o: SecurityOverview): string {
  const failing = o.register.filter((r) => r.gateReason);
  return [
    `# Ascent security gate — non-zero exit when Security (D9) < ${o.securityGate.minSecurity} or the posture is "ungoverned".`,
    `# Add one line per repo to CI; set ASCENT_URL to this Ascent instance.`,
    ...(failing.length > 0 ? failing : o.register.slice(0, 2)).map((r) => `curl -sf "$ASCENT_URL/api/gate/${r.fullName}?security=1"`),
  ].join("\n");
}

/** A security-focused markdown brief for the "Copy for LLM" action — ends with a remediation ASK.
 *  `supply` (optional) appends the Dependabot supply-chain signal when scanning is enabled. */
export function securityMarkdown(o: SecurityOverview, supply?: OrgSupplyChain | null): string {
  const out: string[] = [];
  out.push(`# Ascent — security posture: ${o.org}`);
  out.push(`Generated ${o.generatedOn} · period: ${o.periodTitle}`);
  out.push("");
  out.push("## Security standing");
  out.push(`- Average Security (${o.dimLabel}, D9): ${o.avgSecurity ?? "—"}/100 across ${o.scanned} repos`);
  if (o.securityDelta != null) out.push(`- Movement: ${o.securityDelta >= 0 ? "+" : ""}${o.securityDelta} D9 over ${o.periodTitle} (cohort-matched)`);
  out.push(`- Distribution: ${o.band.critical} critical (<40) · ${o.band.weak} weak (40–59) · ${o.band.ok} ok (60–79) · ${o.band.strong} strong (80+)`);
  if (o.governance) {
    const g = o.governance;
    out.push(`- Branch protection: ${g.protectedRate}% protected · ${g.requireReviewRate}% require review · ${g.requireChecksRate}% require checks · ${g.signedRate}% signed`);
  }
  out.push("");
  // The risk register as a markdown table — score, gate verdict, and the enabled branch rules per
  // repo (plus advisories when supply-chain scanning is on), so the ASK below can reason about the
  // WHOLE posture of each repo instead of a bare weakest-scores list.
  const REGISTER_CAP = 15;
  const advByRepo = supply && supply.scanned > 0 ? new Map(supply.repos.map((r) => [r.fullName, r])) : null;
  out.push("## Risk register (worst first)");
  out.push(`| repo | security (D9) | gate | branch rules |${advByRepo ? " advisories |" : ""}`);
  out.push(`| --- | --- | --- | --- |${advByRepo ? " --- |" : ""}`);
  for (const r of o.register.slice(0, REGISTER_CAP)) {
    const rules = r.rules
      ? [r.rules.protected && "protected", r.rules.review && "review", r.rules.checks && "checks", r.rules.signed && "signed"]
          .filter(Boolean)
          .join(", ") || "none"
      : "unreadable";
    const gate = r.gateReason ? `FAIL — ${r.gateReason}` : "pass";
    const a = advByRepo?.get(r.fullName);
    const adv = advByRepo ? (a ? (a.total > 0 ? `${a.critical} critical / ${a.high} high / ${a.total} total` : "0") : "—") : null;
    out.push(`| ${r.name} | ${r.score}/100 | ${gate} | ${rules} |${adv != null ? ` ${adv} |` : ""}`);
  }
  if (o.register.length > REGISTER_CAP) out.push(`…and ${o.register.length - REGISTER_CAP} more repos (see the dashboard's risk register).`);
  if (o.unprotected.length) {
    out.push("");
    out.push("## Repos with no default-branch protection");
    for (const r of o.unprotected) out.push(`- ${r.name}`);
  }
  out.push("");
  out.push("## Security gate");
  out.push(`- Policy: Security (D9) >= ${o.securityGate.minSecurity}, no "ungoverned" posture`);
  out.push(`- ${o.securityGate.failing} of ${o.scanned} repos FAIL the gate`);
  for (const r of o.securityGate.failingRepos) out.push(`  - ${r.name}: ${r.reason}`);
  if (supply?.degraded) {
    // getOrgSupplyChain sets `degraded` (with scanned: 0) when the advisory fetch FAILED, precisely so a
    // caller cannot mistake it for "no advisories". Omitting the section silently would hand the model a
    // brief that reads as a clean supply chain and invite it to recommend nothing — the most dangerous
    // false signal a security brief can carry. State the gap instead.
    out.push("");
    out.push("## Supply chain — UNKNOWN");
    out.push(
      "- Advisory data could NOT be fetched for this org (GitHub advisory access failed). Absence of advisories below is **not** evidence of a clean supply chain. Do not treat this section as a pass.",
    );
  } else if (supply && supply.scanned > 0) {
    out.push("");
    out.push(`## Supply chain (Dependabot${supply.demo ? " — demo data" : ""})`);
    out.push(`- Open advisories: ${supply.totals.critical} critical · ${supply.totals.high} high · ${supply.totals.medium} medium · ${supply.totals.low} low`);
    for (const r of supply.repos.filter((x) => x.total > 0).slice(0, 6)) {
      out.push(`- ${r.name}: ${r.critical} critical, ${r.high} high (${r.total} total)`);
    }
  }
  out.push("");
  out.push("## Ask");
  out.push(
    "Given this security posture, propose the top remediations to raise the weakest repos' Security (D9) score and close the branch-protection gaps. For each: the concrete change, the repositories it applies to, and the expected risk reduction.",
  );
  return out.join("\n");
}
