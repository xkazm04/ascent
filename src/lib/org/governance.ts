// CI/CD governance (Direction #4 phase 1) — the org's maturity gate as policy-as-code, evaluated across
// the whole fleet. Applies ONE org policy uniformly to every scanned repo (defaultGatePolicy("org")):
// the pass-rate, where the fleet fails (level/dimension/posture), the worst offenders, and the exact CI
// snippet + gate URL that enforce the SAME policy in pipelines. Pure assembly over the rollup +
// @/lib/scoring/gate (no re-scan). Powers /org/[slug]/governance + its Copy-for-LLM brief.

import { getOrgRollup } from "@/lib/db";
import { defaultGatePolicy, evaluateGateLite, type GateFailure, type GatePolicy } from "@/lib/scoring/gate";
import { DIMENSION_BY_ID } from "@/lib/maturity/model";
import type { DimensionId } from "@/lib/types";

export interface GovernanceFailure {
  name: string;
  fullName: string;
  level: string;
  overall: number;
  reasons: string[];
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
  byReason: { level: number; overall: number; dimension: number; posture: number };
  failures: GovernanceFailure[]; // worst first (most failing conditions, then lowest overall)
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
  return t;
}

function gateQuery(p: GatePolicy): string {
  const q = new URLSearchParams();
  if (p.minLevel) q.set("min_level", p.minLevel);
  if (typeof p.minOverall === "number") q.set("min_overall", String(p.minOverall));
  if (typeof p.minDimension === "number") q.set("min_dimension", String(p.minDimension));
  if (p.forbidPostures?.includes("ungoverned")) q.set("no_ungoverned", "1");
  return q.toString();
}

function ciWith(p: GatePolicy): string[] {
  const w: string[] = [];
  if (p.minLevel) w.push(`min-level: ${p.minLevel}`);
  if (typeof p.minOverall === "number") w.push(`min-overall: '${p.minOverall}'`);
  if (typeof p.minDimension === "number") w.push(`min-dimension: '${p.minDimension}'`);
  if (p.forbidPostures?.includes("ungoverned")) w.push(`no-ungoverned: 'true'`);
  return w;
}

export async function buildGovernanceOverview(orgSlug: string): Promise<GovernanceOverview | null> {
  const rollup = await getOrgRollup(orgSlug);
  if (!rollup || rollup.scannedCount === 0) return null;

  const policy = defaultGatePolicy(ORG_POLICY_ARCHETYPE); // the org bar, applied uniformly to the fleet
  const scannedRepos = rollup.repos.filter((r) => r.latest);

  const byReason = { level: 0, overall: 0, dimension: 0, posture: 0 };
  const failures: GovernanceFailure[] = [];
  let passing = 0;

  for (const r of scannedRepos) {
    const s = r.latest!; // safe: filtered to r.latest above
    const result = evaluateGateLite({ level: s.level, overall: s.overall, posture: s.posture, dims: s.dims }, policy);
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
  }

  failures.sort((a, b) => b.reasons.length - a.reasons.length || a.overall - b.overall);
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
    `- Failing on: ${o.byReason.level} below level · ${o.byReason.dimension} dimension floor · ${o.byReason.posture} posture${o.byReason.overall ? ` · ${o.byReason.overall} overall` : ""}`,
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
