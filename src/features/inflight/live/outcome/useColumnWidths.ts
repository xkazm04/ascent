"use client";

// COLUMN WIDTHS — the sheet's one piece of viewer state, and the reason the drag is worth having: a
// wider column REVEALS MORE (the per-run headline, then the evidence line), so dragging is
// progressive disclosure, not decoration.
//
// Persisted per org in `localStorage`, INSIDE try/catch on both sides: a private window, a browser
// with site data blocked, or a corrupted value degrades to the defaults rather than throwing on the
// way to a render. Loaded in an effect rather than in the state initializer on purpose — reading
// storage during the first render would make the server's HTML and the client's first paint disagree.

import { useCallback, useEffect, useRef, useState } from "react";

/** The label column's key in the width map — the frozen column is resizable like any other. */
export const LABEL_COLUMN = "__label";

export const MIN_COLUMN_PX = 96; // 6rem
export const MAX_COLUMN_PX = 640; // 40rem

const LABEL_DEFAULT = 264;
const LATEST_DEFAULT = 260;
const RUN_DEFAULT = 168;

/** Reveal thresholds — what a cell earns the room to say (OutcomeSheetCell reads these). */
export const REVEAL_DIM_PX = 176;
export const REVEAL_EVIDENCE_PX = 272;

const clamp = (px: number): number => Math.min(MAX_COLUMN_PX, Math.max(MIN_COLUMN_PX, Math.round(px)));

const storageKey = (slug: string): string => `ascent.live.outcome.widths.${slug}`;

function readWidths(slug: string): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(storageKey(slug));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, number> = {};
    for (const [id, px] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof px === "number" && Number.isFinite(px)) out[id] = clamp(px);
    }
    return out;
  } catch {
    return {};
  }
}

export function useColumnWidths(slug: string, latestId: string | null) {
  const [widths, setWidths] = useState<Record<string, number>>({});
  const held = useRef<Record<string, number>>({});

  useEffect(() => {
    const stored = readWidths(slug);
    held.current = stored;
    setWidths(stored);
  }, [slug]);

  const defaultOf = useCallback(
    (id: string): number => (id === LABEL_COLUMN ? LABEL_DEFAULT : id === latestId ? LATEST_DEFAULT : RUN_DEFAULT),
    [latestId],
  );

  const widthOf = useCallback((id: string): number => widths[id] ?? defaultOf(id), [widths, defaultOf]);

  const setWidth = useCallback(
    (id: string, px: number) => {
      const next = { ...held.current, [id]: clamp(px) };
      held.current = next;
      setWidths(next);
      try {
        window.localStorage.setItem(storageKey(slug), JSON.stringify(next));
      } catch {
        // A blocked or full store costs the operator the memory of their layout, nothing else.
      }
    },
    [slug],
  );

  return { widthOf, setWidth };
}
