// LOCAL MODE — the operator's own organization.
//
// Ascent's tenancy is org-shaped: a Repository hangs off an Organization, every gate is
// `(role × slug)`, and the fleet surfaces read `orgSlug`. That is right for a GitHub organization
// fleet and wrong for the case local mode actually serves — an operator whose projects are public
// repos on their PERSONAL account, which has no GitHub organization behind it at all. There is
// nothing to import, no installation to key off, and therefore no org to name in
// `/api/org/local/repo` or `/api/org/local/pairing`. Both routes work; the operator simply has no
// legal value to pass them.
//
// So local mode may declare one. `ASCENT_LOCAL_ORG` names a slug that exists because the operator
// said so, not because GitHub has a matching account.
//
// WHY `kind` STAYS "org" AND NOT "personal". `kind: "personal"` is not "an org for one person" —
// it has specific semantics (schema.prisma: a personal org holds watch-POINTER rows only, and a
// public repo's scan series stays in the shared `public` org, because the personal dashboard is a
// lens over that corpus rather than a second copy). This org is the opposite: it owns its repos and
// its scans, it is the scope a loop runs over, and its dimension scores have to be its own. Marking
// it personal would silently route every scan into the public corpus and leave this org rendering a
// lens over data it does not control.
//
// The flag gates DECLARATION, not behaviour: everything downstream still runs through
// `selfHostGuard()` and the owner role, exactly as the pairing routes always did.

import { selfHosted } from "@/lib/env";
import { ensureOrgId } from "@/lib/db/scans-shared";

/** Slug used when the flag is a bare boolean. Deliberately boring: it appears in every URL. */
const DEFAULT_LOCAL_ORG_SLUG = "local";

/** Slug rules mirror what the rest of the app already assumes about org slugs (URL-safe, lowercase). */
const SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,38}$/;

/**
 * The declared local-mode org slug, or null when the feature is off.
 *
 * `ASCENT_LOCAL_ORG=1` / `true` → the default slug. Any other non-empty value is used AS the slug
 * (so an operator can call it `workshop` or `kiro`). An unparsable value returns null rather than
 * falling back to the default — a typo that silently created an org under a name the operator did
 * not choose would be worse than the feature appearing to be off.
 *
 * Also null when this is not a self-hosted deployment. The org would be meaningless on managed
 * cloud: every surface that consumes it is 404'd there by `selfHostGuard()`.
 */
export function localOrgSlug(): string | null {
  if (!selfHosted()) return null;
  const raw = process.env.ASCENT_LOCAL_ORG?.trim();
  if (!raw) return null;
  const lowered = raw.toLowerCase();
  if (lowered === "0" || lowered === "false") return null;
  if (lowered === "1" || lowered === "true") return DEFAULT_LOCAL_ORG_SLUG;
  return SLUG_RE.test(lowered) ? lowered : null;
}

/** Display name for the declared org. Falls back to the slug so the header is never empty. */
export function localOrgName(): string | null {
  const slug = localOrgSlug();
  if (!slug) return null;
  const raw = process.env.ASCENT_LOCAL_ORG_NAME?.trim();
  return raw || slug;
}

/** Whether a given slug IS the declared local org — the check every local-mode route makes before
 *  acting on an operator-supplied `org`, so this door can never be pointed at a real tenant. */
export function isLocalOrg(slug: string | null | undefined): boolean {
  const declared = localOrgSlug();
  return declared != null && typeof slug === "string" && slug.trim().toLowerCase() === declared;
}

/**
 * Ensure the declared org row exists, returning `{ slug, id }` — or null when the feature is off.
 *
 * Idempotent and cheap: `ensureOrgId` reads first and caches per process, so this costs one indexed
 * read after the first call. Creating on demand rather than at boot is deliberate — an env flag
 * flipped on a running server takes effect at the next request instead of needing a restart, and
 * boot-time creation would write a tenant row on every cold start whether or not anything used it.
 */
export async function ensureLocalOrg(): Promise<{ slug: string; id: string } | null> {
  const slug = localOrgSlug();
  if (!slug) return null;
  const id = await ensureOrgId(slug);
  return { slug, id };
}
