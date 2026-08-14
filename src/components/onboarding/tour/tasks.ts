// The drawer's CONTENT model (W6c) — pure, so the whole posture/ordering/spotlight decision is
// testable without a DOM.
//
// Ascent runs ONE guidance channel. The right-edge drawer used to hold a fixed six-step teach arc;
// it now holds the server-derived onboarding tasks (`GET /api/org/getting-started`), whose doneness
// is DERIVED from the org's real data on every poll — do the work through any door and the row ticks.
// The teach steps didn't die: a task borrows one as its "Show me" spotlight, and the ones no task
// claims stay reachable as the teaching rail once setup is stamped or complete.
//
// Nothing here imports a value from `@/lib/org/getting-started` — that module reaches into the DB
// layer, and a value import would drag the server graph into the client bundle. Types only (erased).

import type { GettingStartedPhase, GettingStartedStep, GettingStartedStepId } from "@/lib/org/getting-started";
import { ORG_TOUR_STEPS, TEACH_BY_ID } from "./steps";
import type { TourStep } from "./types";

/** The `GET /api/org/getting-started` payload, as the client sees it (dates are ISO strings). */
export interface GettingStartedPayload {
  steps: GettingStartedStep[];
  allDone: boolean;
  personal: boolean;
  /** The CALLER's own stamp — null when they have no membership row (auth-off, or a non-member). */
  onboarding: { completedAt: string | null; skippedAt: string | null; dismissed: boolean } | null;
}

export const PHASE_LABEL: Record<GettingStartedPhase, string> = {
  baseline: "Baseline",
  resolve: "Resolve",
  registry: "Registry",
  loop: "Loop",
  team: "Team",
  program: "Programme",
};

interface TaskCopy {
  title: string;
  body: string;
  /** Label of the row's primary action — the deep link into the tab that hosts the work. */
  cta: string;
  /** Why an unavailable row is unavailable. Honest, and specific to the reason the model gives. */
  unavailable: string;
  /** Teach step whose copy this task's spotlight borrows once the task is DONE (or always). */
  teach?: string;
  /** Teach step used while the task is UNDONE — its ANCHOR too, when the doneness anchor can only
   *  exist after the work (you cannot spotlight the results grid before the first scan). */
  beforeTeach?: string;
}

/**
 * Per-task copy + spotlight mapping. Only two tasks have an honest teach-step partner; the rest
 * spotlight the control the server's own anchor names (`GETTING_STARTED_ANCHORS`, stamped onto the
 * real controls in W6c) and carry their own copy. Inventing a mapping for the other four would put
 * dashboard-teaching prose on a setup task — exactly the two-channel muddle this lane removed.
 */
export const TASK_COPY: Record<GettingStartedStepId, TaskCopy> = {
  "first-scan": {
    title: "Run your first scan",
    body: "A scan is the baseline everything else reads from: it places each repo on the L1–L5 ladder with the evidence behind the score.",
    cta: "Open the fleet",
    unavailable: "Not available on this workspace.",
    // Before the first scan the results grid does not exist, so point at the control that MAKES it.
    beforeTeach: "scope-scan",
    teach: "results-view",
  },
  "gap-engaged": {
    title: "Resolve one gap",
    body: "Pick a single recommendation and act on it: assign it, close it, or open the apply-PR. One resolved gap is the whole loop in miniature.",
    cta: "Open the backlog",
    unavailable: "Needs member access. Ask an owner to raise your role.",
  },
  registry: {
    title: "Make the fix repeatable",
    body: "Write the fix down once, as a skill or a memory entry, and the next agent starts from it instead of rediscovering it.",
    cta: "Open the registry",
    unavailable: "Needs member access. Ask an owner to raise your role.",
  },
  loop: {
    title: "Instrument the loop",
    body: "Two of three keeps the fleet honest without anyone remembering to look: a rescan schedule, an alerts webhook, a published AI stance.",
    cta: "Open the fleet",
    unavailable: "Fleet instrumentation is an org-with-admin surface.",
    teach: "scope-fleet",
  },
  team: {
    title: "Bring the team in",
    body: "Maturity is an org property. Invite the people who will act on it: one more member is enough to make this a shared read.",
    cta: "Open members",
    unavailable: "Invites are owner-only.",
  },
  program: {
    title: "Name what you're doing",
    body: "Setup ends here; the work doesn't. Name the transition you're actually running, pick the rung you're climbing to, and today's standing is frozen as the baseline every later number is measured against.",
    cta: "Open the plan",
    unavailable: "A programme runs over a fleet (org workspaces only).",
  },
};

