"use client";

// Section nav for a scroll-snap deck: tracks which full-viewport section is centered and jumps to any
// of them. Right-edge dots on desktop; a compact bottom bar (chapter label + progress + prev/next) on
// tablet/mobile, so small screens keep a jump/overview affordance. Pass a STABLE `sections` array
// (module-level const) so the observer isn't torn down every render. Each control is an anchor →
// clicking smooth-scrolls + snaps.

import { useEffect, useState } from "react";

export interface DeckSectionRef {
  id: string;
  label: string;
}

export function DeckNav({ sections }: { sections: DeckSectionRef[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? "");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        // A snap transition can report several intersecting entries in one batch, and IO does not order
        // them by centrality. Pick the entry covering the most of the central activation band (highest
        // intersectionRatio) so the indicator tracks the section the viewer is actually on, rather than
        // whichever intersecting entry happened to be last in array order.
        let best: IntersectionObserverEntry | null = null;
        for (const e of entries) {
          if (e.isIntersecting && (best === null || e.intersectionRatio > best.intersectionRatio)) best = e;
        }
        if (best) setActive(best.target.id);
      },
      { rootMargin: "-45% 0px -45% 0px" }, // active once a section crosses the viewport middle
    );
    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [sections]);

  const activeIndex = Math.max(0, sections.findIndex((s) => s.id === active));
  const prev = sections[activeIndex - 1];
  const next = sections[activeIndex + 1];

  return (
    <>
      <nav aria-label="Page sections" className="fixed right-4 top-1/2 z-30 hidden -translate-y-1/2 flex-col gap-3 lg:flex">
        {sections.map((s) => {
          const on = active === s.id;
          // DECK #1: add the shared .focus-ring so keyboard focus is visible, and reveal the
          // destination label on focus (not just hover) so a focused dot announces where it jumps.
          return (
            <a key={s.id} href={`#${s.id}`} aria-label={s.label} aria-current={on ? "true" : undefined} className="focus-ring group flex items-center justify-end gap-2 rounded-full">
              <span className={`font-mono text-xs uppercase tracking-wider transition ${on ? "text-accent opacity-100" : "text-slate-500 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"}`}>
                {s.label}
              </span>
              <span className={`h-2 w-2 rounded-full border transition ${on ? "border-accent bg-accent" : "border-slate-600 group-hover:border-slate-400"}`} />
            </a>
          );
        })}
      </nav>

      {/* Below lg the right-edge dots are hidden, leaving mandatory snap-scrolling with no overview.
          A compact bottom bar reuses the same `sections` array: current chapter + a progress strip +
          prev/next jumps (anchors, so they smooth-scroll + snap exactly like the dots). */}
      <nav
        aria-label="Section navigation"
        className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-divider bg-surface-strong/90 px-4 py-2 backdrop-blur-sm lg:hidden"
      >
        {prev ? (
          <a href={`#${prev.id}`} aria-label={`Previous: ${prev.label}`} className="focus-ring shrink-0 rounded-md p-2 text-slate-300 transition hover:text-white">
            <DeckArrow dir="up" />
          </a>
        ) : (
          <span aria-hidden className="shrink-0 rounded-md p-2 text-slate-700">
            <DeckArrow dir="up" />
          </span>
        )}

        <div className="min-w-0 flex-1 text-center">
          <div className="truncate font-mono text-xs uppercase tracking-wider text-accent">{sections[activeIndex]?.label}</div>
          <div className="mt-1 flex justify-center gap-1" aria-hidden>
            {sections.map((s, i) => (
              <span key={s.id} className={`h-1 w-4 rounded-full transition ${i === activeIndex ? "bg-accent" : "bg-slate-700"}`} />
            ))}
          </div>
        </div>

        {next ? (
          <a href={`#${next.id}`} aria-label={`Next: ${next.label}`} className="focus-ring shrink-0 rounded-md p-2 text-slate-300 transition hover:text-white">
            <DeckArrow dir="down" />
          </a>
        ) : (
          <span aria-hidden className="shrink-0 rounded-md p-2 text-slate-700">
            <DeckArrow dir="down" />
          </span>
        )}
      </nav>
    </>
  );
}

/** Chevron for the mobile prev/next jumps — the deck flows vertically, so up = previous, down = next. */
function DeckArrow({ dir }: { dir: "up" | "down" }) {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d={dir === "up" ? "M6 12l4-4 4 4" : "M6 8l4 4 4-4"} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
