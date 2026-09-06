"use client";

// CONSOLE's top row: the techniques as one horizontally-scrolling segmented strip, the way an
// instrument names its channels. It is a real tablist — the canvas below is the panel it switches —
// with a roving tabindex so the whole strip is one tab stop, arrows to move, Home/End to the ends
// and Escape back to the whole composed scene.
//
// The leading "All regions" tab is the composed view the baseline showed by default: it is a choice
// here rather than the resting state, because the resting state is one region and a short page.

import { useRef, type KeyboardEvent } from "react";
import type { SurfaceTechnique } from "./surfaceBody";

export function SurfaceTechniqueStrip({
  techniques,
  active,
  panelId,
  onPick,
  onAll,
}: {
  techniques: readonly SurfaceTechnique[];
  /** The technique whose region is showing, or null while the whole scene is. */
  active: string | null;
  panelId: string;
  onPick: (slug: string) => void;
  onAll: () => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const focusAt = (i: number) => {
    const tabs = stripRef.current?.querySelectorAll<HTMLButtonElement>("button[data-slug]");
    tabs?.[i]?.focus();
  };
  const index = active ? techniques.findIndex((t) => t.slug === active) : -1;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!techniques.length) return;
    const move = (n: number) => {
      e.preventDefault();
      const t = techniques[n];
      if (t) {
        onPick(t.slug);
        focusAt(n);
      }
    };
    if (e.key === "ArrowRight" || e.key === "ArrowDown") move((index + 1) % techniques.length);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") move((index - 1 + techniques.length) % techniques.length);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(techniques.length - 1);
    else if (e.key === "Escape") onAll();
  };

  return (
    <div
      ref={stripRef}
      role="tablist"
      aria-label="Techniques"
      onKeyDown={onKeyDown}
      className="flex items-stretch gap-px overflow-x-auto rounded-xl border border-divider bg-divider"
      data-surface-strip="console"
    >
      <button
        type="button"
        role="tab"
        aria-selected={active === null}
        aria-controls={panelId}
        tabIndex={active === null ? 0 : -1}
        onClick={onAll}
        className={`focus-ring shrink-0 bg-ink px-3 py-2 type-caption transition hover:bg-surface/60 ${
          active === null ? "text-accent" : "text-slate-500"
        }`}
      >
        All regions
      </button>
      {techniques.map((t, i) => {
        const current = t.slug === active;
        return (
          <button
            key={t.slug}
            type="button"
            role="tab"
            data-slug={t.slug}
            aria-selected={current}
            aria-controls={panelId}
            tabIndex={current ? 0 : -1}
            onClick={() => onPick(t.slug)}
            className={`focus-ring flex shrink-0 items-baseline gap-2 px-3 py-2 text-left transition ${
              current ? "bg-accent/10 text-white" : "bg-ink text-slate-400 hover:bg-surface/60"
            }`}
          >
            <span className={`type-caption tabular-nums ${current ? "text-accent" : "text-slate-600"}`}>{String(i + 1).padStart(2, "0")}</span>
            <span className="type-body-sm whitespace-nowrap">{t.title}</span>
          </button>
        );
      })}
    </div>
  );
}
