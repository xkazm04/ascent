// What the live (Supabase) sign-in learned about a login: the ranked not-yet-installed orgs to suggest
// and the org whose watchlist it pre-seeded (src/lib/auth-discovery.ts).
//
// The dormant custom-OAuth stack embeds both in its signed session cookie. The live stack has no such
// cookie, so its callback used to compute them in after() and discard them, and a production viewer
// reached /onboarding with none of the wizard's shortcuts. The callback now records them here and the
// onboarding page reads them back.
//
// CONTRACT: keyed on the lowercased GitHub login the IDENTITY PROVIDER returned (never a request
// parameter), read only for the resolved viewer's OWN login, one row per login overwritten per sign-in,
// org names only (no token, no secret). Persistence is optional: with no DB the write is a no-op and
// the read is null, which is exactly the pre-store behavior.

import { dbReadSafe, getPrisma, isDbConfigured } from "@/lib/db/client";

/** Same ceiling the dormant cookie applies to its suggestions (MAX_SESSION_SUGGESTED_ORGS in auth.ts). */
const MAX_STORED_SUGGESTIONS = 8;

/** A recorded discovery. `discoveredAt` is an ISO string: this shape is safe to hand to a client. */
export interface LoginDiscoverySnapshot {
  suggestedOrgs: string[];
  seededOrg?: string;
  discoveredAt: string;
}

const key = (login: string) => login.trim().toLowerCase();

function cleanOrgs(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const s = v.trim();
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= MAX_STORED_SUGGESTIONS) break;
  }
  return out;
}

/**
 * Record (replace) the discovery for a login. Returns whether a row was written. Never throws: it runs
 * in the sign-in callback's after() task, where a failure must only cost the suggestions.
 */
export async function recordLoginDiscovery(
  login: string,
  result: { suggestedOrgs?: string[]; seededOrg?: string },
): Promise<boolean> {
  const id = key(login);
  if (!id || !isDbConfigured()) return false;
  const fields = {
    suggestedOrgsJson: JSON.stringify(cleanOrgs(result.suggestedOrgs)),
    seededOrg: result.seededOrg?.trim() || null,
    discoveredAt: new Date(),
  };
  try {
    await getPrisma().loginDiscovery.upsert({
      where: { login: id },
      create: { login: id, ...fields },
      update: fields,
    });
    return true;
  } catch (err) {
    console.warn("[login-discovery] record failed", err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * The recorded discovery for a login, or null (no row, DB off, unreachable, or any read error). Callers
 * pass the RESOLVED viewer's login and nothing else: this store has no other read path.
 */
export async function getLoginDiscovery(login: string): Promise<LoginDiscoverySnapshot | null> {
  const id = key(login);
  if (!id || !isDbConfigured()) return null;
  try {
    const row = await dbReadSafe(
      () => getPrisma().loginDiscovery.findUnique({ where: { login: id } }),
      null,
    );
    if (!row) return null;
    let parsed: unknown = [];
    try {
      parsed = JSON.parse(row.suggestedOrgsJson);
    } catch {
      parsed = [];
    }
    return {
      suggestedOrgs: cleanOrgs(parsed),
      seededOrg: row.seededOrg ?? undefined,
      discoveredAt: row.discoveredAt.toISOString(),
    };
  } catch (err) {
    console.warn("[login-discovery] read failed", err instanceof Error ? err.message : err);
    return null;
  }
}
