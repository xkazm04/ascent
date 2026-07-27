// Session persistence for the dashboard tour. The drawer used to be pure `useState`, so a hard refresh
// mid-tour (or any full page load — a billing return, an auth bounce) silently reset both the open/closed
// state and the step cursor: the user reopened the tab and was back on step 1 with no way to tell the tour
// had lost its place.
//
// Layered on the SAME mechanism the wizard already uses for its resume snapshot
// (`OnboardingFlow.model.ts`'s RESUME_KEY / sessionStorage, best-effort, never throwing): sessionStorage,
// not localStorage, because "where am I in the tour" is a property of this browsing session, not a
// permanent preference — a new tab starts clean.
//
// The key is PER-ORG: two org dashboards open in two tabs must not share a cursor (advancing the tour on
// acme would otherwise teleport the beta tab's tour to the same step on its next read).

export const TOUR_STORAGE_PREFIX = "ascent:tour:v1:";

export interface TourStorageState {
  /** Whether the drawer was open (vs collapsed to its pull tab). */
  open: boolean;
  /** Cursor into the step list. Clamped by the reader — a shorter step list must not strand the cursor. */
  index: number;
}

/** sessionStorage key for one org's tour state. Slug is lower-cased (the canonical org-row casing), so
 *  `/org/Vercel` and `/org/vercel` resolve to the same entry. */
export function tourStorageKey(slug: string): string {
  return `${TOUR_STORAGE_PREFIX}${slug.trim().toLowerCase()}`;
}

/** Read this org's saved tour state, or null when there's nothing valid stored. Never throws: storage can
 *  be unavailable (private mode / quota) and persistence is best-effort, exactly like the resume snapshot. */
export function readTourState(slug: string): TourStorageState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(tourStorageKey(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TourStorageState> | null;
    if (!parsed || typeof parsed !== "object") return null;
    const index = typeof parsed.index === "number" && Number.isFinite(parsed.index) ? Math.max(0, Math.floor(parsed.index)) : 0;
    return { open: parsed.open === true, index };
  } catch {
    return null;
  }
}

/** Persist this org's tour state. Best-effort — a storage failure must never break the drawer. */
export function writeTourState(slug: string, state: TourStorageState): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(tourStorageKey(slug), JSON.stringify(state));
  } catch {
    /* sessionStorage unavailable (private mode / quota) — tour resumability is best-effort */
  }
}
