// Login-time org auto-discovery + watchlist seeding, shared by BOTH OAuth callbacks.
//
// It lived as a module-private helper inside the DORMANT custom-OAuth callback
// (src/app/api/auth/callback/route.ts), and a `route.ts` may only export HTTP handlers — so the
// ACTIVE Supabase callback could not reach it. That is why the Supabase callback's own header lists
// "org auto-discovery + watchlist seeding" among the things production sign-ins skip, and why "a
// brand-new prod user lands on an empty dashboard": the code existed, in a file the live stack cannot
// import from. Lifting it here is what makes it callable from both.
//
// WHAT EACH STACK CAN USE. The custom stack's token is the Ascent GitHub App's OWN OAuth client, so it
// can additionally list the user's App installations. Supabase issues a token from ITS OAuth client, so
// `/user/installations` is not available there — the Supabase caller passes no installed logins, and
// selectSeedTarget then seeds only PUBLIC repos (an uninstalled org can't mint a token, so private rows
// would be dead watchlist entries — see its docblock). Installation LINKING therefore remains
// custom-stack-only, correctly: it needs a client Supabase's token isn't from.

import {
  fetchUserOrgs,
  fetchUserRepos,
  rankDiscoveredOrgs,
  selectSeedTarget,
  selectSuggestedOrgLogins,
} from "@/lib/github/discover";
import { seedWatchlist } from "@/lib/db";

/** What discovery produced. `suggestedOrgs` is only surfaceable by a caller that has somewhere to put
 *  it (the custom stack embeds it in the signed session cookie); the seeding is a DB side effect and
 *  therefore benefits every stack. */
export interface DiscoveryResult {
  suggestedOrgs?: string[];
  seededOrg?: string;
}

/**
 * Best-effort org auto-discovery for a fresh sign-in: list the user's orgs + recently-pushed repos,
 * rank them by activity, then return the not-yet-installed orgs to suggest and pre-seed the watchlist
 * for the most-active one so its rollup/trends have something to show.
 *
 * Every step is defensively caught: a denied scope, a rate-limited listing, or a DB hiccup degrades to
 * fewer (or no) suggestions rather than failing the sign-in this runs inside. Callers should still keep
 * their own guard — this never throws, but that is a property worth not depending on silently.
 *
 * `installedLogins` is the orgs the user already installed the App on (omit when the caller's token
 * cannot enumerate them — see the module header).
 */
export async function discoverOrgsForLogin(
  token: string,
  viewerLogin: string,
  installedLogins: string[] = [],
): Promise<DiscoveryResult> {
  try {
    const installedSlugs = installedLogins.map((l) => l.toLowerCase());
    const [orgLogins, repos] = await Promise.all([
      fetchUserOrgs(token).catch(() => [] as string[]),
      fetchUserRepos(token).catch(() => []),
    ]);
    const ranked = rankDiscoveredOrgs({ orgLogins, repos, installedSlugs, viewerLogin });
    const suggestedOrgs = selectSuggestedOrgLogins(ranked);

    let seededOrg: string | undefined;
    const seed = selectSeedTarget(ranked);
    if (seed) {
      try {
        const seeded = await seedWatchlist(seed.slug, seed.repos);
        // Only report a seeded org when seeding actually wrote (DB on + repos): a zero means
        // persistence is off, where the org view would just say "needs a database".
        if (seeded > 0) seededOrg = seed.slug;
      } catch (err) {
        console.warn(`[auth-discovery] watchlist seed failed for ${seed.slug}`, err);
      }
    }
    return { suggestedOrgs, seededOrg };
  } catch (err) {
    console.warn("[auth-discovery] org discovery failed; continuing without suggestions", err);
    return {};
  }
}
