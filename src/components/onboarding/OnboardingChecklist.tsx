"use client";

// Activation checklist (Linear/Notion/Vercel pattern): always shows the next high-value
// action so onboarding becomes a habit, not a one-shot scan. Completion is derived from
// signals the app already has (an installation, repos picked, a scan run, a watch schedule)
// — pure orchestration, no new backend.

import Link from "next/link";

export interface ChecklistStep {
  label: string;
  done: boolean;
  href?: string;
  hint?: string;
}

export function OnboardingChecklist({ steps }: { steps: ChecklistStep[] }) {
  const doneCount = steps.filter((s) => s.done).length;
  const pct = steps.length ? Math.round((doneCount / steps.length) * 100) : 0;
  // The first not-yet-done step is the suggested "next" action.
  const nextIdx = steps.findIndex((s) => !s.done);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">Getting started</h2>
        <span className="font-mono text-sm uppercase tracking-widest text-slate-500">
          {doneCount}/{steps.length} done
        </span>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Onboarding progress"
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent to-emerald-500 transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>

      <ol className="mt-4 space-y-1.5">
        {steps.map((step, i) => {
          const isNext = i === nextIdx;
          const inner = (
            <div
              className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition ${
                step.done
                  ? "border-slate-800 bg-slate-950/40"
                  : isNext
                    ? "border-accent/40 bg-accent/[0.06]"
                    : "border-slate-800"
              }`}
            >
              <span
                aria-hidden
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-sm ${
                  step.done
                    ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                    : "border-slate-600 text-slate-500"
                }`}
              >
                {step.done ? "✓" : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <span className={`text-base ${step.done ? "text-slate-400 line-through decoration-slate-700" : "text-white"}`}>
                  {step.label}
                </span>
                {step.hint && !step.done && <p className="text-sm text-slate-500">{step.hint}</p>}
              </div>
              {isNext && !step.done && (
                <span className="rounded-full border border-accent/40 px-2 py-0.5 font-mono text-sm uppercase tracking-widest text-accent">
                  next
                </span>
              )}
              {step.href && !step.done && <span className="font-mono text-sm text-accent">→</span>}
            </div>
          );
          return (
            <li key={step.label}>
              {step.href && !step.done ? (
                <Link href={step.href} className="focus-ring block rounded-lg">
                  {inner}
                </Link>
              ) : (
                inner
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
