"use client";

// The observatory's ACCESSIBLE TWIN. The SVG field is aria-hidden; this is the surface a screen
// reader and a keyboard actually operate. Every body appears here — including the never-scanned
// repos the field refuses to plot, which is the whole reason the twin is a list and not a caption:
// a repo with no coordinates still needs to be nameable and selectable.
//
// Roving tabindex: one tab stop for the whole list, arrows/Home/End move focus inside it — the
// listbox-ish pattern, expressed with real <button aria-pressed> rows so activation is plain.

import { useRef, useState } from "react";
import { Kicker } from "@/components/ui";
import { LEVEL_GLYPH, scoreGlyph } from "@/lib/ui";
import { QUADRANT_LABEL, type ObservatoryBody } from "./observatoryModel";

function glyphFor(body: ObservatoryBody): string {
  if (body.level && /^L[1-5]$/.test(body.level)) return LEVEL_GLYPH[body.level as keyof typeof LEVEL_GLYPH];
  return body.overall == null ? "·" : scoreGlyph(body.overall);
}

export interface ObservatoryListProps {
  bodies: ObservatoryBody[];
  selected: ReadonlySet<string>;
  onSelect: (next: Set<string>) => void;
  onOpen?: (fullName: string) => void;
  className?: string;
}

export function ObservatoryList({ bodies, selected, onSelect, onOpen, className = "" }: ObservatoryListProps) {
  const [cursor, setCursor] = useState(0);
  const rows = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (to: number) => {
    const i = Math.max(0, Math.min(bodies.length - 1, to));
    setCursor(i);
    rows.current[i]?.focus();
  };

  const toggle = (fullName: string) => {
    const next = new Set(selected);
    if (next.has(fullName)) next.delete(fullName);
    else next.add(fullName);
    onSelect(next);
  };

  const onKeyDown = (e: React.KeyboardEvent, i: number, fullName: string) => {
    if (e.key === "ArrowDown") move(i + 1);
    else if (e.key === "ArrowUp") move(i - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(bodies.length - 1);
    else if (e.key === "Enter" && e.ctrlKey && onOpen) onOpen(fullName);
    else return;
    e.preventDefault();
  };

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between">
        <Kicker tone="muted">Fleet · {bodies.length} repos</Kicker>
        <Kicker tone="muted">{selected.size} selected</Kicker>
      </div>
      <ul className="mt-2 divide-y divide-divider border-y border-divider" role="list">
        {bodies.map((b, i) => {
          const on = selected.has(b.fullName);
          return (
            <li key={b.fullName}>
              <button
                type="button"
                ref={(el) => {
                  rows.current[i] = el;
                }}
                aria-pressed={on}
                tabIndex={i === cursor ? 0 : -1}
                onFocus={() => setCursor(i)}
                onKeyDown={(e) => onKeyDown(e, i, b.fullName)}
                onClick={() => toggle(b.fullName)}
                className={`focus-ring flex w-full items-center gap-3 px-2 py-1.5 text-left transition ${
                  on ? "bg-accent/10" : "hover:bg-surface/60"
                }`}
              >
                <span aria-hidden className="w-3 shrink-0 font-mono text-xs" style={{ color: b.fill }}>
                  {glyphFor(b)}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-sm text-slate-200" title={b.fullName}>
                  {b.label}
                </span>
                <span className="shrink-0 font-mono text-xs uppercase tracking-[0.22em] text-slate-500">
                  {b.neverScanned ? "Never scanned" : QUADRANT_LABEL[b.quadrant!]}
                </span>
                <span className="w-8 shrink-0 text-right font-mono text-sm tabular-nums text-slate-300">
                  {b.overall ?? "—"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {bodies.length === 0 && <p className="mt-3 font-mono text-sm text-slate-500">No repos in this scope yet.</p>}
    </div>
  );
}