/** One row in the drawer. `task` rows come from the server; `teach` rows are the leftover library. */
export interface DrawerItem {
  /** Engine step id — namespaced so a task and a teach step can never collide. */
  key: string;
  kind: "task" | "teach";
  taskId?: GettingStartedStepId;
  title: string;
  body: string;
  cta: string;
  done: boolean;
  available: boolean;
  unavailableReason?: string;
  phaseLabel?: string;
  detail?: string;
  /** What the engine navigates to + spotlights for this row. */
  tour: TourStep;
}

/** Teach steps a task borrows — everything else stays available as the teaching rail. */
const CLAIMED_TEACH: ReadonlySet<string> = new Set(
  Object.values(TASK_COPY).flatMap((c) => [c.teach, c.beforeTeach].filter((v): v is string => Boolean(v))),
);

function taskItem(step: GettingStartedStep): DrawerItem {
  const copy = TASK_COPY[step.id];
  // Spotlight resolution: the server's anchor names the control whose STATE proves the step, which is
  // the right target once the work is possible. While the task is undone a `beforeTeach` step may
  // override BOTH anchor and copy, because some proof-anchors only exist after the fact.
  const teach = TEACH_BY_ID.get((!step.done && copy.beforeTeach) || copy.teach || "");
  const useTeachAnchor = !step.done && Boolean(copy.beforeTeach);
  return {
    key: `task:${step.id}`,
    kind: "task",
    taskId: step.id,
    title: copy.title,
    body: copy.body,
    cta: copy.cta,
    done: step.done,
    available: step.available,
    unavailableReason: step.available ? undefined : copy.unavailable,
    phaseLabel: PHASE_LABEL[step.phase],
    detail: step.detail,
    tour: {
      id: `task:${step.id}`,
      tab: step.tab,
      anchor: useTeachAnchor && teach ? teach.anchor : step.anchor,
      kicker: PHASE_LABEL[step.phase],
      title: teach?.title ?? copy.title,
      body: teach?.body ?? copy.body,
    },
  };
}

function teachItem(step: TourStep): DrawerItem {
  return {
    key: `teach:${step.id}`,
    kind: "teach",
    title: step.title,
    body: step.body,
    cta: "Show me",
    done: false,
    available: true,
    tour: { ...step, id: `teach:${step.id}` },
  };
}

/**
 * The drawer's rows. Tasks first (server order = the onboarding narrative), then — only in the
 * teaching posture — the unclaimed teach steps. The array identity must be stable across renders for
 * the engine's anchor poll not to restart, so callers memoize on the payload.
 */
export function buildDrawerItems(
  payload: GettingStartedPayload | null,
  { includeTeach }: { includeTeach: boolean },
): DrawerItem[] {
  const tasks = (payload?.steps ?? []).map(taskItem);
  const teach = includeTeach ? ORG_TOUR_STEPS.filter((s) => !CLAIMED_TEACH.has(s.id)).map(teachItem) : [];
  return [...tasks, ...teach];
}

/** done/total over AVAILABLE tasks only — an unavailable step must never make progress unreachable. */
export function taskProgress(items: DrawerItem[]): { done: number; total: number } {
  const tasks = items.filter((i) => i.kind === "task" && i.available);
  return { done: tasks.filter((i) => i.done).length, total: tasks.length };
}

/** The one task the companion promotes: first available, not-yet-done, in narrative order. */
export function nextTask(items: DrawerItem[]): DrawerItem | null {
  return items.find((i) => i.kind === "task" && i.available && !i.done) ?? null;
}

/**
 * Two postures, one channel:
 *  - `companion` — a member of this org whose onboarding is UNSTAMPED and unfinished. The drawer opens
 *    itself, promotes one next task, and offers "Skip setup".
 *  - `teaching`  — everyone else: stamped (completed or skipped), already `allDone`, the demo org, or
 *    anyone with no membership row (`onboarding: null` — a non-member, or an auth-off box). Today's
 *    behaviour exactly: a collapsed, discoverable pull tab over the teach rail.
 */
export type DrawerPosture = "companion" | "teaching";

export function decidePosture(
  payload: GettingStartedPayload | null,
  { isDemoOrg }: { isDemoOrg: boolean },
): DrawerPosture {
  if (!payload || isDemoOrg) return "teaching";
  const stamp = payload.onboarding;
  // No membership row ⇒ no stamp to write and no onboarding to own. Never auto-open.
  if (!stamp || stamp.dismissed) return "teaching";
  if (payload.allDone) return "teaching";
  const items = buildDrawerItems(payload, { includeTeach: false });
  return nextTask(items) ? "companion" : "teaching";
}

/**
 * Should the completion stamp be written? True exactly once per member+org: they own a membership
 * row, nothing is stamped yet, and every available step is done. Idempotence beyond this predicate is
 * the caller's one-shot ref — the POST itself is a fire-and-forget that must never block the UI.
 */
export function shouldStampCompleted(payload: GettingStartedPayload | null): boolean {
  return Boolean(payload?.allDone && payload.onboarding && !payload.onboarding.dismissed);
}
