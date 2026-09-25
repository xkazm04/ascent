// THE STRIP — the station bug and the four answers, as the desk's joined answers row.
//
// The four answers are `headerModel()` — the classic theater header's own model, passed in whole — so
// the two walls cannot disagree about whether it runs, what it does, how the day goes, or what needs a
// person. The wall adds only presentation (the clock, ON AIR, the CALL ticket) and the CALL's supporting
// line (`needsDetail`: which plan waits, when a pause lifts).

import Link from "next/link";
import type { HeaderModel } from "../theaterHeaderModel";
import { cx } from "./onairFormat";
import { OnAirToday } from "./OnAirToday";
import styles from "./onairStrip.module.css";

export type OnAirState = "on" | "lost" | "off";
const ON_AIR_WORD: Record<OnAirState, string> = { on: "ON AIR", lost: "NO SIGNAL", off: "OFF AIR" };

export interface OnAirStripProps {
  model: HeaderModel;
  clockText: string;
  clockLabel: string;
  onAir: OnAirState;
  deskHref: string | null;
  todaySub: { text: string; asOf: boolean } | null;
  /** The CALL corner's supporting line (the wall decides it: detail, "as of", or the all-clear). */
  needsLine: string;
  needsHref: string | null;
}

/** "kp · Editing" → the repo bold, the phase dim (the prototype's NOW headline), when it is a lane. */
function NowHeadline({ headline, live }: { headline: string; live: boolean }) {
  const i = headline.indexOf(" · ");
  if (!live || i < 0) return <>{headline}</>;
  return (
    <>
      <b>{headline.slice(0, i)}</b> <span>{headline.slice(i + 3)}</span>
    </>
  );
}

export function OnAirStrip({ model, clockText, clockLabel, onAir, deskHref, todaySub, needsLine, needsHref }: OnAirStripProps) {
  const { running, now, needs } = model;
  const nowSub = [now.path, now.sub].filter(Boolean).join("  ·  ");
  const call = needs.amber;
  const needsBody = (
    <>
      <div className={styles.k}>
        <span className={styles.callt}>CALL</span>Needs you
      </div>
      <div className={styles.h} data-role="onair-answer-h">
        {needs.headline}
      </div>
      <div className={styles.s}>{needsLine}</div>
    </>
  );
  const needsClass = cx(styles.cell, call ? styles.call : styles.ok);
  return (
    <header className={styles.strip} data-role="onair-strip" aria-label="The four answers">
      <div className={styles.cell}>
        <div className={styles.brand} aria-label="Ascent Live">
          <span>ASCENT</span>
          <span className={styles.sep}>·</span>
          <span className={styles.lv}>LIVE</span>
        </div>
        <div className={styles.clock} data-testid="onair-clock">
          {clockText}
        </div>
        <div className={styles.clockk}>{clockLabel}</div>
        <div className={styles.bugrow}>
          <div className={styles.onair} data-role="onair-onair" data-state={onAir}>
            <span className={styles.lamp} />
            <span>{ON_AIR_WORD[onAir]}</span>
          </div>
          {deskHref ? (
            <Link className={styles.desk} href={deskHref} title="Back to the desk">
              ↩ Desk
            </Link>
          ) : null}
        </div>
      </div>
      <section className={styles.cell} data-role="onair-answer" data-tone={running.tone} aria-label="Running?">
        <div className={styles.k}>Running?</div>
        <div className={styles.h} data-role="onair-answer-h">
          {running.headline}
        </div>
        <div className={styles.s}>{running.sub ?? ""}</div>
      </section>
      <section className={styles.cell} data-role="onair-answer" data-tone={now.tone} aria-label="Now">
        <div className={styles.k}>Now</div>
        <div className={cx(styles.h, styles.nowH)} data-role="onair-answer-h">
          <NowHeadline headline={now.headline} live={now.tone === "live"} />
        </div>
        <div className={cx(styles.s, styles.mono)}>{nowSub}</div>
      </section>
      <OnAirToday today={model.today} sub={todaySub} />
      {call && needsHref ? (
        <Link className={needsClass} href={needsHref} data-role="onair-answer" data-call aria-label="Needs you" title="Open it in the ledger">
          {needsBody}
        </Link>
      ) : (
        <section className={needsClass} data-role="onair-answer" data-call={call || undefined} aria-label="Needs you">
          {needsBody}
        </section>
      )}
    </header>
  );
}
