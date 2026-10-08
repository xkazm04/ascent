// The ONE decision of how far back a history read may reach (Trends, /api/history JSON + CSV, Compare).
//
// /pricing sells a history window per plan (plans.ts retentionDays). The org reads and the personal
// overview already clamp to retentionCutoff(plan); the per-repo history surfaces did not, so a Free
// viewer saw 30 days on the overview and the whole corpus one click away. Every one of those reads now
// asks THIS function and passes the answer as `since`.
//
// The rule, in order:
//   a. A read under a TENANT org (anything but the shared public org) gets that org's plan window.
//   b. A read under the PUBLIC org by a signed-in viewer who has a PERSONAL workspace gets that
//      workspace's plan window: the same plan personal.ts reads, so the overview and its Trends /
//      Compare links show one window.
//   c. Anyone else (signed out, or no personal workspace) is NOT clamped. This branch is the App
//      Master's pending decision: change it here and nowhere else.
//   d. Self-host: retentionCutoff is already null, so every branch above answers "no window".

import { dbReadStrict, isDbConfigured } from "@/lib/db/client";
import { getOrgBySlug } from "@/lib/db/org-shared";
import { normalizeLogin } from "@/lib/db/members";
import { PUBLIC_ORG } from "@/lib/org-constants";
import { planFeatures, retentionCutoff } from "@/lib/plans";

export interface HistoryWindow {
  /** Earliest scan date the read may include; null = no floor. Pass straight through as `since`. */
  since: Date | null;
  /** The window length in days, null when unclamped. */
  days: number | null;
  /** Customer-facing plan name the window comes from, null when unclamped. */
  planLabel: string | null;
}

export const NO_HISTORY_WINDOW: HistoryWindow = { since: null, days: null, planLabel: null };

function windowFor(plan: string | null | undefined, nowMs: number): HistoryWindow {
  const since = retentionCutoff(plan, nowMs);
  if (!since) return NO_HISTORY_WINDOW;
  const f = planFeatures(plan);
  return { since, days: f.retentionDays, planLabel: f.label };
}

/** `orgSlug` is what readableOrgForOwner resolved; `viewerLogin` the signed-in login, if any. */
export async function resolveHistoryWindow(
  orgSlug: string,
  viewerLogin: string | null | undefined,
  nowMs: number = Date.now(),
): Promise<HistoryWindow> {
  if (!isDbConfigured()) return NO_HISTORY_WINDOW;
  // STRICT, like the history read it precedes: an unreachable database surfaces as DbUnavailableError
  // (the pages' honest "unavailable" notice, the route's 500), never as a silently unclamped read.
  return dbReadStrict(() => decide(orgSlug, viewerLogin, nowMs));
}

async function decide(orgSlug: string, viewerLogin: string | null | undefined, nowMs: number): Promise<HistoryWindow> {
  const slug = orgSlug.trim().toLowerCase();
  if (slug !== PUBLIC_ORG) {
    const org = await getOrgBySlug(slug);
    return org ? windowFor(org.plan, nowMs) : NO_HISTORY_WINDOW; // a: the tenant's own plan
  }
  if (!viewerLogin) return NO_HISTORY_WINDOW; // c: signed out
  const personal = await getOrgBySlug(normalizeLogin(viewerLogin));
  if (personal?.kind !== "personal") return NO_HISTORY_WINDOW; // c: no personal workspace
  return windowFor(personal.plan, nowMs); // b
}

/** The one line a clamped page shows, or null when nothing is clamped. */
export function historyWindowNote(w: HistoryWindow): string | null {
  if (!w.since || w.days == null) return null;
  return `Showing the last ${w.days} days: the ${w.planLabel} plan's history window.`;
}

/** Shown instead of "No scans recorded yet" when the window hides every scan that exists. */
export function historyOutsideWindowNote(w: HistoryWindow, repo: string): string {
  return `${repo} has scans, but all of them are older than the last ${w.days} days, the ${w.planLabel} plan's history window.`;
}
