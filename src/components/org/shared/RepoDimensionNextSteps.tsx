"use client";

// The heatmap drill-in's "Next steps", extracted from RepoDimensionModal and made a decision point.
// Each step carries its tracked status; an open or in-progress step offers Start / Done / Dismiss, a
// closed one offers Reopen, and every verdict goes through the existing PATCH
// /api/recommendations/:id (which resolves the row's org and gates it). The rules live in the pure
// dimensionStepsModel: no control is offered where no write would be accepted (untracked, public org,
// read-only viewer), and a failed write changes nothing and says why, never an optimistic removal.

import { useRef, useState, type ReactNode } from "react";
import type { PersistedRecommendation } from "@/lib/types";
import {
  ACTION_LABEL,
  actionsFor,
  applyResult,
  orderSteps,
  patchFor,
  type DimensionStep,
  type PatchOutcome,
  type RowError,
  type StepAction,
} from "@/lib/org/dimensionStepsModel";
import { DismissReasonPrompt, RowSpinner } from "@/components/report/recommendationRowUi";
import { MarkdownLite } from "@/components/report/MarkdownLite";
import { STATUS_ACCENT, STATUS_LABEL } from "@/components/org/shared/backlogShared";
import { EFFORT_CLASS, IMPACT_CLASS } from "@/lib/ui";

/** Below this the dimension is not yet "green" (L4 starts at 65) and a follow-up is owed. Mirrors
 *  the engine's guarantee (buildDimensionFollowUps); named here so the empty-state copy can be honest
 *  about WHY there is nothing to do rather than saying "not a gap" about a 60. */
const FOLLOW_UP_BELOW = 65;

