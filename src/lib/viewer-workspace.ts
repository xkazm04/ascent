// resolveViewerWorkspace - the loader behind every reader of "the viewer's active org": the header
// switcher (Brand.tsx HeaderAccount), bare /org, and /usage's default org.
//
// It gathers both identity stacks' inputs (the dormant custom-OAuth session, the viewer's memberships)
// plus the ACTIVE_ORG cookie, then keeps ONLY the candidates canReadOrg admits before handing them to
// the pure resolveWorkspace. canReadOrg is the predicate POST /api/org/active validates with when it
// WRITES the cookie, so the read and the write agree by construction: the switcher never offers an org
// the write would refuse, and a remembered org the write accepted is read back. No authorization moves
// here - the cookie only picks a default tenant, and every destination still runs its own gate.
//
// Must be awaited in a render/route body, never inside a ReadableStream start(): the cookie-scoped
// reads it depends on return null there.

import { cookies } from "next/headers";
import { ACTIVE_ORG_COOKIE, getSession } from "@/lib/auth";
import { resolveViewerLogin } from "@/lib/access";
import { listOrgsForLogin } from "@/lib/db";
import { canReadOrg } from "@/lib/authz";
import { PUBLIC_ORG } from "@/lib/org-constants";
import { resolveWorkspace, type ViewerWorkspace } from "@/lib/viewer-workspace-model";

export type { ViewerWorkspace } from "@/lib/viewer-workspace-model";

/**
 * The viewer's selectable orgs and active org. Never throws: the header renders on every page, so any
 * failed read (DB down, cookie store unavailable, the gate erroring) collapses to public only - the
 * narrowest answer, never a wider one.
 */
export async function resolveViewerWorkspace(): Promise<ViewerWorkspace> {
  try {
    const [session, login, store] = await Promise.all([getSession(), resolveViewerLogin(), cookies()]);
    const memberships = login ? await listOrgsForLogin(login) : [];
    const cookieOrg = store.get(ACTIVE_ORG_COOKIE)?.value ?? null;

    // Candidates from both stacks, then the read gate on each private one (public is always readable).
    const candidates = resolveWorkspace({ dormantSession: session, memberships, cookieOrg: null }).options;
    const readable = new Set<string>([PUBLIC_ORG]);
    for (const org of candidates) {
      if (org.toLowerCase() === PUBLIC_ORG) continue;
      if (await canReadOrg(org)) readable.add(org.toLowerCase());
    }
    const keep = (org: string) => readable.has(org.trim().toLowerCase());

    return resolveWorkspace({
      dormantSession: session ? { installations: session.installations.filter((i) => keep(i.login)) } : null,
      memberships: memberships.filter((m) => keep(m.slug)),
      cookieOrg,
    });
  } catch {
    return { options: [PUBLIC_ORG], active: PUBLIC_ORG };
  }
}
