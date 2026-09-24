// The ONE per-person read of `AgentSession`: the signed-in viewer's own attempts, for their private
// session shape on the Developer home (backlog develop-2026-09-17 row 27).
//
// Everything else over this table rolls up at repo x period and never by person (`agent-sessions.ts`).
// This read is the exception, and it is fenced four ways:
//   - the key is the viewer's own login, which the CALLER resolves server-side; there is no variant
//     that takes a list of keys or no key at all;
//   - the match is EXACT (`in` over the login and its lower-cased form), never `contains` or an
//     insensitive mode, so no wildcard or partial key can widen it onto another person;
//   - it selects `userKey` and `startedAt` only: no session id, repo, cost or token count leaves the
//     database through it (the table stores no transcript or prompt at all);
//   - a blank key, no database or an unknown org returns [] before any query.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgBySlug } from "@/lib/db/org-shared";
import type { OwnSessionRow } from "@/lib/org/care-session-telemetry";

/** The viewer's own attempts in `orgSlug` that started at or after `since`. */
export async function getOwnAgentSessions(orgSlug: string, viewerLogin: string, since: Date): Promise<OwnSessionRow[]> {
  const key = viewerLogin.trim();
  if (!key || !isDbConfigured()) return [];
  const org = await getOrgBySlug(orgSlug);
  if (!org) return [];
  // GitHub logins are case-insensitive while the exporter's key is stored as sent. Two exact spellings
  // cover the common cases; a key stored in any other casing is missed, which under-counts the
  // viewer's own habit rather than risking a match on someone else.
  const keys = [...new Set([key, key.toLowerCase()])];
  return getPrisma().agentSession.findMany({
    where: { orgId: org.id, userKey: { in: keys }, startedAt: { gte: since } },
    select: { userKey: true, startedAt: true },
  });
}
