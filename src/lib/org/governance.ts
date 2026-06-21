// CI/CD governance (Direction #4 phase 1) — the org's maturity gate as policy-as-code, evaluated across
// the whole fleet. Applies ONE org policy uniformly to every scanned repo (defaultGatePolicy("org")):
// the pass-rate, where the fleet fails (level/dimension/posture), the worst offenders, and the exact CI
// snippet + gate URL that enforce the SAME policy in pipelines. Pure assembly over the rollup +
// @/lib/scoring/gate (no re-scan). Powers /org/[slug]/governance + its Copy-for-LLM brief.

import { getOrgGatePolicy, getOrgRollup } from "@/lib/db";
import { defaultGatePolicy, evaluateGateLite, type GateFailure, type GatePolicy } from "@/lib/scoring/gate";
import { DIMENSION_BY_ID } from "@/lib/maturity/model";
import { PRACTICES } from "@/lib/practices";
import type { DimensionId } from "@/lib/types";

export interface GovernanceFailure {
  name: string;
  fullName: string;
  level: string;
  overall: number;
  reasons: string[];
}

/** One dimension a repo must lift to clear the gate, with the practice that addresses it (PRAC-6). */
export interface GreenPathDim {
  dimId: string;
  name: string;
  score: number;
  floor: number;
  /** Points to raise this dimension to the floor. */
  gap: number;
  /** The reusable practice for this dimension (deep-linkable on the Practice Library), or null. */
  practiceId: string | null;
}

/** A failing repo ranked by how close it is to passing — the "cheapest path to green" worklist. */
export interface GreenPathItem {
  name: string;
  fullName: string;
  /** Distinct failing gate conditions. */
  failCount: number;
  /** Total points needed to clear the numeric conditions (overall + dimension floors); lower = closer. */
  gap: number;
  /** Dimensions below their floor, each with the practice to apply. */
  dims: GreenPathDim[];
  /** Non-numeric blockers (level / posture) that also need addressing. */
  blockers: string[];
}

export interface GovernanceOverview {
  org: string;
  generatedOn: string;
  /** Human-readable conditions of the active org policy. */
  policyText: string[];
  scanned: number;
  passing: number;
  failing: number;
  passRate: number; // 0..100
  /** How many repos fail on each condition (deduped per repo) — where the fleet is weakest. */
  byReason: { level: number; overall: number; dimension: number; posture: number; governance: number };
  failures: GovernanceFailure[]; // worst first (most failing conditions, then lowest overall)
  /** Failing repos CLOSEST to passing — single-condition + smallest gap first (PRAC-6). */
  closestToGreen: GreenPathItem[];
  /** Query string that reproduces this policy on the gate API/badge. */
  gateQuery: string;
  /** GitHub Action `with:` lines that enforce the SAME policy in CI. */
  ciWith: string[];
}

const ORG_POLICY_ARCHETYPE = "org" as const;

function policyText(p: GatePolicy): string[] {
  const t: string[] = [];
  if (p.minLevel) t.push(`Minimum overall level ${p.minLevel}`);
  if (typeof p.minOverall === "number") t.push(`Overall score ≥ ${p.minOverall}`);
  if (typeof p.minDimension === "number") t.push(`Every dimension ≥ ${p.minDimension}`);
  for (const [dim, floor] of Object.entries(p.minDimensionFor ?? {})) {
    t.push(`${dim} (${DIMENSION_BY_ID[dim as DimensionId]?.name ?? dim}) ≥ ${floor}`);
  }
  if (p.forbidPostures?.length) t.push(`No ${p.forbidPostures.map((x) => `"${x}"`).join(" / ")} posture`);
  if (p.requireProtectedBranch) t.push("Default branch must be protected");
  return t;
}

