// CI/CD governance (Direction #4 phase 1) — the org's maturity gate as policy-as-code, evaluated across
// the whole fleet. Applies ONE org policy uniformly to every scanned repo (defaultGatePolicy("org")):
// the pass-rate, where the fleet fails (level/dimension/posture), the worst offenders, and the exact CI
// snippet + gate URL that enforce the SAME policy in pipelines. Pure assembly over the rollup +
// @/lib/scoring/gate (no re-scan). Powers /org/[slug]/governance + its Copy-for-LLM brief.

import { getOrgGatePolicy, getOrgRollup } from "@/lib/db";
import { defaultGatePolicy, describeGatePolicy, evaluateGateLite, type GateFailure, type GatePolicy } from "@/lib/scoring/gate";

export interface GovernanceFailure {
  name: string;
  fullName: string;
  level: string;
  overall: number;
  reasons: string[];
}

// `GreenPathItem` / `GreenPathDim` and the `closestToGreen` field lived here — the per-repo closeness
// math (points to each dimension floor, the practice that clears it, non-numeric blockers) behind the
// governance tab's "Cheapest path to green" card (PRAC-6). Card and data deleted 2026-08-19: the card
// re-listed the failing repos `GovernanceFailingReposCard` already shows, re-sorted, and nothing else
// ever read the field — `governanceMarkdown`'s cheapest-path ASK is prose the model answers from the
// failing-repo list it is given. Going with it: this module's imports of `effectiveFloor`,
// `DIMENSION_BY_ID`, `PRACTICES` and `DimensionId`, which nothing else here needed.

export interface GovernanceOverview {
  org: string;
  generatedOn: string;
  /** Human-readable conditions of the active org policy. */
  policyText: string[];
  scanned: number;
  /**
   * Scanned repos whose latest scan scored NOTHING (no dimension was persisted), so the gate has no
   * measurement to judge. A THIRD bucket, deliberately not a failure: these repos are excluded from
   * `passing`, `failing` and the `passRate` denominator alike, because counting an ingestion failure
   * as a gate failure would turn previously-green repos red overnight for a reason their maintainers
   * cannot fix, and counting it as a pass certifies a repo nobody looked at.
   */
  incomplete: number;
  /** Repos the gate could actually judge (`scanned - incomplete`) — the denominator of `passRate`.
   *  Publishing it is the point: a pass rate whose denominator is invisible cannot be compared. */
  assessed: number;
  passing: number;
  failing: number;
  passRate: number; // 0..100, over `assessed` (NOT `scanned`)
  /** How many repos fail on each condition (deduped per repo) — where the fleet is weakest. */
  /** Failing-condition tally. Keyed off GateFailure["code"] so a new code cannot be silently dropped. */
  byReason: Record<GateFailure["code"], number>;
  failures: GovernanceFailure[]; // worst first (most failing conditions, then lowest overall)
  /** Query string that reproduces this policy on the gate API/badge. */
  gateQuery: string;
  /** GitHub Action `with:` lines that enforce the SAME policy in CI. */
  ciWith: string[];
  /**
   * The PERSISTED org gate policy this overview read (null = none stored, i.e. the archetype default
   * was applied). Handed back so the page's GatePolicyEditor can seed itself from THIS fetch instead
   * of issuing a second getOrgGatePolicy of its own — the two reads were duplicated, and sequential.
   * Deliberately the raw stored row, not the resolved policy: the editor must still distinguish
   * "unset, inheriting the default" from "explicitly set to the default's values".
   */
  savedPolicy: GatePolicy | null;
}

const ORG_POLICY_ARCHETYPE = "org" as const;

// policyText / gateQuery / ciWith (and the PR-comment policyBits over in gate-comment.ts) all derive
// from ONE ordered enumeration of the policy's conditions (describeGatePolicy in scoring/gate.ts), so
// they can't drift — the dashboard, the copyable CI snippet, the gate URL, and the PR footer always
// advertise the SAME bar the gate enforces.
function policyText(p: GatePolicy): string[] {
  return describeGatePolicy(p).map((c) => c.text);
}

function gateQuery(p: GatePolicy): string {
  const q = new URLSearchParams();
  for (const c of describeGatePolicy(p)) if (c.query) q.set(c.query[0], c.query[1]);
  return q.toString();
}

function ciWith(p: GatePolicy): string[] {
  return describeGatePolicy(p).flatMap((c) => (c.ci ? [c.ci] : []));
}

/**
 * Assemble the fleet's governance reading, optionally SCOPED to a segment / tech-stack group — the
 * same `(orgSlug, segmentId?, techGroupId?)` contract buildAdoptionOverview takes, so a lead who
 * filters the fleet on one tab keeps that filter here instead of silently reverting to the whole org.
 * The two reads run in parallel (the policy fetch used to sit behind the rollup await).
 */
