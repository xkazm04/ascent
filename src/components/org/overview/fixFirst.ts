// Pure derivation for the Overview "Fix first" punch-list (kept out of the .tsx so the no-jsdom
// vitest setup can pin it — same split PeriodSummary.test.ts wishes it had). The list is DERIVED,
// deterministic, and costs no extra queries: every candidate comes from data the Overview page
// already fetched (movers, gap analysis, goals, posture counts). Priority order is triage-shaped:
// a live regression outranks a standing gap, which outranks a slipping goal; the ungoverned-cohort
// nudge only fills remaining space. Capped at 3 — a punch-list, not a backlog.

import { orgTabHref } from "@/lib/org/orgTabs";

export interface FixFirstInputs {
  /** movers.regressers — pre-sorted most-negative-first by getOrgMovers, dOverall < 0 guaranteed. */
  regressers: { name: string; fullName: string; dOverall: number }[];
  /** gapAnalysis.commonGaps — ranked by the analyzer (most systemic first). */
  commonGaps: { label: string; weakCount: number; total: number; practiceId: string | null }[];
  /** listGoals rows (any shape carrying label/status/pace). */
  goals: { label: string; status: string; pace: string }[];
  /** postureCounts["ungoverned"] — high adoption without rigor guardrails. */
  ungovernedCount: number;
}

export interface FixFirstItem {
  key: "regression" | "gap" | "goal" | "ungoverned";
  title: string;
  detail: string;
  href: string;
  cta: string;
}

/** Append the active scope query (e.g. "stack=react") to an org-internal link, inserting it BEFORE
 *  any #fragment and choosing ?/& by whether the path already has a query. No scope → unchanged. */
function withScope(path: string, scope?: string): string {
  if (!scope) return path;
  const hash = path.indexOf("#");
  const base = hash === -1 ? path : path.slice(0, hash);
  const frag = hash === -1 ? "" : path.slice(hash);
  return `${base}${base.includes("?") ? "&" : "?"}${scope}${frag}`;
}

/**
 * @param scopeQuery Active tech-stack scope as a bare query fragment (e.g. "stack=react"), carried into
 *   the org-internal links so drilling in keeps the filter the Overview is showing. The report
 *   permalink is scope-free (a repo report isn't fleet-scoped).
 */
export function deriveFixFirst(slug: string, inp: FixFirstInputs, scopeQuery?: string): FixFirstItem[] {
  const items: FixFirstItem[] = [];

  const worst = inp.regressers[0];
  if (worst) {
    items.push({
      key: "regression",
      title: `Triage ${worst.name}`,
      detail: `regressed ${Math.abs(worst.dOverall)} pts this period`,
      href: `/report/${worst.fullName}`,
      cta: "open report →",
    });
  }

  const gap = inp.commonGaps[0];
  if (gap) {
    items.push({
      key: "gap",
      title: `Close the ${gap.label} gap`,
      detail: `weak in ${gap.weakCount}/${gap.total} repos — fix once, reuse fleet-wide`,
      href: withScope(gap.practiceId ? `${orgTabHref(slug, "practices")}#practice-${gap.practiceId}` : orgTabHref(slug, "practices"), scopeQuery),
      cta: "reuse a practice →",
    });
  }

  const behind = inp.goals.find((g) => g.status === "active" && g.pace === "behind");
  if (behind) {
    items.push({
      key: "goal",
      title: `Rescue “${behind.label}”`,
      detail: "behind the pace its deadline needs",
      href: withScope(orgTabHref(slug, "plan"), scopeQuery),
      cta: "review plan →",
    });
  }

  if (items.length < 3 && inp.ungovernedCount > 0) {
    items.push({
      key: "ungoverned",
      title: `Govern ${inp.ungovernedCount} fast-moving repo${inp.ungovernedCount === 1 ? "" : "s"}`,
      detail: "high AI adoption without rigor guardrails",
      href: withScope(`/org/${slug}/repositories?posture=ungoverned`, scopeQuery),
      cta: "view repos →",
    });
  }

  return items.slice(0, 3);
}
