"use client";

// The guided onboarding for the demo-org dashboard: a right-edge DRAWER that slides out from behind the
// screen border and pushes back to hide, leaving only a pull tab. It's the non-blocking "pre-flight
// checklist" direction — the app stays fully usable underneath while a pulsing ring tracks the current
// step and the checklist maps what to learn next (set scope → read results → explore modules). Self-
// contained: owns the open/collapsed state and drives the shared tour engine, which is inert while closed.

import { useState } from "react";
import { CHAPTER_LABEL, CHAPTER_ORDER } from "./types";
import { DEMO_TOUR_STEPS } from "./steps";
import { useTourEngine } from "./useTourEngine";
import { HighlightRing } from "./HighlightLayer";
import { Kicker } from "@/components/ui";

export function OnboardingChecklist({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const t = useTourEngine(slug, DEMO_TOUR_STEPS, { enabled: open, onExit: () => setOpen(false) });
  const steps = DEMO_TOUR_STEPS;

  return (
    <>
      {open && <HighlightRing rect={t.rect} />}

      <div className="fixed right-0 top-1/2 z-[55] -translate-y-1/2">
        <div
          className={`relative transition-transform duration-300 ease-out motion-reduce:transition-none ${
            open ? "translate-x-0" : "translate-x-full"
          }`}
        >
          {/* Pull tab — always on screen (sits at the panel's outer/left edge, translating with it). */}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? "Hide guided tour" : "Open guided tour"}
            className="focus-ring absolute right-full top-1/2 flex -translate-y-1/2 items-center gap-2 rounded-l-xl border border-r-0 border-divider bg-surface-strong px-2.5 py-4 text-accent shadow-2xl transition hover:bg-accent/10"
            style={{ writingMode: "vertical-rl" }}
          >
            <span aria-hidden className="text-sm">{open ? "▸" : "◂"}</span>
            <span className="font-mono text-xs uppercase tracking-[0.2em]">Guided setup</span>
          </button>

          {/* Panel — flush to the right edge (left-rounded, no right border). */}
          <div className="flex max-h-[80vh] w-80 max-w-[85vw] flex-col rounded-l-2xl border border-r-0 border-divider bg-surface-strong shadow-2xl ring-1 ring-white/5 backdrop-blur-md">
            <div className="flex items-start justify-between gap-3 border-b border-divider px-4 py-3">
              <div>
                <Kicker>Guided setup</Kicker>
                <h2 className="mt-1 text-base font-semibold text-white">Learn this dashboard</h2>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs tabular-nums text-slate-500">
                  {t.index + 1}/{t.total}
                </span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Hide guided tour"
                  className="focus-ring rounded-md border border-slate-700 px-2 py-0.5 text-slate-400 transition hover:border-accent hover:text-white"
                >
                  ▸
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
              {CHAPTER_ORDER.map((chapter) => {
                const chapterSteps = steps.map((s, i) => ({ s, i })).filter(({ s }) => s.chapter === chapter);
                if (chapterSteps.length === 0) return null;
                return (
                  <div key={chapter}>
                    <div className="font-mono text-xs uppercase tracking-widest text-slate-500">{CHAPTER_LABEL[chapter]}</div>
                    <ul className="mt-2 space-y-1">
                      {chapterSteps.map(({ s, i }) => {
                        const state = i === t.index ? "active" : i < t.index ? "done" : "pending";
                        return (
                          <li key={s.id}>
                            <button
                              type="button"
                              onClick={() => t.goTo(i)}
                              aria-current={state === "active" ? "step" : undefined}
                              className={`focus-ring flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition ${
                                state === "active"
                                  ? "border-accent bg-accent/10"
                                  : "border-transparent hover:border-slate-700 hover:bg-white/5"
                              }`}
                            >
                              <Marker state={state} />
                              <span className={`flex-1 text-sm ${state === "pending" ? "text-slate-400" : "text-white"}`}>
                                {s.title}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>

            {t.step && (
              <div className="border-t border-divider px-4 py-3">
                <p className="text-sm leading-relaxed text-slate-300">{t.step.body}</p>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={t.prev}
                    disabled={t.atFirst}
                    className="focus-ring rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-slate-600 disabled:opacity-40"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={t.atLast ? t.exit : t.next}
                    className="focus-ring rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-on-accent transition hover:bg-accent-soft"
                  >
                    {t.atLast ? "Done" : "Next step"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function Marker({ state }: { state: "active" | "done" | "pending" }) {
  if (state === "done") {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent text-xs text-on-accent">✓</span>
    );
  }
  return (
    <span
      className={`h-4 w-4 shrink-0 rounded-full border ${
        state === "active" ? "border-accent motion-safe:animate-pulse" : "border-slate-600"
      }`}
    />
  );
}
