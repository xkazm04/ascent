"use client";

// The technique rail: one button per technique the scene embodies, `aria-current` on the open one,
// arrow keys to step (Home/End to the ends), Escape to clear the spotlight. A small local list
// rather than `SectionRailNav`, which is a two-level route-driven nav — this is a flat, state-driven
// picker inside one route. Roving tabindex so the rail is one tab stop.

import { useRef, type KeyboardEvent } from "react";
import { Kicker } from "@/components/ui";
import type { SurfaceTechnique } from "./surfaceBody";

export function SurfaceRail({
  techniques,
  selected,
  onSelect,
  onStep,
}: {
  techniques: readonly SurfaceTechnique[];
  selected: string | null;
  onSelect: (slug: string | null) => void;
  onStep: (delta: 1 | -1) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const focusIndex = (i: number) => {
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-slug]");
    buttons?.[i]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      onStep(1);
      const i = selected ? techniques.findIndex((t) => t.slug === selected) : -1;
      focusIndex((i + 1) % techniques.length);
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      onStep(-1);
      const i = selected ? techniques.findIndex((t) => t.slug === selected) : 0;
      focusIndex((i - 1 + techniques.length) % techniques.length);
    } else if (e.key === "Home") {
      e.preventDefault();
      onSelect(techniques[0]?.slug ?? null);
      focusIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      onSelect(techniques.at(-1)?.slug ?? null);
      focusIndex(techniques.length - 1);
    } else if (e.key === "Escape") {
      onSelect(null);
    }
  };
  const activeIndex = selected ? techniques.findIndex((t) => t.slug === selected) : 0;

  return (
    <nav aria-label="Techniques" className="space-y-2">
      <Kicker tone="muted">Techniques</Kicker>
      <div ref={listRef} onKeyDown={onKeyDown} className="flex flex-col gap-px overflow-hidden rounded-xl border border-divider bg-divider">
        {techniques.map((t, i) => {
          const current = t.slug === selected;
          return (
            <button
              key={t.slug}
              type="button"
              data-slug={t.slug}
              tabIndex={i === Math.max(activeIndex, 0) ? 0 : -1}
              aria-current={current ? "true" : undefined}
              onClick={() => onSelect(current ? null : t.slug)}
              className={`focus-ring flex items-baseline gap-2 bg-ink px-3 py-2 text-left transition hover:bg-surface/60 ${
                current ? "text-white" : "text-slate-400"
              }`}
            >
              <span className={`type-caption tabular-nums ${current ? "text-accent" : "text-slate-600"}`}>{String(i + 1).padStart(2, "0")}</span>
              <span className="type-body-sm">{t.title}</span>
            </button>
          );
        })}
      </div>
      <p className="type-caption text-slate-600">Arrow keys step · Esc clears the spotlight</p>
    </nav>
  );
}