export async function buildGovernanceOverview(
  orgSlug: string,
  segmentId?: string | null,
  techGroupId?: string | null,
): Promise<GovernanceOverview | null> {
  // The org's configured gate bar (GATE-1), applied uniformly to the scoped fleet; archetype default
  // when unset. The policy is org-wide by design — scope narrows WHO is measured, never the bar.
  const [rollup, savedPolicy] = await Promise.all([
    getOrgRollup(orgSlug, undefined, segmentId, techGroupId),
    getOrgGatePolicy(orgSlug),
  ]);
  if (!rollup || rollup.scannedCount === 0) return null;

  const policy = savedPolicy ?? defaultGatePolicy(ORG_POLICY_ARCHETYPE);
  const scannedRepos = rollup.repos.filter((r) => r.latest);

  // `incomplete` used to be carried "for shape completeness" and left at 0: the fleet path scores
  // from persisted numbers (evaluateGateLite) and could not observe an empty-dimensions report. A
  // tally that can only ever be zero is worse than no tally, because a reader takes it as evidence
  // none occurred — an org with a broken ingestion and an org with real failures printed the same
  // headline. The rollup now carries `latest.incomplete` (org-rollup.ts, derived from the same
  // zero-dimension predicate the engine and the per-repo gate use), so this count is real.
  const byReason: Record<GateFailure["code"], number> = {
    level: 0, overall: 0, dimension: 0, posture: 0, governance: 0, provenance: 0, incomplete: 0,
  };
  const failures: GovernanceFailure[] = [];
  let passing = 0;

  for (const r of scannedRepos) {
    const s = r.latest!; // safe: filtered to r.latest above
    // An unscorable scan gets NO verdict — not a pass, not a failure. Its 0 / L1 numbers would fail
    // the level and overall bars for reasons that describe the ingestion, not the repository, so
    // feeding them to evaluateGateLite would manufacture findings about a repo nobody measured
    // (exactly what evaluateGate short-circuits for the single-repo path). Counted in its own bucket
    // and skipped, so it never enters `passing`, `failures` or the pass-rate denominator.
    if (s.incomplete) {
      byReason.incomplete += 1;
      continue;
    }
    // Bug-fix (ci-gate-status-checks #1 / practices-governance-adoption #1): pass the per-repo
    // branch-protection fields the rollup now carries so `requireProtectedBranch` actually runs in
    // the fleet view — the dashboard's pass-rate must match the CI gate it advertises (the gate URL /
    // ciWith snippet enforce protection). Absent governance leaves them undefined → the rule is
    // skipped (readable-gated parity with evaluateGate), never a false-fail.
    // W2: aiGovernedRate/aiPrSample travel too, for the same dashboard↔CI parity reason as the
    // protection fields above — with the org's provenance bar set, a fleet view that silently
    // skipped it would show repos as passing that the CI gate blocks. Null → the rule is skipped
    // (not measurable), never a false-fail.
    const result = evaluateGateLite(
      {
        level: s.level,
        overall: s.overall,
        posture: s.posture,
        dims: s.dims,
        protected: s.protected,
        govReadable: s.govReadable,
        aiGovernedRate: s.aiGovernedRate,
        aiPrSample: s.aiPrSample,
      },
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
  }

  failures.sort((a, b) => b.reasons.length - a.reasons.length || a.overall - b.overall);
  const scanned = scannedRepos.length;
  const incomplete = byReason.incomplete;
  // The pass rate is a ratio over the repos the gate could actually judge. Dividing by `scanned`
  // would silently count every unscorable repo as a failure (the old behaviour, where their 0 / L1
  // numbers landed in `failures`) and make a fleet's headline degrade with its ingestion health
  // rather than its engineering. `assessed` travels beside the rate so the denominator is legible.
  const assessed = scanned - incomplete;

  return {
    org: orgSlug,
    generatedOn: new Date().toISOString().slice(0, 10),
    policyText: policyText(policy),
    scanned,
    incomplete,
    assessed,
    passing,
    failing: failures.length,
    passRate: assessed ? Math.round((passing / assessed) * 100) : 0,
    byReason,
    failures: failures.slice(0, 12),
    gateQuery: gateQuery(policy),
    ciWith: ciWith(policy),
    savedPolicy,
  };
}

/**
 * The GitHub-Action YAML preamble that enforces the gate in CI — the canonical source for the
 * action ref, the `ascent-url` var line, and the `with:` indentation, returned as base-indent
 * lines. The governance PAGE renders these directly in its <pre>; governanceMarkdown indents them
 * for its fenced code block. Single-sourcing it means bumping the action version / renaming the
 * input / changing the indent can't ship one stale config (the on-screen snippet vs the LLM brief).
 */
export function ciActionYaml(withLines: string[]): string[] {
  return ["- uses: <owner>/ascent@v1", "  with:", "    ascent-url: ${{ vars.ASCENT_URL }}", ...withLines.map((w) => `    ${w}`)];
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
  out.push(`- ${o.passing}/${o.assessed} judged repos PASS the gate (${o.passRate}%)`);
  out.push(
    `- Failing on: ${o.byReason.level} below level · ${o.byReason.dimension} dimension floor · ${o.byReason.posture} posture${o.byReason.overall ? ` · ${o.byReason.overall} overall` : ""}${o.byReason.governance ? ` · ${o.byReason.governance} unprotected branch` : ""}`,
  );
  // The unscorable bucket is stated OUTSIDE the failing-on list on purpose: it is not a gate
  // condition anyone failed, it is the share of the fleet the rate above does not describe. Printed
  // only when nonzero — an always-present "0 unscorable" line would be noise on a healthy fleet, and
  // the reader who needs it is the one whose denominator just shrank.
  if (o.incomplete) {
    out.push(
      `- NOT JUDGED: ${o.incomplete} of ${o.scanned} scanned repos scored nothing (every detector failed or returned no data), so they are excluded from the pass rate above — re-scan or check repository access before reading this number as a fleet verdict.`,
    );
  }
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
  // Single-sourced action preamble (ciActionYaml), indented two spaces for the fenced code block.
  for (const line of ciActionYaml(o.ciWith)) out.push(`  ${line}`);
  out.push("  ```");
  out.push("");
  out.push("## Ask");
  out.push(
    "Given this fleet gate status, propose the cheapest path to raise the pass-rate: which failing repos are closest to passing, the specific gate condition each one misses, and the concrete change to clear it. Prioritize repos that fail on a single condition.",
  );
  return out.join("\n");
}
