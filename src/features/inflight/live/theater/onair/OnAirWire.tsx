"use client";

// THE WIRE — the newest events as the desk's table rows with pill verdicts. A row enters once, and
// only when its event ARRIVED while the screen watched (`arrivedKeys`); rows older than 15 minutes dim.
// Rows that do not fit whole are dropped from the bottom (measured), never cut in half.

import { useLayoutEffect, useRef } from "react";
import { cx } from "./onairFormat";
import type { WireRow } from "./onairWireModel";
import mon from "./onairMonitor.module.css";
import styles from "./onairWall.module.css";

export function OnAirWire({ rows, heard, live, className }: { rows: readonly WireRow[]; heard: string; live: boolean; className: string }) {
  const listRef = useRef<HTMLDivElement>(null);
  const sig = rows.map((r) => r.key).join("~");

  useLayoutEffect(() => {
    const wl = listRef.current;
    if (!wl) return;
    const trim = () => {
      const kids = [...wl.children] as HTMLElement[];
      for (const k of kids) k.hidden = false;
      for (let i = kids.length - 1; i > 0 && wl.scrollHeight > wl.clientHeight + 1; i--) kids[i]!.hidden = true;
    };
    trim();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(trim);
    ro.observe(wl);
    return () => ro.disconnect();
  }, [sig]);

  return (
    <div className={cx(mon.mon, className)} data-role="onair-mon" data-kind="wire" aria-label="Wire: newest events">
      <div className={mon.tab} data-role="onair-tab">
        <span className={mon.tally} data-tone={live ? "green" : "grey"} />
        <b className={mon.tag} data-role="onair-tag">
          WIRE
        </b>
        <span className={mon.src}>newest events · local time</span>
      </div>
      <div ref={listRef} className={styles.wl}>
        {rows.length === 0 ? <div className={cx(styles.we, styles.weNone)}>No event yet</div> : null}
        {rows.map((r) => (
          <div key={r.key} className={cx(styles.we, r.fresh && styles.weNew, r.old && styles.old)} data-tone={r.tone} data-role="onair-wire-row">
            <span className={styles.wt}>{r.time}</span>
            <span className={styles.wk} data-role="onair-wire-kind">
              {r.word}
            </span>
            <span className={styles.wh} title={r.headline}>
              {r.headline}
            </span>
          </div>
        ))}
      </div>
      <div className={mon.nosig}>
        <b>NO SIGNAL</b>
        <span>{heard}</span>
      </div>
    </div>
  );
}
