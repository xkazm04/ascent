"use client";

// Variant B — "Pre-flight checklist". A non-blocking companion: no scrim, the app stays fully usable
// underneath, and a docked rail lists the three chapters as a checklist while a pulsing ring glues to
// whatever the current step points at. The user can free-roam and jump to any step. Best when the goal
// is "let me explore, but keep a map of what to learn next" — self-paced rather than on-rails.

import type { TourStep } from "./types";
import { CHAPTER_LABEL, CHAPTER_ORDER } from "./types";
import { useTourEngine } from "./useTourEngine";
import { HighlightRing } from "./HighlightLayer";
import { Kicker, Surface } from "@/components/ui";

export function OnboardingChecklistRail({ slug, steps, onExit }: { slug: string; steps: TourStep[]; onExit: () => void }) {
  const t = useTourEngine(slug, steps, onExit);
  const done = t.index; // steps before the cursor read as completed

  return (
    <>
      <HighlightRing rect={t.rect} />
      <Surface
        radius="2xl"
        tone="strong"
        className="animate-fade-up fixed bottom-4 left-4 z-[55] flex max-h-[80vh] w-80 flex-col p-0 shadow-2xl ring-1 ring-white/5 backdrop-blur-md"
      >
        <div
          role="complementary"
          aria-label="Onboarding checklist"
          className="flex items-start justify-between gap-3 border-b border-divider px-4 py-3"
        >
          <div>
            <Kicker>Guided setup</Kicker>
            <h2 className="mt-1 text-base font-semibold text-white">Learn this dashboard</h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs tabular-nums text-slate-500">
              {done}/{t.total}
            </span>
            <button
              type="button"
              onClick={t.exit}
              aria-label="Close checklist"
              className="focus-ring rounded-md border border-slate-700 px-2 py-0.5 text-slate-400 transition hover:border-accent hover:text-white"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
          {CHAPTER_ORDER.map((chapter) => {
            const chapterSteps = steps
              .map((s, i) => ({ s, i }))
              .filter(({ s }) => s.chapter === chapter);
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
      </Surface>
    </>
  );
}

function Marker({ state }: { state: "active" | "done" | "pending" }) {
  if (state === "done") {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] text-on-accent">✓</span>
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
