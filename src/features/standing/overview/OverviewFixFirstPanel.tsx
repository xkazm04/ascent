import { OverviewFixFirst } from "./OverviewFixFirst";
import { deriveFixFirst } from "./fixFirst";
import { getOrgMovers } from "@/lib/db/org-insights";
import { listGoals, resolvedKeys } from "@/lib/db";
import { getOrgFindings } from "@/lib/org/nav-counts";

// Server panel for the "Fix first" band. Lives in its OWN <Suspense> boundary (see OverviewTab):
// the deleted 8fff1001 version was cut because it taxed the landing path with reads the page never
// makes — this revival keeps the marginal cost to movers + goals (findings ride the rail badges'
// unstable_cache, and decisions are subtracted fresh exactly like getOrgFindingCounts does).
// Every read is .catch'ed: the band is guidance chrome, and a failed derivation must render as
// "no band", never as a broken landing page.

export async function OverviewFixFirstPanel({
  slug,
  win,
  scopeQuery,
}: {
  slug: string;
  win: { start: Date | null; end: Date | null };
  scopeQuery?: string;
}) {
  const [movers, goals, findings, resolved] = await Promise.all([
    getOrgMovers(slug, win).catch(() => null),
    listGoals(slug).catch(() => null),
    getOrgFindings(slug).catch(() => []),
    resolvedKeys(slug).catch(() => new Map<string, Set<string>>()),
  ]);

  const unresolved = findings.filter((f) => !resolved.get(f.module)?.has(f.itemKey));

  const items = deriveFixFirst(
    slug,
    {
      regressers: movers?.regressers ?? [],
      findings: unresolved,
      goals: goals ?? [],
    },
    scopeQuery,
  );

  return <OverviewFixFirst items={items} />;
}
