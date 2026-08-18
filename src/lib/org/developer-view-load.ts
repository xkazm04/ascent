// The SERVER-ONLY loaders behind the Developer route and the Contributors tab's Care section. Split
// from `developer-view.ts` (types + pure helpers) on the repo's established `*-load.ts` pattern — see
// `skill-usage-load.ts` / `skill-outcomes-load.ts`.
//
// Why the split is load-bearing here: the Developer render is a client component and needs the pure
// derivations (`CARE_SHAPE_LABEL`, `careShapeValue`, `careMovesByState`). If those lived in the same
// module as this `@/lib/db` import, the database layer would be dragged across the client boundary and
// `next build` would fail even with `tsc` and the unit tests green (the exact failure mode recorded in
// the "build not in the gate" note).

import { getContributorInsights, getOrgBacklog } from "@/lib/db";
import { emptyDeveloperView, emptyOrgView, type CareOrgView, type DeveloperView } from "./developer-view";

/**
 * The signed-in developer's own view of themself inside `orgSlug` (docs/REGISTRY-AND-CARE-IMPL.md §5.4).
 *
 * REAL PATH, today: the viewer's slice of `getContributorInsights` (their commits, AI-attributed
 * share, the repos they touch, whether they are in the champions cohort) plus the OPEN
 * recommendations of exactly those repos, read from the org backlog. The care loop (profile, moves,
 * journal, session shape) stays the honest EMPTY state until C3 ships `POST /api/me/mentor/share` and
 * the personal tables — nothing here is invented to fill it.
 *
 * Two honest degradations, both silent by design:
 *   - no viewer login (signed out / no identity) ⇒ the empty view, no reads issued;
 *   - the org population is under the naming floor, so `getContributorInsights` withholds every
 *     per-person row ⇒ `activity` is null and `myRepos` is empty. The page says so rather than
 *     showing zeros that read as "you did nothing".
 */
export async function getDeveloperView(viewerLogin: string | null, orgSlug: string): Promise<DeveloperView> {
  const view = emptyDeveloperView(viewerLogin);
  if (!viewerLogin) return view;

  const insights = await getContributorInsights(orgSlug).catch(() => null);
  const login = viewerLogin.toLowerCase();
  const me = insights?.contributors.find((c) => c.login.toLowerCase() === login) ?? null;
  if (!me) return view;

  view.activity = {
    commits: me.commits,
    aiCommits: me.aiCommits,
    aiShare: me.aiShare,
    repos: me.repos,
    lastActiveAt: me.lastActiveAt,
    champion: Boolean(insights?.champions.some((c) => c.login.toLowerCase() === login)),
  };

  // The open gaps of MY repos — the cross-repo grounding the on-machine mentor cannot see. Read from
  // the org backlog (open + in_progress only, by construction) and narrowed to the repos this login
  // actually commits to, so the list is a map of what they could champion, not the fleet's backlog.
  const mine = new Set(me.repoNames);
  const backlog = await getOrgBacklog(orgSlug).catch(() => null);
  const byRepo = new Map<string, DeveloperView["myRepos"][number]>();
  for (const name of me.repoNames) {
    byRepo.set(name, { fullName: name, level: null, score: null, openRecommendations: [] });
  }
  for (const group of backlog?.byOwner ?? []) {
    for (const item of group.items) {
      if (!mine.has(item.repo)) continue;
      const row = byRepo.get(item.repo);
      if (!row || row.openRecommendations.length >= 4) continue;
      row.openRecommendations.push({ title: item.title, dimension: item.dimId });
    }
  }
  // Ordered the way the contributor snapshot orders them: this developer's most-committed repo first.
  view.myRepos = me.repoNames.map((n) => byRepo.get(n)!).filter(Boolean);
  return view;
}

/**
 * The org's anonymized care aggregate — the Contributors tab's Care section (§5.2). Floors are the
 * SAME `champions.ts` floors the rest of that tab uses; below them the view suppresses rather than
 * thins. Until C4 lands this is the honest empty aggregate keyed on the real contributor population,
 * so the floor note is truthful about how many people the workspace actually has.
 */
export async function getCareOrgAggregate(orgSlug: string): Promise<CareOrgView> {
  const insights = await getContributorInsights(orgSlug).catch(() => null);
  return emptyOrgView(insights?.totalContributors ?? 0);
}
