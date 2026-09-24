// The signed-in developer's own care share (C3, backlog develop-2026-09-17 row 46): the one personal
// row `POST /api/me/mentor/share` writes and `getDeveloperView` reads back.
//
// Fenced the same way as the viewer's own AgentSession read (`agent-sessions-viewer.ts`):
//   - the ONLY key is the login the CALLER resolved server-side (`resolveViewerLogin`); there is no
//     variant that lists, searches or reads by anything else, and a blank login issues no query;
//   - the key is normalized (`normalizeLogin`) and matched exactly, never `contains` or insensitive;
//   - one row per login: a share is a snapshot, so a push REPLACES it and a delete removes it whole.
//     There is no history table and no soft delete, so "delete my share" leaves nothing behind;
//   - the stored JSON is re-validated on read: a row the contract no longer accepts reads as no share.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { normalizeLogin } from "@/lib/db/members";
import { validateCareShare, type CareSharePayload } from "@/lib/org/care-share-contract";

/** A stored share as it crosses the wire: `sharedAt` is an ISO string (see `wire-safe.ts`). */
export interface MentorShareRow {
  share: CareSharePayload;
  sharedAt: string;
}

const keyOf = (login: string | null | undefined) => (login ? normalizeLogin(login) : "");

/** The viewer's own share, or null (none stored, no database, blank login, or a row the contract refuses). */
export async function getMentorShare(login: string | null): Promise<MentorShareRow | null> {
  const key = keyOf(login);
  if (!key || !isDbConfigured()) return null;
  const row = await getPrisma().mentorShare.findUnique({ where: { login: key }, select: { payloadJson: true, sharedAt: true } });
  if (!row) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.payloadJson);
  } catch {
    return null;
  }
  const valid = validateCareShare(parsed);
  return valid.ok ? { share: valid.share, sharedAt: row.sharedAt.toISOString() } : null;
}

/** Replace the viewer's share with this validated snapshot. Null without a database or a login. */
export async function saveMentorShare(login: string, share: CareSharePayload, now: Date = new Date()): Promise<MentorShareRow | null> {
  const key = keyOf(login);
  if (!key || !isDbConfigured()) return null;
  const payloadJson = JSON.stringify(share);
  await getPrisma().mentorShare.upsert({
    where: { login: key },
    create: { login: key, payloadJson, sharedAt: now },
    update: { payloadJson, sharedAt: now },
  });
  return { share, sharedAt: now.toISOString() };
}

/** Delete the viewer's share. True when a row existed and is now gone. */
export async function deleteMentorShare(login: string): Promise<boolean> {
  const key = keyOf(login);
  if (!key || !isDbConfigured()) return false;
  const { count } = await getPrisma().mentorShare.deleteMany({ where: { login: key } });
  return count > 0;
}
