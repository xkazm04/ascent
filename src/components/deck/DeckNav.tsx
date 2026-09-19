"use client";

// Section nav for a scroll-snap deck: tracks which full-viewport section is centered and jumps to any
// of them. Right-edge dots on desktop; a compact bottom bar (chapter label + jump list + progress +
// prev/next) on tablet/mobile. Pass a STABLE `sections` array (module-level const) so the observer
// isn't torn down every render. Each control is an anchor → clicking smooth-scrolls + snaps.

import { useEffect, useState } from "react";

export interface DeckSectionRef {
  id: string;
  label: string;
}

export function DeckNav({ sections }: { sections: DeckSectionRef[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? "");

  // Depend on a derived stable key (the section ids) rather than the array identity. A caller passing
  // an inline `sections` literal produces a new array every render; keying the effect on `[sections]`
  // would disconnect/rebuild the observer each render and momentarily drop the active-dot highlight.
  // Keying on the id signature rebuilds only when the actual sections change.
  const sectionKey = sections.map((s) => s.id).join("|");

  useEffect(() => {
    const ids = sectionKey ? sectionKey.split("|") : [];
    // jsdom / very old browsers: keep the first section active rather than throwing on observe.
    if (typeof IntersectionObserver === "undefined") return;
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
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [sectionKey]);

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
              <span className={`type-label tracking-[0.22em] transition ${on ? "text-accent opacity-100" : "text-slate-500 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"}`}>
                {s.label}
              </span>
              <span className={`h-2 w-2 rounded-full border transition ${on ? "border-accent bg-accent" : "border-slate-600 group-hover:border-slate-400"}`} />
            </a>
          );
        })}
      </nav>

      {/* Below lg the right-edge dots are hidden. The bottom bar reuses the same `sections` array:
          current chapter as a native <details> jump list (every #id, not only ±1) + a visual progress
          strip + prev/next anchors. DeckSection (and the hand-rolled landing sections + AboutCTA)
          reserve `pb-24 lg:pb-10` beneath the overlay; padding grows into env(safe-area-inset-bottom)
          so the controls sit above the iOS home-indicator zone instead of inside it. */}
      <nav
        aria-label="Section navigation"
        className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-divider bg-surface-strong/90 px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-sm lg:hidden"
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
          <DeckJumpList sections={sections} active={active} />
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

/** Native overview of every section: same `#id` anchors as the desktop rail, opens upward. */
function DeckJumpList({ sections, active }: { sections: DeckSectionRef[]; active: string }) {
  const current = sections.find((s) => s.id === active)?.label ?? sections[0]?.label ?? "Section";
  return (
    <details className="group relative min-w-0">
      <summary className="focus-ring mx-auto flex max-w-full cursor-pointer list-none items-center justify-center gap-1 rounded-md px-1 py-0.5 [&::-webkit-details-marker]:hidden">
        <span className="sr-only">Jump to section, </span>
        <span className="truncate type-label tracking-wider text-accent">{current}</span>
        <DeckArrow dir="down" className="h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform group-open:rotate-180" />
      </summary>
      <ul className="absolute inset-x-0 bottom-full z-10 mb-2 max-h-64 overflow-y-auto rounded-lg border border-divider bg-surface-strong/95 py-1 shadow-lg backdrop-blur-sm">
        {sections.map((s) => {
          const on = active === s.id;
          return (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                aria-current={on ? "true" : undefined}
                className={`focus-ring block truncate px-3 py-2.5 text-left type-label tracking-wider ${on ? "bg-accent/10 text-accent" : "text-slate-300 hover:bg-white/5 hover:text-white"}`}
                onClick={(e) => {
                  const root = e.currentTarget.closest("details");
                  if (root instanceof HTMLDetailsElement) root.open = false;
                }}
              >
                {s.label}
              </a>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/** Chevron for the mobile prev/next jumps — the deck flows vertically, so up = previous, down = next. */
function DeckArrow({ dir, className = "h-5 w-5" }: { dir: "up" | "down"; className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d={dir === "up" ? "M6 12l4-4 4 4" : "M6 8l4 4 4-4"} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
