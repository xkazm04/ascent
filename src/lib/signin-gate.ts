// The "should this page show a sign-in prompt, and which button?" decision, in one place.
//
// Every auth-gated page open-coded `isAuthConfigured() && !session`. That predicate keys on the DORMANT
// custom-OAuth env, which production leaves unset, so the gate NEVER fired: a signed-out visitor to
// /usage, /trends, /report/compare or /connect fell straight through to a page that then rendered
// nothing useful (canReadOrg correctly refuses their data) with no prompt to sign in. And the one page
// that DID prompt used SignInNotice's default provider — the dormant custom-OAuth button, which under
// the Supabase wall dead-ends at /connect?error=not_configured. So the prompt, when shown, was broken.
//
// `src/app/org/[slug]/layout.tsx` already had this right: check the ACTIVE Supabase wall first (offering
// the supabase button), then fall back to the dormant session check. This lifts that shape out of it so
// the other pages stop re-deriving it — and getting it wrong.
//
// Auth-off (local/demo) deployments configure neither stack, so `needsSignIn` is false and every page
// stays open, exactly as before.

import { getViewer } from "@/lib/access";
import { getSessionState, isAuthConfigured, type Session } from "@/lib/auth";
import { authGateEnabled } from "@/lib/env";

export interface SignInState {
  /** True when an auth stack is enforced and nobody is signed in to it. */
  needsSignIn: boolean;
  /** Which sign-in button the prompt must offer — the ACTIVE stack's, never the dormant one. */
  provider: "supabase" | "github";
  /** The custom-OAuth session timed out (as opposed to never existing). Always false under Supabase. */
  expired: boolean;
  /** The dormant custom-OAuth session, for the callers that still thread it onward. */
  session: Session | null;
}

/**
 * Resolve the sign-in prompt state for a server component or route handler.
 *
 * Must be awaited in a render/route body, never inside a `ReadableStream start()` — the cookie-scoped
 * reads underneath return null there (same constraint as resolveViewerLogin; see access.ts).
 */
export async function resolveSignInState(): Promise<SignInState> {
  // ACTIVE Supabase wall first. A signed-in viewer satisfies it; nobody else does.
  if (authGateEnabled()) {
    const viewer = await getViewer();
    if (viewer) {
      const { session } = await getSessionState();
      return { needsSignIn: false, provider: "supabase", expired: false, session };
    }
    return { needsSignIn: true, provider: "supabase", expired: false, session: null };
  }

  // Dormant custom OAuth, configured (dev boxes that set the legacy env).
  const { session, status } = await getSessionState();
  if (isAuthConfigured()) {
    return { needsSignIn: !session, provider: "github", expired: status === "expired", session };
  }

  // No auth stack live at all: local / demo. Nothing to prompt for.
  return { needsSignIn: false, provider: "github", expired: false, session };
}
