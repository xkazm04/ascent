"use client";

// Variant C — "Mission briefing". Teach the concept first in a centered editorial card (the brand Modal),
// THEN hand off to the live dashboard: "Show me →" closes the deck, scrolls to the real element and rings
// it while a slim toolbar offers to continue. Concept-before-context, and it reads like the app's briefing
// voice. Best when the ideas (scope, the maturity ladder, modules) need a sentence of framing before the
// pixels make sense — heavier than coach-marks, but the most explanatory.

import { useState } from "react";
import type { TourStep } from "./types";
import { CHAPTER_LABEL } from "./types";
import { useTourEngine } from "./useTourEngine";
import { HighlightRing } from "./HighlightLayer";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui";

const PAGE_LABEL: Record<string, string> = { "": "Overview", repositories: "Repositories", executive: "Briefing" };
function pageLabel(page: string): string {
  return PAGE_LABEL[page] ?? page.charAt(0).toUpperCase() + page.slice(1);
}

export function OnboardingBriefing({ slug, steps, onExit }: { slug: string; steps: TourStep[]; onExit: () => void }) {
  const t = useTourEngine(slug, steps, onExit);
  // `pointing` swaps the concept modal for the live highlight + a continue toolbar.
  const [pointing, setPointing] = useState(false);
  if (!t.step) return null;

  const showMe = () => {
    if (t.step?.anchor) {
      document.querySelector<HTMLElement>(`[data-tour="${t.step.anchor}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    setPointing(true);
  };
  const advance = (fn: () => void) => {
    setPointing(false); // reopen the deck on the next concept
    fn();
  };

  if (pointing) {
    return (
      <>
        <HighlightRing rect={t.rect} />
        <div className="animate-fade-up fixed bottom-6 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-divider bg-surface-strong px-4 py-2.5 shadow-2xl ring-1 ring-white/5">
          <span className="font-mono text-xs uppercase tracking-widest text-accent">Live · {pageLabel(t.step.page)}</span>
          <span className="hidden max-w-xs truncate text-sm text-slate-300 sm:block">{t.step.title}</span>
          <button
            type="button"
            onClick={() => setPointing(false)}
            className="focus-ring rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-slate-600"
          >
            ← Briefing
          </button>
          <button
            type="button"
            onClick={() => advance(t.atLast ? t.exit : t.next)}
            className="focus-ring rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-on-accent transition hover:bg-accent-soft"
          >
            {t.atLast ? "Finish" : "Next →"}
          </button>
        </div>
      </>
    );
  }

  return (
    <Modal open onClose={t.exit} ariaLabel={t.step.title} size="md">
      <ModalHeader kicker={CHAPTER_LABEL[t.step.chapter]} title={t.step.title} context={`Concept ${t.index + 1} of ${t.total}`} />
      <ModalBody>
        <p className="text-base leading-relaxed text-slate-300">{t.step.body}</p>
        {t.step.anchor && (
          <p className="mt-3 rounded-lg border border-divider bg-surface/40 px-3 py-2 font-mono text-sm text-slate-400">
            On the <span className="text-accent">{pageLabel(t.step.page)}</span> view — press{" "}
            <span className="text-slate-200">Show me</span> to see it highlighted.
          </p>
        )}
      </ModalBody>
      <ModalFooter>
        <button
          type="button"
          onClick={t.exit}
          className="focus-ring rounded-md px-2 py-1 font-mono text-sm uppercase tracking-widest text-slate-500 transition hover:text-slate-300"
        >
          End tour
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
          {t.step.anchor && (
            <button
              type="button"
              onClick={showMe}
              className="focus-ring rounded-lg border border-accent/40 px-3 py-1.5 text-base text-accent transition hover:border-accent hover:bg-accent/10"
            >
              Show me →
            </button>
          )}
          <button
            type="button"
            onClick={() => advance(t.atLast ? t.exit : t.next)}
            className="focus-ring rounded-lg bg-accent px-4 py-1.5 text-base font-semibold text-on-accent transition hover:bg-accent-soft"
          >
            {t.atLast ? "Finish" : "Next"}
          </button>
        </div>
      </ModalFooter>
    </Modal>
  );
}
