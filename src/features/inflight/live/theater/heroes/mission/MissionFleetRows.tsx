// THE REST OF THE FLEET, as compact rows under the lane bands — waiting for a slot, paused (reason and
// note), resting after dry runs, finished this cycle — so the whole fleet is on one screen. No motion:
// these rows change rarely and a glance only needs to find them. And the statement the slot makes when
// no lane is at work, so an empty hero never looks like a broken one.

import { fmtDuration } from "../../theaterFormat";
import type { EmptyStatement, QueueRow, RowTone } from "./missionQueue";
import { BAND_COLUMNS, fs, TYPE } from "./missionTokens";

const DOT: Record<RowTone, string> = {
  calm: "border-2 border-slate-500 bg-transparent",
  warn: "bg-amber-400",
  good: "bg-success",
  bad: "bg-danger",
  muted: "bg-slate-600",
};
const STATUS: Record<RowTone, string> = {
  calm: "text-slate-300",
  warn: "text-amber-300",
  good: "text-success-soft",
  bad: "text-danger",
  muted: "text-slate-400",
};

export function MissionFleetRows({ rows, scale }: { rows: readonly QueueRow[]; scale: number }) {
  if (rows.length === 0) return null;
  return (
    <ul aria-label="The rest of the fleet" className="flex flex-col divide-y divide-divider rounded-xl border border-divider bg-surface-strong/40">
      {rows.map((r) => (
        <li key={r.key} data-row={r.key} className="flex min-w-0 items-center gap-[1.2vw] px-[2vw] py-[1.1vh]" style={fs(TYPE.row, scale)}>
          <span aria-hidden className={`h-[0.6em] w-[0.6em] shrink-0 rounded-full ${DOT[r.tone]}`} />
          <span className="w-[9em] shrink-0 truncate font-semibold text-white">{r.repo}</span>
          <span className={`shrink-0 ${STATUS[r.tone]}`}>{r.status}</span>
          {r.note ? <span className="min-w-0 truncate text-slate-500">{r.note}</span> : <span className="flex-1" />}
          {r.aside ? (
            <span className="ml-auto shrink-0 font-mono uppercase tracking-[0.16em] text-slate-500" style={{ fontSize: "0.66em" }}>
              {r.aside}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function MissionEmpty({ statement, scale }: { statement: EmptyStatement; scale: number }) {
  const { headline, sub, tone, wake } = statement;
  return (
    <div
      data-mission-empty
      className="grid flex-1 items-center gap-x-[2.2vw] rounded-2xl border border-dashed border-divider py-[4vh] pl-[2vw] pr-[1.6vw]"
      style={{ gridTemplateColumns: BAND_COLUMNS }}
    >
      <p className="flex items-center gap-[0.6em] font-mono uppercase tracking-[0.2em] text-slate-500" style={fs(TYPE.label, scale)}>
        <span aria-hidden className={`h-[0.8em] w-[0.8em] rounded-full ${DOT[tone]}`} />
        lanes
      </p>
      <div className="min-w-0">
        <p className="font-semibold leading-[1.05] tracking-tight text-slate-300" style={fs(TYPE.phase, scale * 0.86)}>
          {headline}
        </p>
        <p className={`mt-[0.4em] ${tone === "warn" ? "text-amber-300" : "text-slate-400"}`} style={fs(TYPE.meta, scale)}>
          {sub}
        </p>
      </div>
      {wake ? (
        <div data-wake className="flex flex-col items-end text-right">
          <span className="font-mono font-semibold tabular-nums text-white" style={fs(TYPE.diff, scale * 1.3)}>
            {wake.clock}
          </span>
          <span className="mt-[0.4em] font-mono uppercase tracking-[0.2em] text-slate-400" style={fs(TYPE.label, scale)}>
            {wake.label} · in {fmtDuration(wake.inMs)}
          </span>
        </div>
      ) : (
        <span />
      )}
    </div>
  );
}
