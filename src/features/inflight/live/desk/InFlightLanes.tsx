// 02 IN FLIGHT, the lane rows — repo, the six-step stage track, the phase and the file touched last,
// time used against the lane's deadline, $ so far. A row whose phase changed in the last two seconds
// (by the server clock) flashes once: motion tied to an event, and none under reduced motion (CSS).

import { toMs, mmss, repoShort } from "./deskFormat";
import { STAGES, STAGE_WORD, type FlightView, type LaneRow } from "./inFlightModel";
import type { LanePulse } from "@/lib/local/runner-types";
import s from "./desk.module.css";

const FLASH_MS = 2_000;

function StageTrack({ row }: { row: LaneRow }) {
  return (
    <span className={s.stages} aria-label={`stage ${row.stage < 0 ? "not started" : row.stage >= STAGES.length ? "done" : STAGES[row.stage]}`}>
      {STAGES.map((k, i) => {
        const on = i === row.stage;
        const cls = i < row.stage ? s.done : on ? `${s.on} ${row.landing ? s.land : ""}` : "";
        return (
          <span key={k} className={cls} data-role={on ? "desk-stage-on" : "desk-stage"}>
            {STAGE_WORD[k]}
          </span>
        );
      })}
    </span>
  );
}

function File({ path }: { path: string | null }) {
  if (!path) return <span className={s.faint}>no file yet</span>;
  const cut = path.lastIndexOf("/");
  return (
    <bdi>
      {path.slice(0, cut + 1)}
      <b>{path.slice(cut + 1)}</b>
    </bdi>
  );
}

export function InFlightLanes({ view, pulseLanes, stale }: { view: FlightView; pulseLanes: LanePulse[]; stale: boolean }) {
  const since = new Map(pulseLanes.map((l) => [l.laneId, toMs(l.phaseSince)]));
  return (
    <div className={s.lanes}>
      <div className={`${s.lrow} ${s.h}`}>
        <span className={s.cap}>Repo</span>
        <span className={s.cap}>Stage</span>
        <span className={s.cap}>Phase · file touched last</span>
        <span className={s.cap}>Time used</span>
        <span className={s.cap} style={{ textAlign: "right" }}>
          $ so far
        </span>
      </div>
      {view.lanes.length === 0 ? (
        <div className={s.lrow}>
          <span className={s.dim} style={{ gridColumn: "1 / -1" }}>
            No lane in flight
          </span>
        </div>
      ) : null}
      {view.lanes.map((row) => {
        const changed = since.get(row.laneId);
        const flash = !stale && changed != null && view.clock - changed < FLASH_MS;
        return (
          <div key={`${row.laneId}:${row.phase}`} className={`${s.lrow} ${flash ? s.flash : ""}`} data-testid="desk-lane">
            <span className={s.repo}>
              {repoShort(row.repo)}
              <small>c{row.cycle}</small>
            </span>
            <StageTrack row={row} />
            <span className={s.nowcol}>
              <span className={s.ph}>{row.phase}</span>
              <span className={s.file}>
                <File path={row.file} />
              </span>
            </span>
            <span className={s.tu}>
              <b>{row.usedMs != null ? mmss(row.usedMs) : "—"}</b>
              {row.frac != null ? (
                <span className={`${s.bar} ${s.time}`}>
                  <i style={{ width: `${(row.frac * 100).toFixed(1)}%` }} />
                </span>
              ) : (
                <span className={s.faint}>no deadline</span>
              )}
              {row.budgetMs != null ? mmss(row.budgetMs) : null}
            </span>
            <span className={s.cost}>{row.cost ?? <span className={s.faint}>unknown</span>}</span>
          </div>
        );
      })}
    </div>
  );
}