// gateQuery + ciWith MUST emit every condition policyText shows — otherwise the dashboard enforces a bar
// the copyable CI snippet / gate URL silently drops (policy drift). The Security (D9) floor maps to the
// gate's `min_security` param (the one per-dimension floor the policy editor exposes); protection maps
// to `require_protection`.
function gateQuery(p: GatePolicy): string {
  const q = new URLSearchParams();
  if (p.minLevel) q.set("min_level", p.minLevel);
  if (typeof p.minOverall === "number") q.set("min_overall", String(p.minOverall));
  if (typeof p.minDimension === "number") q.set("min_dimension", String(p.minDimension));
  if (typeof p.minDimensionFor?.D9 === "number") q.set("min_security", String(p.minDimensionFor.D9));
  if (p.forbidPostures?.includes("ungoverned")) q.set("no_ungoverned", "1");
  if (p.requireProtectedBranch) q.set("require_protection", "1");
  return q.toString();
}

function ciWith(p: GatePolicy): string[] {
  const w: string[] = [];
  if (p.minLevel) w.push(`min-level: ${p.minLevel}`);
  if (typeof p.minOverall === "number") w.push(`min-overall: '${p.minOverall}'`);
  if (typeof p.minDimension === "number") w.push(`min-dimension: '${p.minDimension}'`);
  if (typeof p.minDimensionFor?.D9 === "number") w.push(`min-security: '${p.minDimensionFor.D9}'`);
  if (p.forbidPostures?.includes("ungoverned")) w.push(`no-ungoverned: 'true'`);
  if (p.requireProtectedBranch) w.push(`require-protection: 'true'`);
  return w;
}

export async function buildGovernanceOverview(orgSlug: string): Promise<GovernanceOverview | null> {
  const rollup = await getOrgRollup(orgSlug);
  if (!rollup || rollup.scannedCount === 0) return null;

  // The org's configured gate bar (GATE-1), applied uniformly to the fleet; archetype default when unset.
  const policy = (await getOrgGatePolicy(orgSlug)) ?? defaultGatePolicy(ORG_POLICY_ARCHETYPE);
  const scannedRepos = rollup.repos.filter((r) => r.latest);

  const byReason = { level: 0, overall: 0, dimension: 0, posture: 0, governance: 0 };
  const failures: GovernanceFailure[] = [];
  const greenPath: GreenPathItem[] = [];
  let passing = 0;

  // The effective floor for a dimension = the stricter of the global minimum and any per-dim floor.
  const practiceForDim = new Map(PRACTICES.map((p) => [p.dimId as string, p.id]));
  const floorFor = (dimId: string) => Math.max(policy.minDimension ?? 0, policy.minDimensionFor?.[dimId as DimensionId] ?? 0);

  for (const r of scannedRepos) {
    const s = r.latest!; // safe: filtered to r.latest above
    // Bug-fix (ci-gate-status-checks #1 / practices-governance-adoption #1): pass the per-repo
    // branch-protection fields the rollup now carries so `requireProtectedBranch` actually runs in
    // the fleet view — the dashboard's pass-rate must match the CI gate it advertises (the gate URL /
    // ciWith snippet enforce protection). Absent governance leaves them undefined → the rule is
    // skipped (readable-gated parity with evaluateGate), never a false-fail.
    const result = evaluateGateLite(
      { level: s.level, overall: s.overall, posture: s.posture, dims: s.dims, protected: s.protected, govReadable: s.govReadable },
      policy,
    );
    if (result.pass) {
      passing += 1;
      continue;
    }
    // Count each failing condition once per repo (a repo failing 3 dimensions counts once for "dimension").
    const seen = new Set<GateFailure["code"]>();
    for (const f of result.failures) {
      if (!seen.has(f.code)) {
        seen.add(f.code);
        byReason[f.code] += 1;
      }
    }
    failures.push({ name: r.name, fullName: r.fullName, level: s.level, overall: s.overall, reasons: result.failures.map((f) => f.message) });

    // PRAC-6: quantify closeness — the points + practices needed to clear each numeric condition.
    const dims: GreenPathDim[] = s.dims
      .filter((d) => d.score < floorFor(d.dimId))
      .map((d) => ({
        dimId: d.dimId,
        name: DIMENSION_BY_ID[d.dimId as DimensionId]?.name ?? d.dimId,
        score: d.score,
        floor: floorFor(d.dimId),
        gap: floorFor(d.dimId) - d.score,
        practiceId: practiceForDim.get(d.dimId) ?? null,
      }))
      .sort((a, b) => a.gap - b.gap);
    const overallGap = typeof policy.minOverall === "number" && s.overall < policy.minOverall ? policy.minOverall - s.overall : 0;
    // Non-numeric blockers a repo must address (no point-gap to quantify): level, posture, and the
    // protected-branch governance condition (now that the fleet view actually evaluates it).
    const blockers = result.failures
      .filter((f) => f.code === "level" || f.code === "posture" || f.code === "governance")
      .map((f) => f.message);
    greenPath.push({
      name: r.name,
      fullName: r.fullName,
      failCount: result.failures.length,
      gap: overallGap + dims.reduce((a, d) => a + d.gap, 0),
      dims,
      blockers,
    });
  }

  failures.sort((a, b) => b.reasons.length - a.reasons.length || a.overall - b.overall);
  // Closest to green: fewest conditions first, then smallest point-gap — the cheapest repos to flip.
  greenPath.sort((a, b) => a.failCount - b.failCount || a.gap - b.gap);
  const scanned = scannedRepos.length;

  return {
    org: orgSlug,
    generatedOn: new Date().toISOString().slice(0, 10),
    policyText: policyText(policy),
    scanned,
    passing,
    failing: failures.length,
    passRate: scanned ? Math.round((passing / scanned) * 100) : 0,
    byReason,
    failures: failures.slice(0, 12),
    closestToGreen: greenPath.slice(0, 8),
    gateQuery: gateQuery(policy),
    ciWith: ciWith(policy),
  };
}

