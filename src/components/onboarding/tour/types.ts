// Shared model for the org-dashboard tour ENGINE. A tour step names the org tab it lives on and the
// on-page element it points at (by a `data-tour` id). The engine (useTourEngine) consumes only this
// shape — it is deliberately presentation-free, which is what let the drawer's CONTENT model be
// swapped (W6c: static teach steps → server-derived onboarding tasks) without touching the engine.
//
// W6c changed `page: string` (an org sub-PATH) to `tab: OrgTabId`. Every org surface now lives in the
// `?tab=` shell (docs/ORG-TABS-REFACTOR.md) and the old sub-paths are permanent `redirect()` stubs, so
// pushing a path made the engine compare a pathname that the redirect immediately rewrote — it could
// never settle "am I on this step's page?". Tabs are the real coordinate.

import type { OrgTabId } from "@/lib/org/orgTabs";

export interface TourStep {
  id: string;
  /** Org tab this step lives on. The engine deep-links here (`orgTabHref`) before anchoring; the org
   *  layout persists across a tab switch, so the tour survives the navigation and re-resolves. */
  tab: OrgTabId;
  /** `data-tour` id of the element to highlight, or null for a concept step with no on-page anchor. */
  anchor: string | null;
  /** Mono eyebrow (e.g. "Scope · 1"). */
  kicker: string;
  title: string;
  body: string;
}
