"use client";

// reduced-motion-mechanics: reduction resolves at the preset layer (a table read: every preset, its
// full form, its reduced form), collapsed durations are epsilon so an awaited `animationend` still
// fires — the exit chip below unmounts on that event in both modes. content-bearing-degradation: a
// count-up figure and a typed headline are the PAYLOAD; with `reduced` they render their resolved
// end state immediately (never zero, never blank), the liveness label derives from whether the loop
// actually ran, and "replay" takes the instant path instead of starting the motion the user opted out of.

import { useEffect, useState } from "react";
import { HEADLINE_FIGURE, HEADLINE_TEXT } from "./fixtures";
import { DURATION_MS, PRESETS, type PresetName } from "./presets";
import { BTN, Readout, Region } from "./sceneParts";

const NAMES = Object.keys(PRESETS) as PresetName[];

export function ReducedRegion({ reduced }: { reduced: boolean }) {
  const [exitKey, setExitKey] = useState(0);
  const [exiting, setExiting] = useState(false);
  const [exits, setExits] = useState(0);
  return (
    <Region technique="reduced-motion-mechanics" title="Reduced is designed, not deleted" note="Per-preset fallbacks in one home; epsilon, never zero, so completion events keep firing.">
      <table className="w-full type-caption">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="font-normal">preset</th>
            <th className="font-normal">full</th>
            <th className="font-normal">reduced</th>
          </tr>
        </thead>
        <tbody>
          {NAMES.map((n) => (
            <tr key={n} className="border-t border-divider text-slate-300">
              <td className="py-1">{n}</td>
              <td className="py-1 text-slate-500">{PRESETS[n].tracks[0].kind === "timed" ? "curve" : "spring"}</td>
              <td className="py-1">{PRESETS[n].reduced}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {exiting ? (
          <span
            key={exitKey}
            className="inline-block h-5 w-5 rounded-md bg-accent"
            style={{ animation: `surface-fade ${reduced ? 1 : DURATION_MS.base}ms linear reverse both` }}
            onAnimationEnd={() => {
              setExiting(false);
              setExits((e) => e + 1);
            }}
            aria-hidden
          />
        ) : (
          <span className="inline-block h-5 w-5 rounded-md border border-dashed border-divider" aria-hidden />
        )}
        <button
          type="button"
          className={BTN}
          disabled={exiting}
          onClick={() => {
            setExitKey((k) => k + 1);
            setExiting(true);
          }}
        >
          play exit → unmount on animationend
        </button>
        <span className="type-caption text-slate-500" data-exits={exits}>
          completed exits: {exits} ({reduced ? "1ms epsilon" : `${DURATION_MS.base}ms`})
        </span>
      </div>
    </Region>
  );
}

const COUNT_MS = 1200;

export function ContentRegion({ reduced }: { reduced: boolean }) {
  const [run, setRun] = useState(0);
  // The payload's initial state IS the resolved end state whenever the loop will not play.
  const [figure, setFigure] = useState(reduced ? HEADLINE_FIGURE : 0);
  const [chars, setChars] = useState(reduced ? HEADLINE_TEXT.length : 0);
  const [loopRan, setLoopRan] = useState(false);
  const [prevReduced, setPrevReduced] = useState(reduced);
  if (prevReduced !== reduced) {
    setPrevReduced(reduced);
    if (reduced) {
      setFigure(HEADLINE_FIGURE); // the instant path: never zero, never blank
      setChars(HEADLINE_TEXT.length);
      setLoopRan(false);
    } else {
      setFigure(0);
      setChars(0);
    }
  }

  useEffect(() => {
    if (reduced) return; // the loop never starts; the state above already holds the end state
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const q = Math.min(1, (now - t0) / COUNT_MS);
      const e = 1 - Math.pow(1 - q, 3);
      setLoopRan(true);
      setFigure(Math.round(HEADLINE_FIGURE * e));
      setChars(Math.round(HEADLINE_TEXT.length * q));
      if (q < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run, reduced]);

  const replay = () => {
    if (reduced) {
      setFigure(HEADLINE_FIGURE); // replay takes the instant path: re-resolve, do not start the motion
      setChars(HEADLINE_TEXT.length);
      return;
    }
    setFigure(0);
    setChars(0);
    setRun((r) => r + 1);
  };

  const done = figure === HEADLINE_FIGURE && chars === HEADLINE_TEXT.length;
  const liveness = !loopRan ? "static value" : done ? "counted" : "counting…";
  return (
    <Region technique="content-bearing-degradation" title="The payload survives" note="The count-up and the typed headline ARE the content: degraded, they resolve instantly. The label follows the loop, not the preference.">
      <p className="type-figure-lg text-white" data-figure={figure}>
        {figure.toLocaleString()}
      </p>
      <p className="mt-1 min-h-[1.5rem] type-body text-slate-300" data-headline-complete={chars === HEADLINE_TEXT.length}>
        {HEADLINE_TEXT.slice(0, chars)}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" className={BTN} onClick={replay}>
          replay
        </button>
        <Readout label="liveness" value={<span data-liveness={liveness}>{liveness}</span>} />
      </div>
    </Region>
  );
}
