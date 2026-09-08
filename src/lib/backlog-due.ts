// Backlog due-date bucketing windows — the business invariants behind the `this_week` / `this_month`
// due buckets. They live here in the lib layer (not in a component module) so the DATA PRODUCER that
// buckets items (`src/lib/db/org-insights.ts`) and any UI tile that summarizes the same buckets read
// one source, and the lib layer never has to reach UP into `@/components` for a rule it owns.
//
// No React, no server-only imports: client-safe, importable from both a "use client" component and a
// route/DB module.

/**
 * The single "due soon" window (in rolling days) behind the `this_week` due bucket, the "Due ≤ Nd"
 * summary tile, and its backend count — previously three independent literal 7s across two layers,
 * where changing one (e.g. to a sprint length) silently desynced the tile from the bucket it
 * summarizes (backlog-management 07-16 #4). Single-sourced here; the DB layer and UI both import it.
 */
export const DUE_SOON_DAYS = 7;

/**
 * The rolling-day cutoff behind the `this_month` due bucket. It is 31 ROLLING days, NOT a calendar
 * month — the enum key is historical. Single-sourced here so the bucket maths and the label that
 * states it ("Due within 31 days") can never drift apart again; the old "Due this month" label read
 * as calendar-aligned and mis-bucketed a Jul-29 vs Aug-1 pair on Jul 1. (G4-07)
 */
export const DUE_MONTH_DAYS = 31;
