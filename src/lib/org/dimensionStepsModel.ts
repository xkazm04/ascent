// The heatmap drill-in's "next steps", as a decision point rather than a read-out.
//
// Pure (no React, no db): the repo-dimension route builds `steps` with `buildSteps`, and the modal's
// RepoDimensionNextSteps orders them, asks which verdicts a step offers, builds the PATCH body each
// verdict sends to the existing PATCH /api/recommendations/:id, and lands the result.
//
// Two rules from the triage-queues standard (verdict write-back) shape it:
// - a control is not offered when there is no route for it: an untracked step (no persisted row), the
//   shared public org (the PATCH route 403s it) and a viewer without write access get NO actions;
// - every verdict either writes or throws, never nothing: a failed PATCH leaves the step exactly as
//   it was and yields a RowError, never an optimistic removal the next refresh resurrects.

import type { DimensionId, Effort, Impact, LlmRoadmapItem, PersistedRecommendation, RecStatus } from "@/lib/types";
import { PUBLIC_ORG } from "@/lib/org-constants";

/** One dimension step as the drill-in renders it. `id` is null on an untracked (roadmap-only) step. */
export interface DimensionStep {
  id: string | null;
  title: string;
  dimension: DimensionId;
  impact: Impact;
  effort: Effort;
  rationale: string;
  explore: string[];
  levelUnlock?: string;
  status: RecStatus;
  assigneeLogin: string | null;
  targetDate: string | null;
  projectedPoints: number | null;
  /** True when the step is a persisted recommendation the PATCH route can write to. */
  tracked: boolean;
}

export type StepAction = "start" | "done" | "dismiss" | "reopen";

export const ACTION_LABEL: Record<StepAction, string> = {
  start: "Start",
  done: "Done",
  dismiss: "Dismiss",
  reopen: "Reopen",
};

/** A persisted recommendation as a tracked step. */
export function stepFromRec(r: PersistedRecommendation): DimensionStep {
  return {
    id: r.id,
    title: r.title,
    dimension: r.dimension,
    impact: r.impact,
    effort: r.effort,
    rationale: r.rationale,
    explore: r.explore ?? [],
    ...(r.levelUnlock ? { levelUnlock: r.levelUnlock } : {}),
    status: r.status,
    assigneeLogin: r.assigneeLogin ?? null,
    targetDate: r.targetDate ?? null,
    projectedPoints: r.projectedPoints ?? null,
    tracked: true,
  };
}

/** A roadmap item with no persisted row: shown as open, but nothing can be written to it. */
export function stepFromRoadmap(r: LlmRoadmapItem): DimensionStep {
  return {
    id: null,
    title: r.title,
    dimension: r.dimension,
    impact: r.impact,
    effort: r.effort,
    rationale: r.rationale,
    explore: r.explore ?? [],
    ...(r.levelUnlock ? { levelUnlock: r.levelUnlock } : {}),
    status: "open",
    assigneeLogin: null,
    targetDate: null,
    projectedPoints: null,
    tracked: false,
  };
}

/** The cell's steps: the persisted recs when the tracking read answered, else the bare roadmap. */
export function buildSteps(
  dim: string,
  recs: PersistedRecommendation[] | null,
  roadmap: LlmRoadmapItem[],
): DimensionStep[] {
  if (recs) return recs.filter((r) => r.dimension === dim).map(stepFromRec);
  return roadmap.filter((r) => r.dimension === dim).map(stepFromRoadmap);
}

const ACTIVE_ORDER: Record<RecStatus, number> = { open: 0, in_progress: 1, done: 2, dismissed: 3 };

export function isClosedStep(s: Pick<DimensionStep, "status">): boolean {
  return s.status === "done" || s.status === "dismissed";
}

export interface OrderedSteps {
  /** open first, then in_progress (stable within each). */
  active: DimensionStep[];
  /** done and dismissed, folded behind a count. */
  closed: DimensionStep[];
  openCount: number;
  closedCount: number;
  doneCount: number;
  dismissedCount: number;
}

export function orderSteps(steps: DimensionStep[]): OrderedSteps {
  const active = steps
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => !isClosedStep(s))
    .sort((a, b) => ACTIVE_ORDER[a.s.status] - ACTIVE_ORDER[b.s.status] || a.i - b.i)
    .map(({ s }) => s);
  const closed = steps.filter(isClosedStep);
  return {
    active,
    closed,
    openCount: steps.filter((s) => s.status === "open").length,
    closedCount: closed.length,
    doneCount: closed.filter((s) => s.status === "done").length,
    dismissedCount: closed.filter((s) => s.status === "dismissed").length,
  };
}

/** Which verdicts a step offers. Empty whenever there is no route that would accept the write. */
export function actionsFor(step: DimensionStep, ctx: { org: string; canAct: boolean }): StepAction[] {
  if (!ctx.canAct || !step.tracked || !step.id) return [];
  if (ctx.org.trim().toLowerCase() === PUBLIC_ORG) return [];
  switch (step.status) {
    case "open":
      return ["start", "done", "dismiss"];
    case "in_progress":
      return ["done", "dismiss"];
    default:
      return ["reopen"];
  }
}

export interface StepPatch {
  status: RecStatus;
  assigneeLogin?: string;
  note?: string;
}

/** The PATCH body a verdict sends. Start claims an UNOWNED step for the viewer, never steals one. */
export function patchFor(
  action: StepAction,
  step: Pick<DimensionStep, "assigneeLogin">,
  opts: { viewerLogin?: string | null; reason?: string } = {},
): StepPatch {
  switch (action) {
    case "start":
      return !step.assigneeLogin && opts.viewerLogin
        ? { status: "in_progress", assigneeLogin: opts.viewerLogin }
        : { status: "in_progress" };
    case "done":
      return { status: "done" };
    case "dismiss": {
      const note = opts.reason?.trim();
      return note ? { status: "dismissed", note } : { status: "dismissed" };
    }
    case "reopen":
      return { status: "open" };
  }
}

export interface RowError {
  status: number;
  message: string;
}

export type PatchOutcome =
  | { ok: true; rec: PersistedRecommendation }
  | { ok: false; status: number; error?: string };

export interface ApplyResult {
  steps: DimensionStep[];
  openCount: number;
  error?: RowError;
}

function failureMessage(status: number, error?: string): string {
  if (error) return error;
  if (status === 403) return "You can't change this recommendation here.";
  if (status === 409) return "This recommendation changed since you loaded it. Refresh and try again.";
  if (status === 0) return "Network error. Nothing was saved.";
  return `Couldn't save (${status}). Nothing was changed.`;
}

/** Land a PATCH outcome: a success replaces the step in place, a failure changes nothing. */
export function applyResult(steps: DimensionStep[], id: string, outcome: PatchOutcome): ApplyResult {
  if (!outcome.ok) {
    return {
      steps,
      openCount: orderSteps(steps).openCount,
      error: { status: outcome.status, message: failureMessage(outcome.status, outcome.error) },
    };
  }
  const next = steps.map((s) => (s.id === id ? stepFromRec(outcome.rec) : s));
  return { steps: next, openCount: orderSteps(next).openCount };
}
