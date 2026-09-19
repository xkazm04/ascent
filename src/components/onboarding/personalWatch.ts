// Carry the wizard's chosen repositories across the personal-tier handoff as WATCH INTENTS.
//
// A personal workspace is a LENS over the shared public corpus: it may not import scans (that's what
// requireFleetOrg refuses), but it CAN hold pointer rows via the existing POST /api/me/watch
// ({ repo, watched }) — identity-gated, public-repo-verified, capped at PERSONAL_WATCH_LIMIT (10).
// The wizard's own selection cap is 10, so a full selection fits the personal cap exactly.
//
// We layer on that route rather than inventing a second write path: it already owns the verification,
// the cap (402), the personal-org seed, and the pointer write. All this module does is fan the
// selection out over it, one repo at a time, and report honestly on what didn't land.

export interface WatchIntentOutcome {
  /** fullNames now on the personal watchlist. */
  tracked: string[];
  /** fullNames the route refused, with its reason (cap reached, not public, upstream). */
  refused: { repo: string; reason: string }[];
}

/**
 * POST each repo to /api/me/watch, sequentially — the route enforces a cap, so parallel writes could
 * race past it, and 10 requests is a trivial serial cost. Never throws: a refusal is data, because the
 * user is standing at a handoff screen and needs to know exactly which repos made it.
 */
export async function trackPersonalRepos(fullNames: string[]): Promise<WatchIntentOutcome> {
  const tracked: string[] = [];
  const refused: { repo: string; reason: string }[] = [];
  for (const repo of fullNames) {
    try {
      const res = await fetch("/api/me/watch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo, watched: true }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (res.ok) tracked.push(repo);
      else refused.push({ repo, reason: data?.error ?? `Couldn't track ${repo}.` });
    } catch {
      refused.push({ repo, reason: "Couldn't reach the server." });
    }
  }
  return { tracked, refused };
}

/**
 * Which of the wizard's picks are eligible for a personal watchlist. The route verifies PUBLIC
 * visibility and answers 404 for anything else, so a private repo listed through a GitHub App
 * installation would be a guaranteed refusal — filter it out here and disclose the count instead of
 * marching the user through failures we can predict.
 */
export function eligibleForPersonalWatch(repos: { fullName: string; private: boolean }[]): string[] {
  return repos.filter((r) => !r.private).map((r) => r.fullName);
}