/** A governance markdown brief for the "Copy for LLM" action — policy, fleet status, failing repos,
 *  the CI enforcement snippet, and a "cheapest path to green" ASK. */
export function governanceMarkdown(o: GovernanceOverview): string {
  const out: string[] = [];
  out.push(`# CI/CD governance: ${o.org}`);
  out.push(`Generated ${o.generatedOn}`);
  out.push("");
  out.push("## Policy (applied to every repo)");
  for (const t of o.policyText) out.push(`- ${t}`);
  out.push("");
  out.push("## Fleet status");
  out.push(`- ${o.passing}/${o.scanned} repos PASS the gate (${o.passRate}%)`);
  out.push(
    `- Failing on: ${o.byReason.level} below level · ${o.byReason.dimension} dimension floor · ${o.byReason.posture} posture${o.byReason.overall ? ` · ${o.byReason.overall} overall` : ""}${o.byReason.governance ? ` · ${o.byReason.governance} unprotected branch` : ""}`,
  );
  if (o.failures.length) {
    out.push("");
    out.push("## Failing repos (worst first)");
    for (const f of o.failures) {
      out.push(`- ${f.fullName} (${f.level}, overall ${f.overall}):`);
      for (const r of f.reasons) out.push(`  - ${r}`);
    }
  }
  out.push("");
  out.push("## Enforce in CI");
  out.push(`- Gate API: GET <ASCENT_URL>/api/gate/<owner>/<repo>?${o.gateQuery}  (200 pass / 422 fail)`);
  out.push("- GitHub Action:");
  out.push("  ```yaml");
  out.push("  - uses: <owner>/ascent@v1");
  out.push("    with:");
  out.push("      ascent-url: ${{ vars.ASCENT_URL }}");
  for (const w of o.ciWith) out.push(`      ${w}`);
  out.push("  ```");
  out.push("");
  out.push("## Ask");
  out.push(
    "Given this fleet gate status, propose the cheapest path to raise the pass-rate: which failing repos are closest to passing, the specific gate condition each one misses, and the concrete change to clear it. Prioritize repos that fail on a single condition.",
  );
  return out.join("\n");
}
