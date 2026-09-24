// The ONE per-person read of `AgentSession`: the signed-in viewer's own attempts, for their private
// session shape on the Developer home (backlog develop-2026-09-17 row 27).
//
// Everything else over this table rolls up at repo x period and never by person (`agent-sessions.ts`).
// This read is the exception, and it is fenced four ways:
//   - the keys are the viewer's own login and the email their auth provider CONFIRMED, both resolved
//     server-side by the CALLER (`resolveViewerIdentity`); there is no variant that takes an arbitrary
//     list of keys, and no login means no read at all;
//   - the match is EXACT (`in` over each key as resolved and lower-cased, `ownSessionKeys`), never
//     `contains` or an insensitive mode, so no wildcard or partial key can widen it onto another person;
//   - it selects `userKey` and `startedAt` only: no session id, repo, cost or token count leaves the
//     database through it (the table stores no transcript or prompt at all);
//   - a blank key, no database or an unknown org returns [] before any query.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgBySlug } from "@/lib/db/org-shared";
import { ownSessionKeys, type OwnSessionRow } from "@/lib/org/care-session-telemetry";

/** Who the read is for: the server-resolved login and the email the auth provider confirmed, if any. */
export interface OwnSessionViewer {
  login: string | null;
  confirmedEmail: string | null;
}

/** The viewer's own attempts in `orgSlug` that started at or after `since`. */
export async function getOwnAgentSessions(
  orgSlug: string,
  viewer: OwnSessionViewer,
  since: Date,
): Promise<OwnSessionRow[]> {
  // GitHub logins and email addresses are case-insensitive while the exporter's key is stored as sent.
  // Two exact spellings of each cover the common cases; a key stored in any other casing is missed,
  // which under-counts the viewer's own habit rather than risking a match on someone else.
  const keys = ownSessionKeys(viewer.login, viewer.confirmedEmail);
  if (keys.length === 0 || !isDbConfigured()) return [];
  const org = await getOrgBySlug(orgSlug);
  if (!org) return [];
  return getPrisma().agentSession.findMany({
    where: { orgId: org.id, userKey: { in: keys }, startedAt: { gte: since } },
    select: { userKey: true, startedAt: true },
  });
}
