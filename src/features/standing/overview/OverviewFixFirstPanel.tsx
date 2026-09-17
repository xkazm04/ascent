import { OverviewFixFirst } from "./OverviewFixFirst";
import { deriveFixFirst } from "./fixFirst";
import { getOrgMovers } from "@/lib/db/org-insights";
import type { OrgWindow } from "@/lib/db/org-rollup";
import { listGoals, resolvedKeys } from "@/lib/db";
import { getOrgFindings } from "@/lib/org/nav-counts";

export { OverviewFixFirstGap } from "./OverviewFixFirst";

// Server panel for the "Fix first" band. Lives in its OWN <Suspense> boundary (see OverviewTab):
// the deleted 8fff1001 version was cut because it taxed the landing path with reads the page never
// makes — this revival keeps the marginal cost to movers + goals (findings ride the rail badges'
// unstable_cache, and decisions are subtracted fresh exactly like getOrgFindingCounts does).
// Goals/findings/decisions are .catch'ed so a blip cannot break the landing page. A movers throw
// is flagged `moversFailed` rather than emptied: substituting `{ regressers: [] }` skipped the
// regression slot and read as "no scoring model". "No band" (`OverviewFixFirst` returns null) is
// the resolved empty. The wait is `OverviewFixFirstGap` in OverviewTab's Suspense.

export async function OverviewFixFirstPanel({
  slug,
  win,
  scopeQuery,
}: {
  slug: string;
  /** The window as the db layer takes it — half-open `{ start, endExclusive }` from `orgWindowBounds`.
   *  Typed as `OrgWindow` (which carries the legacy inclusive `end` as an optional) rather than
   *  re-declaring an inclusive-only pair here, which is what pinned the tab to the old dialect. */
  win: OrgWindow;
  scopeQuery?: string;
}) {
  const [moversRead, goals, findings, resolved] = await Promise.all([
    // A throw is not `{ regressers: [], comparedRepos: 0 }`: that skipped the regression slot and
    // let a void bar read as "no scoring model". Flag the rejection so deriveFixFirst can name it.
    getOrgMovers(slug, win)
      .then((value) => ({ failed: false, value }))
      .catch(() => ({ failed: true, value: null })),
    listGoals(slug).catch(() => null),
    getOrgFindings(slug).catch(() => []),
    resolvedKeys(slug).catch(() => new Map<string, Set<string>>()),
  ]);
  const movers = moversRead.value;

  const unresolved = findings.filter((f) => !resolved.get(f.module)?.has(f.itemKey));

  const items = deriveFixFirst(
    slug,
    {
      regressers: movers?.regressers ?? [],
      findings: unresolved,
      // Passed WHOLE (GoalProgress carries metricLabel/target/current beside the triage fields), so
      // a behind-pace goal's bar can be its remaining distance to target rather than a void. No extra
      // read: listGoals already computed them for the pace verdict this item is selected by.
      goals: goals ?? [],
      // The population a repo's regression is divided across before it may sit on a fleet scale.
      // A successful empty movers row still leaves it 0 (void bar, not a 0). A throw is moversFailed.
      comparedRepos: movers?.comparedRepos ?? 0,
      moversFailed: moversRead.failed,
    },
    scopeQuery,
  );

  return <OverviewFixFirst items={items} />;
}
