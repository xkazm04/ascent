// Pure derivation for the Overview "Fix first" punch-list (kept out of the .tsx so the no-jsdom
// vitest setup can pin it). Revived from 8fff1001 with a cheaper input set: the original mounted
// three reads the Overview never makes (movers, gap analysis, goals) PLUS the rollup; this version
// swaps the gap-analysis item for the shell's derived findings — already unstable_cache'd for the
// rail badges, so the marginal cost on the landing path is movers + goals only, and both stream in
// their own Suspense boundary (OverviewFixFirstPanel) without holding the fleet panel.
//
// Priority order is triage-shaped: a live regression outranks a finding awaiting a human decision,
// which outranks a slipping goal. Capped at 3 — a punch-list, not a backlog.

import { orgTabHref } from "@/lib/org/orgTabs";
import { FINDING_MODULES, type FindingModule } from "@/lib/org/findings";

export interface FixFirstInputs {
  /** movers.regressers — pre-sorted most-negative-first by getOrgMovers, dOverall < 0 guaranteed. */
  regressers: { name: string; fullName: string; dOverall: number }[];
  /** Derived findings a human hasn't resolved yet (getOrgFindings minus resolvedKeys). */
  findings: { module: FindingModule; repo: string; title: string }[];
  /** listGoals rows (any shape carrying label/status/pace). */
  goals: { label: string; status: string; pace: string }[];
}

export interface FixFirstItem {
  key: "regression" | "finding" | "goal";
  title: string;
  detail: string;
  href: string;
  cta: string;
}

/** How each finding module reads in a sentence. Keys double as the org tab the item links to. */
const MODULE_LABEL: Record<FindingModule, string> = {
  security: "security",
  teams: "team ownership",
  passports: "passport",
  contributors: "contributor-risk",
};

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
 * @param scopeQuery Active tech-stack scope as a bare query fragment (e.g. "stack=react"), carried
 *   into the org-internal links so drilling in keeps the filter the Overview is showing. The report
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

  // The busiest findings module wins the slot; ties resolve in FINDING_MODULES order (security
  // first — the same precedence the rail lists them in). One item total: the punch-list points at
  // the queue, it doesn't mirror it.
  const byModule = new Map<FindingModule, { count: number; first: FixFirstInputs["findings"][number] }>();
  for (const f of inp.findings) {
    const cur = byModule.get(f.module);
    if (cur) cur.count += 1;
    else byModule.set(f.module, { count: 1, first: f });
  }
  let top: { module: FindingModule; count: number; first: FixFirstInputs["findings"][number] } | null = null;
  for (const m of FINDING_MODULES) {
    const entry = byModule.get(m);
    if (entry && (!top || entry.count > top.count)) top = { module: m, ...entry };
  }
  if (top) {
    items.push({
      key: "finding",
      title:
        top.count === 1
          ? `Decide 1 ${MODULE_LABEL[top.module]} finding`
          : `Decide ${top.count} ${MODULE_LABEL[top.module]} findings`,
      detail: `e.g. ${top.first.repo}: ${top.first.title}`,
      href: withScope(orgTabHref(slug, top.module), scopeQuery),
      cta: "review queue →",
    });
  }

  const behind = inp.goals.find((g) => g.status === "active" && g.pace === "behind");
  if (behind) {
    items.push({
      key: "goal",
      title: `Rescue “${behind.label}”`,
      detail: "behind the pace its deadline needs",
      href: withScope(orgTabHref(slug, "followups"), scopeQuery),
      cta: "work the follow-ups →",
    });
  }

  return items.slice(0, 3);
}
