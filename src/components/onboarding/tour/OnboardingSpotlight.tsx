"use client";

// Variant A — "Altimeter spotlight". The classic blocking coach-mark: dim the app, punch a lit hole over
// the live element, and float an anchored popover beside it with Back / Skip / Next. Directive and
// linear — the app is frozen behind the scrim so attention has exactly one place to go. Best when the
// goal is "walk me through this once, in order".

import type { TourStep } from "./types";
import { CHAPTER_LABEL } from "./types";
import { useTourEngine } from "./useTourEngine";
import { SpotlightScrim } from "./HighlightLayer";
import { Kicker } from "@/components/ui";

const POPOVER_W = 380;

/** Position the popover beside the target rect (below by default, flipped above when the lower half is
 *  cramped); a concept step with no rect centers it. Guarded for the (unreached) SSR path. */
function popoverStyle(rect: DOMRect | null): React.CSSProperties {
  if (typeof window === "undefined" || !rect) {
    return { top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: POPOVER_W };
  }
  const gap = 14;
  const margin = 16;
  const left = Math.min(Math.max(margin, rect.left), window.innerWidth - POPOVER_W - margin);
  const below = rect.bottom + gap;
  if (window.innerHeight - below > 210) return { top: below, left, width: POPOVER_W };
  return { top: Math.max(margin, rect.top - gap), left, width: POPOVER_W, transform: "translateY(-100%)" };
}

export function OnboardingSpotlight({ slug, steps, onExit }: { slug: string; steps: TourStep[]; onExit: () => void }) {
  const t = useTourEngine(slug, steps, onExit);
  if (!t.step) return null;

  return (
    <>
      <SpotlightScrim rect={t.rect} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.step.title}
        className="animate-fade-up fixed z-[70] max-w-[calc(100vw-2rem)] rounded-2xl border border-divider bg-surface-strong p-5 shadow-2xl ring-1 ring-white/5"
        style={popoverStyle(t.rect)}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="rounded-full border border-accent/30 bg-accent/5 px-2.5 py-0.5 font-mono text-xs uppercase tracking-widest text-accent">
            {CHAPTER_LABEL[t.step.chapter]}
          </span>
          <span className="font-mono text-xs tabular-nums text-slate-500">
            {t.index + 1} / {t.total}
          </span>
        </div>

        <Kicker tone="muted" className="mt-3">{t.step.kicker}</Kicker>
        <h2 className="mt-1 text-lg font-semibold text-white">{t.step.title}</h2>
        <p className="mt-1.5 text-base leading-relaxed text-slate-300">{t.step.body}</p>
        {t.seeking && <p className="mt-2 font-mono text-xs text-slate-500">Locating…</p>}

        {/* Progress dots */}
        <div className="mt-4 flex items-center gap-1.5" aria-hidden>
          {steps.map((s, i) => (
            <span
              key={s.id}
              className={`h-1.5 rounded-full transition-all ${
                i === t.index ? "w-5 bg-accent" : i < t.index ? "w-1.5 bg-accent/50" : "w-1.5 bg-slate-700"
              }`}
            />
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={t.exit}
            className="focus-ring rounded-md px-2 py-1 font-mono text-sm uppercase tracking-widest text-slate-500 transition hover:text-slate-300"
          >
            Skip tour
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={t.prev}
              disabled={t.atFirst}
              className="focus-ring rounded-lg border border-slate-700 px-3 py-1.5 text-base text-slate-300 transition hover:border-slate-600 disabled:opacity-40"
            >
              Back
            </button>
            <button
              type="button"
              onClick={t.atLast ? t.exit : t.next}
              className="focus-ring rounded-lg bg-accent px-4 py-1.5 text-base font-semibold text-on-accent transition hover:bg-accent-soft"
            >
              {t.atLast ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
