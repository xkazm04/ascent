"use client";

// THE FLIGHT LOG — every round as a column, chapters split at quiet gaps, closes above the axis, reported
// $ below, one verdict mark per lane, the lift and the cumulative line. Hover (or arrow keys) shows a
// readout; a click (or Enter) opens the round. The chart is drawn at the wrapper's measured width.

import { useEffect, useRef, useState } from "react";
import { date } from "./deskFormat";
import { FLOG, cumulativePoints, flogGeometry, niceTicks, tickRound } from "./flogModel";
import { RoundColumn } from "./FlightLogMarks";
import { Readout } from "./FlightLogReadout";
import type { RoundsFold } from "./roundsModel";
import r from "./deskRounds.module.css";

export function FlightLog({ fold, sel, setSel, onOpen }: { fold: RoundsFold; sel: number; setSel: (i: number) => void; onOpen: (i: number) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1100);
  const [hover, setHover] = useState<number | null>(null);
  const { rounds, chapters, totals } = fold;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth - 16);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const g = flogGeometry(rounds, width);
  const { L, R, top } = FLOG;
  const indexOf = (t: EventTarget | null) => {
    const el = t instanceof Element ? t.closest("[data-i]") : null;
    return el ? Number(el.getAttribute("data-i")) : null;
  };

  return (
    <div className={r.logwrap} ref={wrap} data-role="desk-flog">
      <svg
        className={r.flog}
        role="application"
        tabIndex={0}
        aria-label="Flight log: every round, verified closes above the axis, reported cost below, one mark per lane. Arrow keys walk the rounds, Enter opens one."
        viewBox={`0 0 ${g.W} ${g.H}`}
        width={g.W}
        height={g.H}
        onMouseMove={(e) => setHover(indexOf(e.target))}
        onMouseLeave={() => setHover(null)}
        onBlur={() => setHover(null)}
        onClick={(e) => {
          const i = indexOf(e.target);
          if (i != null) onOpen(i);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            const i = Math.max(0, Math.min(rounds.length - 1, sel + (e.key === "ArrowLeft" ? -1 : 1)));
            setSel(i);
            setHover(i);
          } else if (e.key === "Enter") onOpen(sel);
          else if (e.key === "Escape") setHover(null);
        }}
      >
        {chapters.map((c, k) => {
          const x0 = L + g.step * c.from;
          const x1 = L + g.step * (c.to + 1);
          const wide = x1 - x0 > 70;
          const r0 = rounds[c.from]!;
          const r1 = rounds[c.to]!;
          return (
            <g key={c.no}>
              {k % 2 === 1 ? <rect x={x0} y={top - 8} width={x1 - x0} height={g.bottom - top - 14} fill="#0c1220" /> : null}
              {k ? <line x1={x0} x2={x0} y1={6} y2={g.bottom - 22} stroke="#243048" strokeDasharray="3 4" /> : null}
              <text className={r.chapT} x={x0 + 6} y={18}>
                {c.no}
                {wide ? ` · ${date(r0.startMs)}` : ""}
              </text>
              {wide ? (
                <text x={x0 + 6} y={34}>
                  {r0.label}
                  {r1 !== r0 ? `–${r1.label.replace(/^#/, "")}` : ""}
                </text>
              ) : null}
            </g>
          );
        })}
        {niceTicks(g.maxC, 3).map((v) => (
          <g key={v}>
            <line x1={L} x2={g.W - R} y1={g.yC(v)} y2={g.yC(v)} stroke="#141c2c" />
            <text x={L - 8} y={g.yC(v) + 4} textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        <text x={L - 8} y={g.yK(g.maxCost) + 4} textAnchor="end">
          ${Math.round(g.maxCost / 1e8)}
        </text>
        <line x1={L} x2={g.W - R} y1={g.axis} y2={g.axis} stroke="#34425f" />
        <text x={L - 8} y={g.axis - 4} textAnchor="end">
          ▲
        </text>
        <text x={L - 8} y={g.axis + 14} textAnchor="end">
          ▼
        </text>
        <text x={L - 8} y={g.dotTop + 4} textAnchor="end">
          lanes
        </text>
        <polyline points={cumulativePoints(rounds, g, totals.closes)} fill="none" stroke="#8fb4e8" strokeOpacity={0.55} strokeWidth={1.5} />
        <text x={g.W - R + 8} y={top + 4}>
          {totals.closes}
        </text>
        <text x={g.W - R + 8} y={top + 20}>
          total
        </text>
        {rounds.map((round, i) => (
          <RoundColumn key={round.id} round={round} i={i} g={g} sel={i === sel} />
        ))}
        {rounds.map((round, i) =>
          tickRound(round, i, rounds.length) ? (
            <text key={round.id} x={g.x(i)} y={g.bottom - 6} textAnchor="middle">
              {round.label}
            </text>
          ) : null,
        )}
      </svg>
      {hover != null && rounds[hover] ? <Readout round={rounds[hover]!} cx={g.x(hover) + 8} wrapWidth={width + 16} /> : null}
    </div>
  );
}
