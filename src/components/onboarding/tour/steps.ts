import type { TourStep } from "./types";

/**
 * The TEACH library: six spotlight moments that explain the dashboard itself.
 *
 * These used to BE the drawer's content model — a fixed six-step arc every org walked regardless of
 * what it had actually set up. W6c demoted them to what they always were underneath: reusable
 * spotlight copy. The drawer's content is now the server-derived onboarding tasks
 * (`GET /api/org/getting-started`); a task borrows a teach step's copy (and, before the task is done,
 * sometimes its anchor) via `TASK_COPY` in `tasks.ts`, and the teach steps no task claims stay
 * reachable as the "Learn the dashboard" rail in the drawer's teaching posture.
 *
 * Steps are slug-independent: the engine resolves each `tab` against the active org and highlights the
 * `data-tour` anchor. The engine skips a step whose anchor never mounts, so this list is allowed to
 * over-reach on a thin org:
 *   - `modules-nav`  → org/[slug]/layout.tsx (the module rail). ALWAYS present, on every tab.
 *   - `scan-scope`   → OrgShellActions, but ONLY for non-personal orgs (a personal workspace has no
 *                      fleet scan button) — skipped on /org/<personal>.
 *   - `results-view` / `results-controls` → the Overview tab, rendered only once the fleet rollup has
 *                      data for the active window; a brand-new org short-circuits to OrgEmpty, and a
 *                      personal workspace renders PersonalOverview instead — both skip these two.
 */
export const ORG_TOUR_STEPS: TourStep[] = [
  {
    id: "scope-scan",
    tab: "overview",
    anchor: "scan-scope",
    kicker: "Scope · 1",
    title: "Set your scan scope",
    body: "Every dashboard starts with a scan. “Scan all watched” runs the whole fleet; the scope controls that decide what gets scored live sit right here.",
  },
  {
    id: "scope-fleet",
    tab: "repositories",
    anchor: "modules-nav",
    kicker: "Scope · 2",
    title: "Choose what’s in scope",
    body: "The Repositories tab is your fleet. Watching a repo adds it to the scan scope — the rollup you’ll read next is built only from watched repos.",
  },
  {
    id: "results-view",
    tab: "overview",
    anchor: "results-view",
    kicker: "Results · 1",
    title: "Read the fleet",
    body: "When scans complete, this is the read: every watched repo across time, each placed on the L1–L5 ladder with its movement. It’s the one surface that answers “where does the org stand?”.",
  },
  {
    id: "results-controls",
    tab: "overview",
    anchor: "results-controls",
    kicker: "Results · 2",
    title: "Scope what you read",
    body: "Different from scan scope — these narrow the VIEW. Pick a time window, a segment, or a tech stack and every number, delta, and trajectory re-scopes to match.",
  },
  {
    id: "modules-nav",
    tab: "overview",
    anchor: "modules-nav",
    kicker: "Modules · 1",
    title: "Each module is a lens",
    body: "The rail groups the deep-dives: Fleet, Intelligence (Security, Adoption, Delivery), Plan, and Govern. Pick a group to reveal its modules — same fleet, one facet at a time.",
  },
  {
    id: "modules-briefing",
    tab: "executive",
    anchor: "modules-nav",
    kicker: "Modules · 2",
    title: "Open a module",
    body: "This is the Briefing module — a narrated read of the fleet. That’s the tour: set scope, read the headline, then open any module from this rail to go deep.",
  },
];

/** Teach step by id — the lookup `tasks.ts` uses to borrow spotlight copy. */
export const TEACH_BY_ID: ReadonlyMap<string, TourStep> = new Map(ORG_TOUR_STEPS.map((s) => [s.id, s]));
