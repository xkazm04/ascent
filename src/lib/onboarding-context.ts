// What /onboarding knows about the viewer before they pick an org: their App installations, the orgs
// sign-in discovered for them, the org whose watchlist sign-in pre-seeded, and which session controls
// can actually work for them.
//
// The page used to read all of it off getSession(), the DORMANT custom-OAuth cookie. The live Supabase
// stack never mints that cookie, so in production all three wizard shortcuts were empty, the "Welcome
// back" jump could not fire for an installed org, and "Sign out everywhere else" was never rendered.
//
//  - dormant session present -> exactly the old reads (custom-stack parity), controls "dormant";
//  - otherwise, a viewer      -> membership-derived installations + the discovery row recorded at sign-in
//                                for the viewer's OWN login, controls "supabase" while the live wall is on;
//  - nobody                   -> empty, no controls, and neither reader runs.
//
// Pure apart from the injected readers, so the authorization-relevant property (discovery is keyed on
// the resolved viewer, never on request input) is pinned by unit tests. The page awaits this in its
// body, never inside a ReadableStream start(): the readers it injects are cookie-scoped.

export type SessionControlsStack = "dormant" | "supabase";

export interface OnboardingInstallation {
  login: string;
  id: string;
}

export interface OnboardingContext {
  installations: OnboardingInstallation[];
  suggestedOrgs: string[];
  seededOrg?: string;
  controls: SessionControlsStack | null;
}

export interface OnboardingContextDeps {
  /** The dormant custom-OAuth session, when that stack minted one. */
  session: {
    installations: { id: number | string; login: string }[];
    suggestedOrgs?: string[];
    seededOrg?: string;
  } | null;
  /** The resolved viewer (the identity every gate uses). Its login is the ONLY discovery key. */
  viewer: { login: string } | null;
  /** Whether the live login wall is on: only then does the revoke route act on the live stack. */
  liveWall?: boolean;
  getInstallations: () => Promise<{ id: number | string; login: string }[]>;
  getLoginDiscovery: (login: string) => Promise<{ suggestedOrgs: string[]; seededOrg?: string } | null>;
}

const EMPTY: OnboardingContext = { installations: [], suggestedOrgs: [], seededOrg: undefined, controls: null };

const toInstallation = (i: { id: number | string; login: string }): OnboardingInstallation => ({
  login: i.login,
  id: String(i.id),
});

/** Resolve the onboarding context. Never throws: a failed reader costs its shortcut, not the page. */
export async function resolveOnboardingContext(deps: OnboardingContextDeps): Promise<OnboardingContext> {
  const { session, viewer, liveWall = true } = deps;

  if (session) {
    return {
      installations: (session.installations ?? []).map(toInstallation),
      suggestedOrgs: session.suggestedOrgs ?? [],
      seededOrg: session.seededOrg,
      controls: "dormant",
    };
  }

  const login = viewer?.login?.trim();
  if (!login) return { ...EMPTY };

  const [installs, discovery] = await Promise.all([
    deps.getInstallations().catch(() => []),
    deps.getLoginDiscovery(login).catch(() => null),
  ]);
  const installations = installs.map(toInstallation);
  // An org the viewer already installed the App on is a source in the picker, not a suggestion.
  const installed = new Set(installations.map((i) => i.login.toLowerCase()));
  const suggestedOrgs = (discovery?.suggestedOrgs ?? []).filter((o) => !installed.has(o.toLowerCase()));

  return {
    installations,
    suggestedOrgs,
    seededOrg: discovery?.seededOrg,
    controls: liveWall ? "supabase" : null,
  };
}
