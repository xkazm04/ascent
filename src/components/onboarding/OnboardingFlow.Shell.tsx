"use client";

import type { ReactNode, RefObject } from "react";

// The onboarding page provides the site chrome + width; the flow just renders its phase. The shared
// flow-root polite live region announces step transitions (ONB a11y #1) for every phase change —
// the prior per-step live region only covered scanning, leaving pick↔select moves silent.

const STEP_LABELS = ["Choose a source", "Choose repositories", "Scan"] as const;

/**
 * G6-11: the sr-only `stepAnnounce` live region told a screen-reader user which step just loaded,
 * but nothing conveyed step POSITION visually or programmatically to a sighted mouse user or an
 * assistive-tech user tabbing around mid-step — only the transient announcement fired once, then
 * vanished. This small, always-visible stepper gives both: a visible 1-2-3 track plus
 * `aria-current="step"` on the active segment, so "where am I" is answerable at any time, not just
 * the instant the step changed.
 */
function Stepper({ step }: { step: 1 | 2 | 3 }) {
  return (
    <ol className="mb-4 flex items-center font-mono text-sm uppercase tracking-widest">
      {STEP_LABELS.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const isCurrent = n === step;
        const isDone = n < step;
        return (
          <li
            key={label}
            aria-current={isCurrent ? "step" : undefined}
            className={`flex items-center gap-1.5 ${
              isCurrent ? "text-white" : isDone ? "text-slate-400" : "text-slate-600"
            }`}
          >
            <span
              aria-hidden
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs normal-case tracking-normal ${
                isCurrent
                  ? "border-accent bg-accent/10 text-accent"
                  : isDone
                    ? "border-slate-600 bg-slate-800 text-slate-300"
                    : "border-slate-700"
              }`}
            >
              {isDone ? "✓" : n}
            </span>
            <span className="hidden sm:inline">{label}</span>
            {n < 3 && <span aria-hidden className="mx-2 h-px w-4 bg-slate-700 sm:w-8" />}
          </li>
        );
      })}
    </ol>
  );
}

export function Shell({
  children,
  flowRef,
  stepAnnounce,
  step,
}: {
  children: ReactNode;
  flowRef?: RefObject<HTMLDivElement | null>;
  stepAnnounce?: string;
  /** Current step (1-3) for the visible stepper. Omit to render no stepper (e.g. a bare embed). */
  step?: 1 | 2 | 3;
}) {
  return (
    <div ref={flowRef}>
      <div role="status" aria-live="polite" className="sr-only">
        {stepAnnounce}
      </div>
      {step && <Stepper step={step} />}
      {children}
    </div>
  );
}
