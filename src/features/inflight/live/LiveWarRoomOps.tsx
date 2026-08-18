"use client";

// The war-room SHIP LOOP band — the operational half of the wall (identify → triage → PR → merge →
// rescan → impact). This shell owns the single monitor poller (useShipLoop) and the auto-verify
// toggle; the Pipeline view renders the symbolic state-rail overview + the drill-in detail tray.

import { useCallback, useEffect, useRef, useState } from "react";
import { freshness } from "@/lib/ui";
import { useShipLoop } from "@/features/inflight/live/useShipLoop";
import type { OpsState } from "@/lib/db";
import type { OpsView } from "@/features/inflight/live/liveWarRoomOpsShared";
import { ShipLoopPipeline } from "@/features/inflight/live/LiveWarRoomOpsPipeline";

/**
 * The ship-loop band. `initial` is the SSR snapshot; the hook's monitor poll advances it while the
 * wall is foregrounded. Auto-verify (persisted, default ON) fires the wall's scoped rescan for
 * repos whose PR just merged — closing merge → rescan → measured impact without a human.
 */
export function ShipLoopBand({
  slug,
  initial,
  onVerify,
}: {
  slug: string;
  initial: OpsState | null;
  /** Launch the wall's scoped scan for these repos (the verify rescan). */
  onVerify: (fullNames: string[]) => void;
}) {
  const [autoVerify, setAutoVerify] = useState(true);
  const autoVerifyRef = useRef(autoVerify);
  useEffect(() => {
    autoVerifyRef.current = autoVerify;
  }, [autoVerify]);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot restore of the persisted toggle
      if (localStorage.getItem("ascent-warroom-autoverify") === "0") setAutoVerify(false);
    } catch {
      /* localStorage unavailable */
    }
  }, []);
  const toggleAutoVerify = useCallback(() => {
    setAutoVerify((v) => {
      try {
        localStorage.setItem("ascent-warroom-autoverify", v ? "0" : "1");
      } catch {
        /* localStorage unavailable */
      }
      return !v;
    });
  }, []);

  const onVerifyRef = useRef(onVerify);
  useEffect(() => {
    onVerifyRef.current = onVerify;
  }, [onVerify]);
  const onMerged = useCallback((fullNames: string[]) => {
    if (autoVerifyRef.current) onVerifyRef.current(fullNames);
  }, []);

  const loop = useShipLoop({ slug, initial, onMerged });
  const s = loop.state;
  if (!s) return null;

  const view: OpsView = { state: s, busy: loop.busy, accept: loop.accept, reject: loop.reject, onVerify };

  return (
    <div className="mt-4 rounded-2xl border border-divider bg-surface/40">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-divider px-4 py-2.5">
        <h3 className="font-mono text-sm uppercase tracking-widest text-accent">Ship loop</h3>
        <span className="hidden font-mono text-sm text-slate-500 sm:inline">identify → triage → PR → merge → rescan → impact</span>
        {s.mockPrs && (
          <span
            className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 font-mono text-xs text-amber-300"
            title="GitHub App not configured: PRs are simulated locally (they merge on their own after ~90s)"
          >
            mock PRs
          </span>
        )}
        <span className="flex-1" />
        <label className="flex items-center gap-1.5 font-mono text-sm text-slate-500" title="When a PR merges, automatically rescan that repo to measure the impact">
          <input type="checkbox" checked={autoVerify} onChange={toggleAutoVerify} className="accent-accent" />
          Auto-verify merges
        </label>
        {loop.polledAt && (
          <span className="font-mono text-xs text-slate-600" suppressHydrationWarning>
            checked {freshness(new Date(loop.polledAt).toISOString())}
          </span>
        )}
      </header>
      {loop.error && <p className="border-b border-divider px-4 py-2 font-mono text-sm text-orange-300">{loop.error}</p>}
      <ShipLoopPipeline {...view} />
    </div>
  );
}
