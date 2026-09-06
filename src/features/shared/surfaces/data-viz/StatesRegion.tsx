"use client";

// empty-and-degraded-chart-states: one slot, eight facts, no shared rendering. Chrome — gridlines,
// ticks — is drawn ONLY around data; before data the reserved slot holds a placeholder; the four
// kinds of "nothing plotted" each say what they are and what to do next; failure keeps the window and
// offers retry, and is spelled nothing like zero. Inside a populated chart the same taxonomy recurs:
// a gap breaks the line, two observations render as points with the number and no confident slope.

import { useState } from "react";
import { SCORE_DOMAIN, seriesColor } from "./chartMath";
import type { Repo } from "./fixtures";
import { MiniLine } from "./MiniLine";
import { BTN, Chips, Region } from "./sceneParts";

type Fact = "loading" | "nothing-yet" | "nothing-in-window" | "not-measured" | "failed" | "two-points" | "gap" | "measured";
const FACTS: readonly { id: Fact; label: string }[] = [
  { id: "loading", label: "loading" },
  { id: "nothing-yet", label: "nothing exists yet" },
  { id: "nothing-in-window", label: "nothing in window" },
  { id: "not-measured", label: "not being measured" },
  { id: "failed", label: "could not answer" },
  { id: "two-points", label: "two observations" },
  { id: "gap", label: "gap inside" },
  { id: "measured", label: "measured" },
];

function Empty({ fact, onWiden, onRetry }: { fact: Fact; onWiden: () => void; onRetry: () => void }) {
  const box = "flex h-full flex-col items-start justify-center gap-1 rounded-md border border-dashed border-divider p-3";
  switch (fact) {
    case "loading":
      return <div className={`h-full rounded-md bg-surface/40`} aria-hidden data-chrome="none" />;
    case "nothing-yet":
      return (
        <div className={box} data-chrome="none">
          <p className="type-caption text-slate-300">No scans yet.</p>
          <p className="type-caption text-slate-500">The trend appears after the first scan lands. Nothing has been measured; nothing is zero.</p>
        </div>
      );
    case "nothing-in-window":
      return (
        <div className={box} data-chrome="none">
          <p className="type-caption text-slate-300">No scans in the last 14 days.</p>
          <p className="type-caption text-slate-500">Data exists outside this window — your history is not gone.</p>
          <button type="button" className={BTN} onClick={onWiden}>
            widen to 90 days
          </button>
        </div>
      );
    case "not-measured":
      return (
        <div className={box} data-chrome="none">
          <p className="type-caption text-warn">Not being measured.</p>
          <p className="type-caption text-slate-500">The rescan watch is off for this repository. Waiting will not fill this — turn the watch on.</p>
        </div>
      );
    case "failed":
      return (
        <div className={`${box} border-danger/50`} data-chrome="none" role="alert">
          <p className="type-caption text-danger">Could not load the trend.</p>
          <p className="type-caption text-slate-500">The history query failed; the 14-day window is kept. This is not a zero.</p>
          <button type="button" className={BTN} onClick={onRetry}>
            retry
          </button>
        </div>
      );
    default:
      return null;
  }
}

export function StatesRegion({ repos, reduced }: { repos: readonly Repo[]; reduced: boolean }) {
  const [fact, setFact] = useState<Fact>("measured");
  const measured = repos.find((r) => r.shape === "climbing") ?? repos[0]!;
  const gapped = repos.find((r) => r.shape === "gap") ?? measured;
  const fresh = repos.find((r) => r.shape === "new") ?? measured;
  const series = fact === "gap" ? gapped : fact === "two-points" ? fresh : measured;
  const drawn = fact === "measured" || fact === "gap" || fact === "two-points";

  return (
    <Region technique="empty-and-degraded-chart-states" title="Never an axis around nothing" note="Absence, silence, failure and zero are four sentences. The frame is drawn only when there is data to frame.">
      <Chips label="What the slot holds" value={fact} options={FACTS} onPick={setFact} />
      <div className="mt-3 h-28 rounded-lg border border-divider p-2" data-fact={fact}>
        {drawn ? (
          <div className="h-full" data-chrome="drawn">
            <MiniLine series={series.score} domain={SCORE_DOMAIN} color={seriesColor(series.id)} reduced={reduced} chrome h={96} w={300} pad={10} ariaLabel={`${series.name} overall score, 14 days, ${fact === "gap" ? "with an unmeasured stretch" : fact === "two-points" ? "two observations, trend still forming" : "measured daily"}`} />
          </div>
        ) : (
          <Empty fact={fact} onWiden={() => setFact("measured")} onRetry={() => setFact("measured")} />
        )}
      </div>
      <p className="mt-2 type-caption text-slate-500" data-fact-note>
        {fact === "gap"
          ? "Days 5–8 were not collected: the line breaks over a shaded band. Plotting them as 0 fabricates a crash; bridging them fabricates continuity."
          : fact === "two-points"
            ? `${fresh.name} has two observations: points and the number, no line — a slope from two points reads as a trend it is not.`
            : fact === "measured"
              ? "Measured daily; the last bucket is today so far — dashed, hollow, and excluded from every window."
              : "No gridlines, no ticks, no zero line: chrome would assert a measurement of nothing."}
      </p>
    </Region>
  );
}
