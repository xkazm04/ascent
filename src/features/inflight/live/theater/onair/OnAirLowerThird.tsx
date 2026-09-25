// THE LOWER THIRD — the desk's lane row, scaled for the room: repo, phase words, the six-step stage
// track (so a lane reads the same on both halves), the file it touches NOW (or touched LAST), and the
// figures: time used of the watchdog ceiling (a clock, never work done), money, the diff, turns.

import type { LaneMonitorView } from "./onairLaneModel";
import { cx } from "./onairFormat";
import { STAGE_STEPS, STAGE_WORD, stageIndex } from "./onairStages";
import styles from "./onairMonitor.module.css";

function StageTrack({ stage }: { stage: LaneMonitorView["stage"] }) {
  const at = stageIndex(stage);
  return (
    <span className={styles.stages}>
      {STAGE_STEPS.map((k, i) => {
        const state = i < at ? "done" : i === at ? "on" : undefined;
        return (
          <span key={k} className={styles.stg} data-state={state} data-land={state === "on" && k === "land" ? "" : undefined} data-role={state === "on" ? "onair-stage-on" : "onair-stage"}>
            {STAGE_WORD[k]}
          </span>
        );
      })}
    </span>
  );
}

export function OnAirLowerThird({ view, reducedMotion, className }: { view: LaneMonitorView; reducedMotion: boolean; className?: string }) {
  const flip = view.phaseFlip && !reducedMotion;
  return (
    <div className={cx(styles.l3, className)} data-stage={view.stage} data-role="onair-l3">
      <div className={styles.l3a}>
        {view.org ? <span className={styles.org}>{view.org}</span> : null}
        <span className={styles.repo} data-role="onair-l3-repo">
          {view.name}
        </span>
        <span key={view.phase} className={cx(styles.ph, styles[`s-${view.stage}`], flip && styles.phFlip)}>
          {view.phaseWords}
        </span>
        <StageTrack stage={view.stage} />
      </div>
      <div className={styles.path}>
        <span className={styles.pk}>{view.active ? "NOW" : "LAST"}</span>
        {view.path ?? <span style={{ color: "var(--dim)" }}>no file yet</span>}
      </div>
      <div className={styles.l3b}>
        <span>
          <em>TIME USED</em>
          {view.used ?? "—"}
          {view.total ? <s> / {view.total}</s> : null}
          {view.frac != null ? (
            <span className={styles.tbar} title="Time used of the lane's watchdog ceiling — a clock, not work done">
              <i style={{ width: `${(view.frac * 100).toFixed(1)}%` }} />
            </span>
          ) : null}
        </span>
        <span>
          {view.cost == null ? (
            <s>$ not recorded</s>
          ) : (
            <>
              {view.cost} <s className={styles.xs}>so far</s>
            </>
          )}
        </span>
        <span>
          {view.diff ? (
            <>
              <b className={styles.plus}>+{view.diff.plus}</b> <b className={styles.minus}>−{view.diff.minus}</b>{" "}
              <s className={styles.xs}>
                {view.diff.files} file{view.diff.files === 1 ? "" : "s"}
              </s>
            </>
          ) : (
            <s>no diff yet</s>
          )}
        </span>
        <span className={styles.xs}>
          {view.turns ?? "—"} <s>turns</s>
        </span>
      </div>
    </div>
  );
}