async function sendPatch(id: string, body: object): Promise<PatchOutcome> {
  try {
    const r = await fetch(`/api/recommendations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = (await r.json().catch(() => null)) as (PersistedRecommendation & { error?: string }) | null;
    if (r.ok && d) return { ok: true, rec: d };
    return { ok: false, status: r.status, ...(d?.error ? { error: d.error } : {}) };
  } catch {
    // A network failure: status 0 is rendered as "Network error. Nothing was saved."
    return { ok: false, status: 0 };
  }
}

/** One step: title, status, owner, due date, impact/effort chips, rationale, explore prompts. */
function DimensionStepCard({ step: r, children }: { step: DimensionStep; children?: ReactNode }) {
  return (
    <li className="rounded-lg border border-divider bg-surface/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-white">{r.title}</span>
        {r.tracked && (
          <span
            className="rounded border px-1.5 py-0.5 type-caption text-slate-200"
            style={{ borderColor: STATUS_ACCENT[r.status] }}
          >
            {STATUS_LABEL[r.status]}
          </span>
        )}
        <span className={`rounded border px-1.5 py-0.5 type-caption ${IMPACT_CLASS[r.impact] ?? "border-slate-700 text-slate-400"}`}>
          impact {r.impact}
        </span>
        <span className={`rounded border px-1.5 py-0.5 type-caption ${EFFORT_CLASS[r.effort] ?? "border-slate-700 text-slate-400"}`}>
          effort {r.effort}
        </span>
        {r.levelUnlock && (
          <span className="rounded border border-slate-700 px-1.5 py-0.5 type-caption text-slate-400">{r.levelUnlock}</span>
        )}
      </div>
      {(r.assigneeLogin || r.targetDate || r.projectedPoints != null) && (
        <p className="mt-1 type-mono-sm text-slate-500">
          {[
            r.assigneeLogin ? `owner @${r.assigneeLogin}` : "",
            r.targetDate ? `due ${r.targetDate}` : "",
            r.projectedPoints != null ? `+${r.projectedPoints} pts if closed` : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      {r.rationale && <MarkdownLite text={r.rationale} className="mt-1.5 type-body-sm text-slate-300" />}
      {r.explore.length > 0 && (
        <ul className="mt-2 space-y-1 type-body-sm text-slate-400">
          {r.explore.map((q, j) => (
            <li key={j} className="flex gap-2">
              <span className="select-none text-slate-600">→</span>
              <span>{q}</span>
            </li>
          ))}
        </ul>
      )}
      {children}
    </li>
  );
}

function closedSummary(doneCount: number, dismissedCount: number): string {
  const parts = [doneCount ? `${doneCount} done` : "", dismissedCount ? `${dismissedCount} dismissed` : ""];
  return `${parts.filter(Boolean).join(", ")}, none open`;
}

export function RepoDimensionNextSteps({
  org,
  steps: initial,
  score,
  tracked,
  trackingError,
  canAct,
  viewerLogin,
}: {
  org: string;
  steps: DimensionStep[];
  score: number;
  tracked: boolean;
  trackingError?: boolean;
  canAct: boolean;
  viewerLogin?: string | null;
}) {
  const [steps, setSteps] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, RowError>>({});
  const [promptId, setPromptId] = useState<string | null>(null);
  // Synchronous in-flight guard: a double-press in the same tick sees this before any re-render.
  const inFlight = useRef(new Set<string>());

  const run = async (s: DimensionStep, action: StepAction, reason?: string) => {
    const id = s.id;
    if (!id || inFlight.current.has(id)) return;
    inFlight.current.add(id);
    setBusyId(id);
    setPromptId(null);
    const outcome = await sendPatch(id, patchFor(action, s, { viewerLogin, reason }));
    // applyResult against the latest state: a success replaces the step in place, a failure keeps it.
    // The RowError depends only on the outcome, so it is read off the same pure call.
    const error = applyResult(steps, id, outcome).error;
    setSteps((cur) => applyResult(cur, id, outcome).steps);
    setErrors((e) => {
      const next = { ...e };
      if (error) next[id] = error;
      else delete next[id];
      return next;
    });
    inFlight.current.delete(id);
    setBusyId(null);
  };

  const ordered = orderSteps(steps);
  const ctx = { org, canAct };

  const renderStep = (s: DimensionStep, i: number) => {
    const actions = actionsFor(s, ctx);
    const key = s.id ?? `u${i}`;
    const busy = busyId !== null && busyId === s.id;
    return (
      <DimensionStepCard key={key} step={s}>
        {actions.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {actions.map((a) => (
              <button
                key={a}
                type="button"
                disabled={busy}
                aria-busy={busy}
                onClick={() => (a === "dismiss" ? setPromptId(s.id) : void run(s, a))}
                className="focus-ring rounded-md border border-slate-700 px-2 py-0.5 type-body-sm font-medium text-slate-200 transition hover:bg-slate-800 disabled:opacity-40"
              >
                {ACTION_LABEL[a]}
              </button>
            ))}
            {busy && <RowSpinner />}
          </div>
        )}
        {promptId !== null && promptId === s.id && (
          <DismissReasonPrompt onConfirm={(reason) => void run(s, "dismiss", reason)} onCancel={() => setPromptId(null)} />
        )}
        {s.id && errors[s.id] && (
          <p role="alert" className="mt-2 type-body-sm text-danger">
            {errors[s.id]!.message}
          </p>
        )}
      </DimensionStepCard>
    );
  };

  return (
    <div className="mt-5 border-t border-divider pt-4">
      <div className="type-body-sm font-semibold uppercase tracking-wide text-slate-500">Next steps</div>
      {trackingError && (
        <p className="mt-1 type-body-sm text-amber-300/90">
          Couldn&rsquo;t read this dimension&rsquo;s tracked status, so these are the scan&rsquo;s roadmap items and
          whether each is open, done or dismissed is unknown. Try again shortly.
        </p>
      )}
      {steps.length === 0 ? (
        // Two different silences. Above the line the dimension has genuinely earned "nothing owed";
        // below it a missing follow-up is a scan that predates the guarantee, and the honest copy
        // says so rather than certifying a 40 as "not a gap".
        !trackingError && (
          <p className="mt-1 type-body-sm text-slate-500">
            {score >= FOLLOW_UP_BELOW
              ? "No open recommendations: this dimension is in the green band, so nothing is owed here yet."
              : "No follow-up on record for this dimension. Scans now carry one for every dimension below the green band; re-scan to get it."}
          </p>
        )
      ) : (
        <>
          {ordered.active.length === 0 && (
            <p className="mt-1 type-body-sm text-slate-400">{closedSummary(ordered.doneCount, ordered.dismissedCount)}</p>
          )}
          {ordered.active.length > 0 && <ul className="mt-2 space-y-2.5">{ordered.active.map(renderStep)}</ul>}
          {ordered.closedCount > 0 && (
            <details className="mt-3" open={ordered.active.length === 0}>
              <summary className="focus-ring cursor-pointer type-body-sm text-slate-400">
                Closed ({ordered.closedCount})
              </summary>
              <ul className="mt-2 space-y-2.5">{ordered.closed.map(renderStep)}</ul>
            </details>
          )}
          {!tracked && !trackingError && steps.length > 0 && (
            <p className="mt-2 type-caption text-slate-500">Tracking is not available here, so these steps are read-only.</p>
          )}
        </>
      )}
    </div>
  );
}
