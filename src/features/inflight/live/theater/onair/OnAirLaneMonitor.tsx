// A LANE MONITOR — PGM or PVW: the head (tally, tag, repo · cycle, arm or file count), the camera, the
// tape of the newest events, the lower third; or, with no lane in the slot, the reason it is empty.
// Over it: the landing slate (a cue — see onairWireModel.ts), the cut wipe (PGM), and NO SIGNAL when stale.

import type { BlankCard } from "./onairBlank";
import type { LaneMonitorView, MonitorTone } from "./onairLaneModel";
import type { Slate } from "./onairWireModel";
import { cx, plural } from "./onairFormat";
import { OnAirCamera } from "./OnAirCamera";
import { OnAirLowerThird } from "./OnAirLowerThird";
import styles from "./onairMonitor.module.css";

export interface LaneMonitorProps {
  kind: "pgm" | "pvw";
  tag: string;
  slotClass: string;
  view: LaneMonitorView | null;
  blank: BlankCard;
  slate: Slate | null;
  /** "Last heard 42 s ago · frame as of 14:08:46" — shown only when the wall is stale. */
  heard: string;
  cuts?: number;
  reducedMotion: boolean;
}

function Tape({ view }: { view: LaneMonitorView }) {
  return (
    <div className={cx(styles.tape, styles.dim, styles.hide)}>
      {view.tape.length === 0 ? <div className={cx(styles.ev, styles.evNone)}>{view.tapeEmpty}</div> : null}
      {view.tape.map((e) => (
        <div key={e.key} className={cx(styles.ev, e.fresh && styles.evNew)}>
          <span className={styles.tt}>{e.time}</span>
          <span className={cx(styles.tool, styles[`k-${e.tone}`])}>{e.tool}</span>
          {e.isNote ? <i>“{e.text}”</i> : <span className={styles.tp}>{e.text}</span>}
        </div>
      ))}
    </div>
  );
}

function Blank({ card }: { card: BlankCard }) {
  return (
    <div className={styles.blank}>
      <b data-tone={card.tone}>{card.big}</b>
      {card.lines[0] ? <span>{card.lines[0]}</span> : null}
      {card.lines[1] ? <span className={styles.u}>{card.lines[1]}</span> : null}
      {card.foot ? <small>{card.foot}</small> : null}
    </div>
  );
}

export function OnAirLaneMonitor({ kind, tag, slotClass, view, blank, slate, heard, cuts = 0, reducedMotion }: LaneMonitorProps) {
  const tone: MonitorTone = view ? view.tone : blank.tone;
  return (
    <div className={cx(styles.mon, slotClass)} data-role="onair-mon" data-kind={kind} data-tone={tone} data-blank={view ? undefined : ""} aria-label={view ? `${tag}: ${view.repo}` : tag}>
      <div className={styles.tab} data-role="onair-tab">
        <span className={styles.tally} data-tone={tone} />
        <b className={styles.tag} data-role="onair-tag">
          {tag}
        </b>
        {view ? (
          <>
            <span className={styles.src}>
              {view.repo}
              <span className={styles.cyc}> · cycle {view.cycle}</span>
            </span>
            <span className={styles.arm}>
              {kind === "pvw" ? `${plural(view.files, "FILE", "FILES")} · ${view.edited} EDITED` : view.arm ? `ARM ${view.arm}` : ""}
            </span>
          </>
        ) : (
          <span className={styles.src}>{blank.src}</span>
        )}
      </div>
      {view ? (
        <>
          <OnAirCamera view={view} reducedMotion={reducedMotion} className={cx(styles.dim, styles.hide)} />
          <Tape view={view} />
          <OnAirLowerThird view={view} reducedMotion={reducedMotion} className={cx(styles.dim, styles.hide)} />
        </>
      ) : (
        <Blank card={blank} />
      )}
      {view && slate ? (
        <div key={slate.id} className={cx(styles.slate, !reducedMotion && styles.slateIn)} role="status">
          <b>LANDED</b>
          <span>{slate.headline}</span>
          {slate.label ? <em>verified close · {slate.label}</em> : null}
        </div>
      ) : null}
      <div className={styles.nosig}>
        <b>NO SIGNAL</b>
        <span>{heard}</span>
      </div>
      {kind === "pgm" ? <div key={cuts} className={cx(styles.wipe, cuts > 0 && !reducedMotion && styles.wipeGo)} /> : null}
    </div>
  );
}
