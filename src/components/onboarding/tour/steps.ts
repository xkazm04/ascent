import type { TourStep } from "./types";

/**
 * A limited-scope demo tour for the curated org dashboard — enough to establish the UX across the three
 * learning goals (scope → read results → explore modules), NOT the full journey. Steps are slug-
 * independent: the engine resolves each `page` against the active org and highlights the `data-tour`
 * anchor. Cross-page steps (Repositories, Briefing) exist to demonstrate that the tour can redirect and
 * re-anchor on the destination page.
 */
export const DEMO_TOUR_STEPS: TourStep[] = [
  {
    id: "scope-scan",
    chapter: "scope",
    page: "",
    anchor: "scan-scope",
    kicker: "Scope · 1",
    title: "Set your scan scope",
    body: "Every dashboard starts with a scan. “Scan all watched” runs the whole fleet; the scope controls that decide what gets scored live sit right here.",
  },
  {
    id: "scope-fleet",
    chapter: "scope",
    page: "repositories",
    anchor: "modules-nav",
    kicker: "Scope · 2",
    title: "Choose what’s in scope",
    body: "The Repositories tab is your fleet. Watching a repo adds it to the scan scope — the rollup you’ll read next is built only from watched repos.",
  },
  {
    id: "results-view",
    chapter: "results",
    page: "",
    anchor: "results-view",
    kicker: "Results · 1",
    title: "Read the fleet",
    body: "When scans complete, this is the read: every watched repo across time, each placed on the L1–L5 ladder with its movement. It’s the one surface that answers “where does the org stand?”.",
  },
  {
    id: "results-controls",
    chapter: "results",
    page: "",
    anchor: "results-controls",
    kicker: "Results · 2",
    title: "Scope what you read",
    body: "Different from scan scope — these narrow the VIEW. Pick a time window, a segment, or a tech stack and every number, delta, and trajectory re-scopes to match.",
  },
  {
    id: "modules-nav",
    chapter: "modules",
    page: "",
    anchor: "modules-nav",
    kicker: "Modules · 1",
    title: "Each module is a lens",
    body: "The rail groups the deep-dives: Fleet, Intelligence (Security, Adoption, Delivery), Plan, and Govern. Same fleet — one facet at a time.",
  },
  {
    id: "modules-briefing",
    chapter: "modules",
    page: "executive",
    anchor: "modules-nav",
    kicker: "Modules · 2",
    title: "Open a module",
    body: "This is the Briefing module — a narrated read of the fleet. That’s the tour: set scope, read the headline, then open any module from this rail to go deep.",
  },
];
