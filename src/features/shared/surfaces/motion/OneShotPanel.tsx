"use client";

// one-shot-guarding: rows enter animated exactly once per identity per scope. "Poll" re-delivers the
// same identities (values drift) and MUST NOT replay their entrance; every second poll inserts one
// genuinely new identity, which enters alone while its settled neighbours hold still. "Change
// context" is the one reset policy: the scope key changes, the seen-set empties, everything may
// enter again. The guard is consulted during render (a row's first frame is already decided) and
// written by the entrance itself, on `animationend` — which the 1ms reduced epsilon still fires.
// The volume knob sets how many identities exist; the window shows the first few.

import { useEffect, useMemo, useRef, useState } from "react";
import type { SurfaceVolume } from "@/lib/org/surface-catalog";
import { pollRows, rowsFor } from "./fixtures";
import { useSeenSet } from "./motionHooks";
import { BUDGET, animationFor } from "./presets";
import { BTN, Readout, Region } from "./sceneParts";

const WINDOW = 6;

export function OneShotRegion({ reduced, volume }: { reduced: boolean; volume: SurfaceVolume }) {
  const [poll, setPoll] = useState(0);
  const [context, setContext] = useState(0);
  const scope = `ctx-${context}-${volume}`;
  const base = useMemo(() => rowsFor(volume), [volume]);
  const rows = useMemo(() => pollRows(base, poll), [base, poll]);
  const guard = useSeenSet(scope);
  const shown = rows.slice(0, WINDOW);
  const enters = shown.map((r) => guard.enters(r.id));
  const entering = enters.filter(Boolean).length;

  // The entrance itself writes the seen-set: ONE delegated `animationend` listener on the list (not
  // one per row) marks the identity whose entrance just finished — the 1ms reduced epsilon fires it too.
  const listRef = useRef<HTMLUListElement>(null);
  const { mark } = guard;
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onEnd = (e: Event) => {
      const id = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-id]")?.dataset.id;
      if (id) mark(id);
    };
    el.addEventListener("animationend", onEnd);
    return () => el.removeEventListener("animationend", onEnd);
  }, [mark]);

  return (
    <Region technique="one-shot-guarding" title="One-shot means one-shot" note="Poll re-delivers known identities: no replay. A new identity enters alone. Only a context change resets.">
      <ul ref={listRef} className="space-y-1" data-scope={scope}>
        {shown.map((r, i) => (
          <li
            key={r.id}
            data-id={r.id}
            data-entered={enters[i] ? "now" : "settled"}
            className="flex items-center justify-between rounded-md border border-divider px-2 py-1"
            style={{ animation: enters[i] ? animationFor("entrance", reduced, { delayMs: Math.min(i, BUDGET.staggerCountCap - 1) * BUDGET.staggerStepMs }) : "none" }}
          >
            <span className="type-caption text-slate-300">{r.label}</span>
            <span className="type-mono-sm tabular-nums text-slate-400">{r.value}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={BTN} onClick={() => setPoll((p) => p + 1)}>
          poll
        </button>
        <button type="button" className={BTN} onClick={() => setContext((c) => c + 1)}>
          change context
        </button>
        <span className="type-caption text-slate-500">
          poll #{poll} · scope {scope}
        </span>
      </div>
      <div className="mt-2 space-y-1">
        <Readout label="entering this render" value={<span data-entering={entering}>{entering}</span>} />
        <Readout label="seen / identities" value={`${guard.size} / ${rows.length.toLocaleString()} (window ${WINDOW})`} />
      </div>
    </Region>
  );
}
