import { redirect } from "next/navigation";
import { resolveViewerLogin } from "@/lib/access";

export const dynamic = "force-dynamic";

/**
 * /me — the individual's front door, and now the destination of the header identity link (Brand.tsx
 * `IdentityLink`), so it is reachable from every page rather than only from two incidental CTAs.
 *
 * Resolves the signed-in viewer and lands them on their personal workspace at /org/{login}: an
 * Organization with kind "personal", auto-claimed on first visit by the identity-bound
 * personal-namespace seed in src/lib/authz.ts (login === slug, so nobody can claim a victim's
 * namespace). A viewer with NO organization is therefore coherent by construction — the claim creates
 * their own workspace and the org layout renders a zero-repo personal org's shell (its add-repo form
 * IS the empty state) instead of the "no data for this org" wall a real org would hit.
 *
 * Identity is resolved with `resolveViewerLogin`, the canonical cross-stack resolver (custom-OAuth
 * session first, then the Supabase / dev-bypass viewer) — NOT `getViewer` alone. The header link is
 * rendered from either stack, so a `getViewer`-only lookup would have bounced a custom-OAuth session
 * straight back to /connect: the exact dead-end this direction exists to remove. This resolves the
 * dormant branch's inconsistency rather than reviving custom OAuth — under the Supabase wall
 * `getSession()` is null and the precedence collapses to the viewer, unchanged.
 *
 * Signed-out visitors go to /connect to sign in first; the org layout's own login wall then covers the
 * walked-back-in case.
 */
export default async function MePage() {
  const login = await resolveViewerLogin();
  if (!login) redirect("/connect");
  redirect(`/org/${login.trim().toLowerCase()}`);
}
