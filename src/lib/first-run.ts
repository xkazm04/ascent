// The first-run decision: where a "scan your org" click should land, and what that page shows.
//
// Two deployments, two first experiences. The hosted cloud wants a GitHub sign-in first — identity
// is what unlocks history, private repos and the org dashboard, so the wizard's public path is the
// fallback, not the pitch. A self-hosted install (`selfHosted()`, src/lib/env.ts) has no funnel to
// optimise: if a login wall is on, sign in; if nothing has been set up yet, the right next step is not
// a form in the browser at all but the repo's own `/onboarding` skill, run from Claude Code in the
// clone, which probes the machine, collects keys and boots the app. Only when a tenant exists does
// the in-app wizard become the useful surface.
//
// The mode read is `selfHosted()` (behaviour), not `selfHostedExplicit()` (deliberate local-mode UI):
// an implicit self-host — a fresh clone with no billing — is exactly the install whose first run
// should not sell cloud plans or ask for a sign-in it doesn't enforce.
//
// Server-only: reads env, the DB and the request cookies. Pages resolve this once and pass the
// result down as props; nothing in a client bundle reads it.

import { authGateEnabled, selfHosted, supabaseAuthConfigured } from "@/lib/env";
import { isAuthConfigured } from "@/lib/auth";
import { resolveViewerLogin } from "@/lib/access";
import { isAppConfigured } from "@/lib/github/app";
import { localOrgSlug } from "@/lib/local/org";
import { countTenantOrgs } from "@/lib/db";

export type FirstRunMode = "cloud" | "self-hosted";

/** Which GitHub sign-in backend is live — the same pick every page makes for its sign-in button. */
export type FirstRunAuth = "supabase" | "github" | null;

/**
 * `ready`: a tenant exists (or is declared), so the in-app wizard has somewhere to put a scan.
 * `unset`: nothing configured — send the operator to the `/onboarding` skill rather than a wizard
 * whose imports would land in an org nobody set up. Only meaningful on a self-hosted install; the
 * cloud is always `ready` (its tenants are created by the wizard itself).
 */
export type FirstRunSetup = "ready" | "unset";

export interface FirstRunState {
  mode: FirstRunMode;
  auth: FirstRunAuth;
  /** The login wall is enforced here (Supabase configured + bypass off). */
  gated: boolean;
  signedIn: boolean;
  setup: FirstRunSetup;
}

/** Pure — the setup verdict from facts the caller already resolved. Exported for tests. */
export function resolveFirstRunSetup(facts: {
  selfHosted: boolean;
  localOrg: string | null;
  appConfigured: boolean;
  tenantOrgs: number;
}): FirstRunSetup {
  if (!facts.selfHosted) return "ready";
  if (facts.localOrg) return "ready";
  if (facts.appConfigured) return "ready";
  return facts.tenantOrgs > 0 ? "ready" : "unset";
}

/** Must be awaited in a page/route body, never inside a `ReadableStream start()` (cookie reads). */
export async function resolveFirstRun(): Promise<FirstRunState> {
  const mode: FirstRunMode = selfHosted() ? "self-hosted" : "cloud";
  const auth: FirstRunAuth = supabaseAuthConfigured() ? "supabase" : isAuthConfigured() ? "github" : null;
  const gated = authGateEnabled();
  const [login, tenantOrgs] = await Promise.all([
    resolveViewerLogin(),
    mode === "self-hosted" ? countTenantOrgs() : Promise.resolve(0),
  ]);
  const setup = resolveFirstRunSetup({
    selfHosted: mode === "self-hosted",
    localOrg: localOrgSlug(),
    appConfigured: isAppConfigured(),
    tenantOrgs,
  });
  return { mode, auth, gated, signedIn: Boolean(login), setup };
}
