// The SERVER-ONLY loaders behind the Developer route and the Contributors tab's Care section. Split
// from `developer-view.ts` (types + pure helpers) on the repo's established `*-load.ts` pattern — see
// `skill-usage-load.ts` / `skill-outcomes-load.ts`.
//
// Why the split is load-bearing here: the Developer render is a client component and needs the pure
// derivations (`CARE_SHAPE_LABEL`, `careShapeValue`, `careMovesByState`). If those lived in the same
// module as this `@/lib/db` import, the database layer would be dragged across the client boundary and
// `next build` would fail even with `tsc` and the unit tests green (the exact failure mode recorded in
// the "build not in the gate" note).

import { getContributorInsights, getOrgBacklog, getRepoStates } from "@/lib/db";
import { getOwnAgentSessions } from "@/lib/db/agent-sessions-viewer";
import { emptyDeveloperView, emptyOrgView, type CareOrgView, type DeveloperView } from "./developer-view";
import { applyOwnSessionShape, careTelemetryWindowStart } from "./care-session-telemetry";

/**
 * The signed-in developer's own view of themself inside `orgSlug` (docs/REGISTRY-AND-CARE-IMPL.md §5.4).
 *
 * REAL PATH, today: the viewer's slice of `getContributorInsights` (their commits, AI-attributed
 * share, the repos they touch, whether they are in the champions cohort) plus the OPEN
 * recommendations of exactly those repos, read from the org backlog. The care loop (profile, moves,
 * journal) stays the honest EMPTY state until C3 ships `POST /api/me/mentor/share` and the personal
 * tables — nothing here is invented to fill it. The session shape's one telemetry-measurable field
 * is the exception: it is read from the AgentSession rows sent under `viewerLogin` itself or under
 * `confirmedEmail` (`applyOwnSessionShape`), and is otherwise empty exactly as for an unknown user.
 *
 * `viewerLogin` and `confirmedEmail` MUST be the server-resolved identity of the requester
 * (`resolveViewerIdentity`: the email only when the auth provider confirmed it), never a value taken
 * from a query, a body or a header: they are the only keys the personal read is scoped by.
 *
 * Four honest degradations, each one NAMED in `activityState` rather than collapsed into a null:
 *   - `signed-out` — no viewer login, no reads issued;
 *   - `unreadable` — the contributor snapshot could not be read;
 *   - `withheld`   — the org population is under the naming floor, so `getContributorInsights`
 *                    suppressed every per-person row. The numbers exist and were withheld;
 *   - `absent`     — the snapshot was read and carries no row for this login.
 * `activity` is null in all four; only the state tells them apart, and the page encodes the
 * difference rather than showing zeros that would read as "you did nothing".
 */
export async function getDeveloperView(
  viewerLogin: string | null,
  orgSlug: string,
  now: Date = new Date(),
  confirmedEmail: string | null = null,
): Promise<DeveloperView> {
  const view = emptyDeveloperView(viewerLogin);
  if (!viewerLogin) return view;

  // The personal session read runs beside the snapshot read: it does not depend on the viewer having
  // a contributor row (someone who only asks questions in Claude Code has sessions and no commits).
  // Best-effort: a failure leaves the shape exactly as empty as for a viewer never seen.
  const [insights, ownSessions] = await Promise.all([
    getContributorInsights(orgSlug).catch(() => null),
    getOwnAgentSessions(orgSlug, { login: viewerLogin, confirmedEmail }, careTelemetryWindowStart(now)).catch(() => []),
  ]);
  applyOwnSessionShape(view, ownSessions, now, confirmedEmail);
  const login = viewerLogin.toLowerCase();
  const me = insights?.contributors.find((c) => c.login.toLowerCase() === login) ?? null;
  if (!me) {
    // Which absence this is, said out loud. `namingAllowed === false` means the producer suppressed
    // EVERY per-person row (population under CHAMPION_MIN_POP) — the developer's own numbers exist
    // and were withheld, which must not render as "you have never committed here".
    view.activityState = !insights ? "unreadable" : insights.namingAllowed === false ? "withheld" : "absent";
    return view;
  }

  view.activityState = "measured";
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
  // Standing beside the gaps. `getRepoStates` is the CHEAPEST existing per-repo read of the two
  // numbers `CareLevelMark` renders: one `repository.findMany` over the org with each repo's latest
  // scan (`take: 1` → `level`, `overallScore`) — the same shape the installation listing merges.
  // Deliberately not `getOrgRollup`, which would buy every dimension row, the governance/passport
  // blobs and two unbounded scan sweeps to print two scalars, and not `getOrgHeaderSummary`, which
  // is request-cached but carries fleet COUNTS only — no per-repo row exists in it. Both reads are
  // issued together so the extra query costs a round-trip, not a serialized wait; both are
  // best-effort, so a failure leaves the standing null ("—") and the gaps still render.
  const [backlog, states] = await Promise.all([
    getOrgBacklog(orgSlug).catch(() => null),
    getRepoStates(orgSlug).catch(() => null),
  ]);
  const byRepo = new Map<string, DeveloperView["myRepos"][number]>();
  for (const name of me.repoNames) {
    const state = states?.[name];
    byRepo.set(name, {
      fullName: name,
      // A repo with no scan has no state row (or a row whose latest scan is absent) → null, which the
      // mark renders as "—". Never guessed from the other field.
      level: state?.level ?? null,
      score: state?.overall ?? null,
      openRecommendations: [],
    });
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
