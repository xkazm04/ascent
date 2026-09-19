// The GitHub-App installations the CURRENT viewer can chart, resolved across both auth stacks.
//
// `/launch` read them straight off the dormant custom-OAuth session (`session.installations`). Under the
// ACTIVE Supabase wall that session is never minted, so `session` was null — and the page's guard read
// `if (!session) { if (!isAuthConfigured()) redirect("/connect"); … }`. isAuthConfigured() is false in
// production, so the redirect ALWAYS fired: /launch was unreachable for everyone, signed in or not.
//
// The dormant session happens to carry installations inline. The Supabase viewer does not, so they have
// to come from the database: the orgs the viewer is a member of, each resolved to its stored installation.
// Orgs with no installation are skipped — there is nothing to chart for them.

import { getViewer } from "@/lib/access";
import { getSession } from "@/lib/auth";
import { getInstallationIdForOwner } from "@/lib/db";
import { listOrgsForLogin } from "@/lib/db/members";

/** Mirrors `Installation` in components/launch/FleetMap.constants.ts — GitHub installation ids are
 *  numeric, and the map keys its constellations on them. */
export interface ViewerInstallation {
  id: number;
  login: string;
}

/**
 * Resolve the viewer's installations, preferring the dormant custom-OAuth session when that stack is
 * live (it already carries them, no queries), else deriving them from the Supabase viewer's org
 * memberships. Returns an empty array for an anonymous caller — callers decide what that means.
 *
 * Must be awaited in a render/route body, never inside a `ReadableStream start()` (cookie-scoped reads;
 * see access.ts).
 */
export async function viewerInstallations(): Promise<ViewerInstallation[]> {
  const session = await getSession();
  if (session?.installations?.length) {
    return session.installations.map((i) => ({ id: Number(i.id), login: i.login }));
  }

  const viewer = await getViewer();
  if (!viewer) return [];

  const orgs = await listOrgsForLogin(viewer.login);
  if (!orgs.length) return [];

  // One indexed lookup per org the viewer belongs to — a handful, not a fan-out. An org whose App
  // installation was removed resolves to null and is dropped rather than charted as a dead star.
  const resolved = await Promise.all(
    orgs.map(async (o) => {
      const raw = await getInstallationIdForOwner(o.slug).catch(() => null);
      const id = raw == null ? NaN : Number(raw);
      // A non-numeric / absent id is not chartable: skip rather than render a star keyed on NaN.
      return Number.isFinite(id) ? { id, login: o.slug } : null;
    }),
  );
  return resolved.filter((x): x is ViewerInstallation => x !== null);
}

/**
 * A human name for the current viewer, across both stacks — the dormant session's display name when it
 * exists, else the Supabase viewer's. Falls back to a neutral word rather than rendering "undefined".
 */
export async function viewerDisplayName(): Promise<string> {
  const session = await getSession();
  if (session) return session.name ?? session.login;
  const viewer = await getViewer();
  return viewer?.name ?? viewer?.login ?? "you";
}
