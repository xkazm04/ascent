"use client";

// chart-loading-economics: three chart slots at FINAL height from the first frame. The "engine" is a
// simulated deferred chunk — cold until asked for, loaded once, shared by every slot; while engine and
// data wait, one calm placeholder holds the geometry (no spinner, delayed so a warm path never
// flashes it). Each slot sits behind its own failure boundary: poison one series and that slot
// degrades to a failure state with retry while its siblings keep drawing, and the boundary reports
// the failure with the chart's identity. The timer and the boundary both name their reaper.

import React, { useEffect, useState } from "react";
import { SCORE_DOMAIN, seriesColor } from "./chartMath";
import type { Repo } from "./fixtures";
import { MiniLine } from "./MiniLine";
import { BTN, Readout, Region } from "./sceneParts";

const ENGINE_MS = 900;
const SLOT_H = "h-24";
type Engine = "cold" | "loading" | "ready";

/** Per-chart failure boundary: one malformed series degrades ONE slot, never the board. */
class ChartBoundary extends React.Component<
  { id: string; resetKey: number; onReport: (id: string, message: string) => void; children: React.ReactNode },
  { error: Error | null; prevKey: number }
> {
  state = { error: null as Error | null, prevKey: this.props.resetKey };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  static getDerivedStateFromProps(p: { resetKey: number }, s: { error: Error | null; prevKey: number }) {
    return p.resetKey !== s.prevKey ? { error: null, prevKey: p.resetKey } : null;
  }
  componentDidCatch(error: Error) {
    this.props.onReport(this.props.id, error.message); // telemetry: identity + what triggered it
  }
  render() {
    if (this.state.error) {
      return (
        <div className={`${SLOT_H} flex flex-col items-start justify-center gap-1 rounded-lg border border-danger/50 p-2`} data-slot-state="failed" role="alert">
          <p className="type-caption text-danger">This chart could not render.</p>
          <p className="type-caption text-slate-500">{this.state.error.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Throws the way a real renderer does over a malformed series — inside render, inside the boundary. */
function SlotChart({ repo, poisoned, reduced }: { repo: Repo; poisoned: boolean; reduced: boolean }) {
  if (poisoned) throw new Error(`${repo.id}: NaN in bucket 7 (series length 15)`);
  return <MiniLine series={repo.score} domain={SCORE_DOMAIN} color={seriesColor(repo.id)} reduced={reduced} chrome h={80} w={220} pad={10} ariaLabel={`${repo.name} overall score, 14 days`} />;
}

export function LoadingRegion({ repos, reduced }: { repos: readonly Repo[]; reduced: boolean }) {
  const [engine, setEngine] = useState<Engine>("cold");
  const [poisoned, setPoisoned] = useState<string | null>(null);
  const [resets, setResets] = useState(0);
  const [reports, setReports] = useState<string[]>([]);
  const slots = repos.slice(0, 3);

  // The engine "chunk": requested once, resolved once, shared. The timeout names its reaper.
  useEffect(() => {
    if (engine !== "loading") return;
    const id = setTimeout(() => setEngine("ready"), ENGINE_MS);
    return () => clearTimeout(id);
  }, [engine]);

  const report = (id: string, message: string) => setReports((r) => [...r, `${id}: ${message}`]);
  const retry = () => {
    setPoisoned(null);
    setResets((n) => n + 1);
  };

  return (
    <Region technique="chart-loading-economics" title="Instruments, not an organism" note="Slots reserve their height before engine or data arrive. One placeholder covers both waits. One poisoned series takes down one slot.">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={BTN} onClick={() => setEngine("loading")} disabled={engine !== "cold"}>
          {engine === "cold" ? "open the dashboard (load engine)" : engine === "loading" ? "engine loading…" : "engine ready · shared"}
        </button>
        <button type="button" className={BTN} onClick={() => setPoisoned(slots[1]?.id ?? null)} disabled={engine !== "ready" || poisoned !== null}>
          poison series B
        </button>
        <button type="button" className={BTN} onClick={retry} disabled={poisoned === null}>
          retry B
        </button>
        <button type="button" className={BTN} onClick={() => { setEngine("cold"); setPoisoned(null); setResets((n) => n + 1); }}>
          reset
        </button>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3" data-engine={engine}>
        {slots.map((r) => (
          <div key={r.id} className="rounded-lg border border-divider p-2" data-slot={r.id}>
            <p className="type-caption text-slate-300">{r.name}</p>
            {engine === "ready" ? (
              <ChartBoundary id={r.id} resetKey={resets} onReport={report}>
                <div className={SLOT_H} data-slot-state="drawn">
                  <SlotChart repo={r} poisoned={poisoned === r.id} reduced={reduced} />
                </div>
              </ChartBoundary>
            ) : (
              // Final geometry from the first frame; the calm fill only appears after a beat (a warm
              // path never flashes it), and never pulses under `reduced`.
              <div
                className={`${SLOT_H} rounded-md bg-surface/40`}
                data-slot-state={engine === "cold" ? "reserved" : "placeholder"}
                aria-hidden
                style={engine === "loading" && !reduced ? { animation: "surface-quiet 700ms ease-out 150ms both" } : undefined}
              />
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 space-y-1">
        <Readout label="engine bytes moved" value={engine === "cold" ? "0 — nothing above the fold asked" : "once, shared by 3 slots"} />
        <Readout label="reported to telemetry" value={<span data-reports={reports.length}>{reports.length === 0 ? "none" : reports[reports.length - 1]}</span>} tone={reports.length ? "text-warn" : "text-slate-200"} />
      </div>
    </Region>
  );
}
