// Shared model for the demo-org onboarding tour. A tour is an ordered list of steps; each step names
// the org sub-page it lives on and the on-page element it points at (by a `data-tour` id). The three
// prototype variants (spotlight / checklist / briefing) all consume this same model + engine — they
// differ only in how a step is PRESENTED, not in what a step is.

export type TourChapter = "scope" | "results" | "modules";

export interface TourStep {
  id: string;
  chapter: TourChapter;
  /** Org sub-path this step lives on, relative to `/org/[slug]` ("" = the overview). The engine
   *  redirects here before anchoring; the org layout persists across sub-page nav, so the tour
   *  survives the redirect and re-resolves the anchor on the new page. */
  page: string;
  /** `data-tour` id of the element to highlight, or null for a concept step with no on-page anchor. */
  anchor: string | null;
  /** Mono eyebrow (e.g. "Scope · 1"). */
  kicker: string;
  title: string;
  body: string;
}

/** Human label per chapter — the checklist groups by these, the spotlight/briefing show them as tags. */
export const CHAPTER_LABEL: Record<TourChapter, string> = {
  scope: "Set the scope",
  results: "Read the results",
  modules: "Explore modules",
};

export const CHAPTER_ORDER: TourChapter[] = ["scope", "results", "modules"];
