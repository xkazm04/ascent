// The ONE rule for "which orgs may this viewer select in the header, and which one is active".
//
// Pure (no cookies, no DB, no session reads) so both identity stacks feed the same function and it can
// be pinned exhaustively. The loader beside it (viewer-workspace.ts) gathers the inputs in the
// render/route body and filters them through canReadOrg first, so the options this returns are always
// a subset of what the read gate - and POST /api/org/active, which writes the cookie - admit.
//
// It used to be two vocabularies: getActiveOrg/orgOptionsForSession (src/lib/auth.ts) built the set
// from the DORMANT custom-OAuth session's installations only, while the write side validated with
// canReadOrg (memberships under the Supabase wall). Production never mints the dormant session, so the
// read collapsed to ["public"] and a remembered org could never be read back. Those two functions are
// left in auth.ts for any dormant-only caller; nothing in the app reads through them any more.

import { PUBLIC_ORG } from "@/lib/org-constants";

/** The dormant custom-OAuth session, reduced to the one field this rule reads. */
export interface WorkspaceDormantSession {
  installations: ReadonlyArray<{ id: number | string; login: string }>;
}

/** One membership row, most-privileged first (listOrgsForLogin's order); `[0]` is the primary org. */
export interface WorkspaceMembership {
  slug: string;
  role: "owner" | "admin" | "member" | "viewer";
}

export interface WorkspaceInput {
  dormantSession: WorkspaceDormantSession | null;
  memberships: ReadonlyArray<WorkspaceMembership>;
  /** The raw ACTIVE_ORG cookie value, untrusted. */
  cookieOrg: string | null | undefined;
}

export interface ViewerWorkspace {
  /** Selectable orgs: installations, then memberships, deduped case-insensitively (first casing wins), "public" last. */
  options: string[];
  /** Always an element of `options`. */
  active: string;
}

/**
 * Resolve the selectable orgs and the active one. The cookie only ever picks AMONG the options (a
 * stale or hand-set value can never name an org outside them); without a usable cookie the active org
 * is the primary membership, else the first installation, else "public".
 */
export function resolveWorkspace({ dormantSession, memberships, cookieOrg }: WorkspaceInput): ViewerWorkspace {
  const options: string[] = [];
  const seen = new Set<string>([PUBLIC_ORG]);
  const add = (org: string) => {
    const trimmed = org.trim();
    const lc = trimmed.toLowerCase();
    if (!trimmed || seen.has(lc)) return;
    seen.add(lc);
    options.push(trimmed);
  };
  for (const i of dormantSession?.installations ?? []) add(i.login);
  for (const m of memberships) add(m.slug);
  options.push(PUBLIC_ORG);

  const canonical = (org: string | null | undefined): string | undefined => {
    const lc = org?.trim().toLowerCase();
    return lc ? options.find((o) => o.toLowerCase() === lc) : undefined;
  };

  const active =
    canonical(cookieOrg) ??
    canonical(memberships.find((m) => m.slug.trim().toLowerCase() !== PUBLIC_ORG)?.slug) ??
    canonical(dormantSession?.installations[0]?.login) ??
    PUBLIC_ORG;
  return { options, active };
}
