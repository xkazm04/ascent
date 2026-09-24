// The developer's OWN session shape, measured by ascent from the org's agent telemetry rather than
// shared by the mentor (backlog develop-2026-09-17 row 27).
//
// PRIVATE BY CONSTRUCTION. Four rules, each pinned in `care-session-telemetry.test.ts` and
// `developer-view-load.session-shape.test.ts`:
//   OWN ROWS ONLY  a row counts only when its `userKey` equals the signed-in viewer's login or an
//                  email the auth provider CONFIRMED for them (both case folded: operator decision
//                  2026-09-24, since Claude Code keys a session by `user.email`). Both are resolved
//                  server-side by the route (`resolveViewerIdentity`); nothing here takes an identity
//                  from a query or a body. A null key is never guessed onto anyone.
//   NO TRACE       another login's sessions produce exactly the view an unknown user gets: no
//                  present-but-empty object that would say "someone with sessions exists here".
//   COUNTS ONLY    the fold reads `userKey` and `startedAt` and emits one number. No session id,
//                  repo, transcript or prompt can reach the view, because none is read.
//   NEVER BANDED   the result lives on the viewer's own `DeveloperView` only. `getCareOrgAggregate`
//                  does not read it, so no org band and no Contributors row is built from it.
//
// SCOPE, and how it differs from the C3 share contract (`care-shape-contract.ts`). The OTLP export
// carries no launcher (`entrypoint`), so the interactive-only rule cannot be applied here: every
// session carrying the viewer's login counts. That is why the value is NEVER compared against a band
// (a band would compare it with interactive-only numbers) and why the row says so on hover.
//
// PURE module, no db import: the Developer render is a client component.

import { CARE_SHAPE_MIN_SESSIONS, CARE_SHAPE_WINDOW_DAYS, type CareFieldScope } from "./care-shape-contract";
import type { CareShapeField, DeveloperView } from "./developer-view";

/** The fields agent telemetry can measure. The other six need the mentor (turns, plan mode, ...). */
export const CARE_TELEMETRY_FIELDS: readonly CareShapeField[] = ["sessionsPerWeek"];

/** The written scope of each telemetry-measured field. Not the share contract's: see the header. */
export const CARE_TELEMETRY_SCOPE: Partial<Record<CareShapeField, CareFieldScope>> = {
  sessionsPerWeek: {
    numerator: "agent sessions whose telemetry carries your login or confirmed email, any launcher",
    denominator: "weeks in the window (days / 7)",
    unit: "per-week",
  },
};

/** One stored attempt, as the loader reads it: the key it was sent under and when it began. */
export interface OwnSessionRow {
  userKey: string | null;
  startedAt: Date;
}

const DAY_MS = 86_400_000;

/** The start of the window the shape is measured over. */
export function careTelemetryWindowStart(now: Date): Date {
  return new Date(now.getTime() - CARE_SHAPE_WINDOW_DAYS * DAY_MS);
}

const fold = (v: string | null | undefined) => v?.trim().toLowerCase() || null;

/**
 * True when a stored key is this viewer's own: equal, after case folding, to the login or to the
 * confirmed email. A null or blank key never matches, and without a login nothing does (an email alone
 * is not a signed-in viewer). Equality only: never a prefix, suffix or pattern.
 */
export function sessionKeyIsViewer(
  userKey: string | null,
  viewerLogin: string | null,
  confirmedEmail: string | null = null,
): boolean {
  const key = fold(userKey);
  const login = fold(viewerLogin);
  if (!key || !login) return false;
  return key === login || key === fold(confirmedEmail);
}

/**
 * The exact keys the reader asks the database for: the login and the confirmed email, each as resolved
 * and lower-cased, deduplicated. Empty without a login. A key stored in some third casing is missed
 * there, which under-counts the viewer's own habit rather than widening the match onto anyone else.
 */
export function ownSessionKeys(viewerLogin: string | null, confirmedEmail: string | null): string[] {
  const login = viewerLogin?.trim();
  if (!login) return [];
  const email = confirmedEmail?.trim();
  const spellings = [login, login.toLowerCase(), ...(email ? [email, email.toLowerCase()] : [])];
  return [...new Set(spellings)];
}

/**
 * Fold the viewer's own sessions (by login or confirmed email) into their view, in place. Re-checks every row's key even though the
 * reader already filtered on it: a reader bug must not be able to put someone else's count here.
 *
 * Leaves the view untouched when nobody is signed in or no own session falls in the window, so that
 * case is indistinguishable from a viewer ascent has never seen. A field the mentor shared wins.
 */
export function applyOwnSessionShape(
  view: DeveloperView,
  rows: readonly OwnSessionRow[],
  now: Date,
  confirmedEmail: string | null = null,
): void {
  if (!view.login) return;
  const from = careTelemetryWindowStart(now).getTime();
  const to = now.getTime();
  const sessions = rows.filter((r) => {
    const t = r.startedAt.getTime();
    return sessionKeyIsViewer(r.userKey, view.login, confirmedEmail) && t >= from && t <= to;
  }).length;
  if (sessions === 0) return;

  const fields = CARE_TELEMETRY_FIELDS.filter((f) => !view.sharedFields.includes(f));
  if (fields.length === 0) return;
  view.ownTelemetry = { source: "claude-code", sessions, fields };
  // Below the floor a rate describes a handful of sessions, not a habit: the field stays null and
  // `careShapeEmptyReason` names why ("few-own-sessions"), rather than printing a small number.
  if (sessions >= CARE_SHAPE_MIN_SESSIONS && fields.includes("sessionsPerWeek")) {
    view.shape.sessionsPerWeek = Math.round((sessions / (CARE_SHAPE_WINDOW_DAYS / 7)) * 10) / 10;
  }
}
