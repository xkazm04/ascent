"use client";

// TODAY on the strip: verified · landed as big mono figures, money used against the ceiling, and one
// line under it — "as of …" when the feed is stale, or the close that just landed. The figures are
// `headerModel().today`, the classic header's. A figure flips in only when it CHANGED while the screen
// watched (never on the first paint, never on a reload).

import { useState } from "react";
import { TODAY_PREDICATES, type HeaderModel } from "../theaterHeaderModel";
import { cx } from "./onairFormat";
import styles from "./onairStrip.module.css";

/** True once `value` has changed since mount — state derived from a changed prop, no effect. */
function useChanged(value: string): boolean {
  const [seen, setSeen] = useState({ value, changed: false });
  if (seen.value !== value) {
    const next = { value, changed: true };
    setSeen(next);
    return true;
  }
  return seen.changed;
}

function Figure({ value, verified, title }: { value: string; verified?: boolean; title: string }) {
  const changed = useChanged(value);
  return (
    <b key={value} className={cx(styles.num, verified && styles.v, changed && styles.flip)} title={title}>
      {value}
    </b>
  );
}

export function OnAirToday({ today, sub }: { today: HeaderModel["today"]; sub: { text: string; asOf: boolean } | null }) {
  const money = today.spend ? `${today.spend}${today.ceiling ? ` of ${today.ceiling}` : " · no ceiling"}` : "";
  return (
    <section className={styles.cell} data-role="onair-answer" aria-label="Today">
      <div className={styles.k}>Today</div>
      <div className={styles.todayH} data-role="onair-answer-h">
        <Figure value={today.verified} verified title={TODAY_PREDICATES.verified} /> verified
        <span className={styles.sep}>·</span>
        <Figure value={today.landed} title={TODAY_PREDICATES.landed} /> landed
      </div>
      <div className={styles.money} title={TODAY_PREDICATES.spend}>
        <span className={styles.mk}>Money used</span>
        <span className={styles.mv}>{money}</span>
      </div>
      <div className={styles.bar} data-hot={today.ratio != null && today.ratio >= 0.9 ? "" : undefined}>
        <i style={{ width: today.ratio != null ? `${(today.ratio * 100).toFixed(1)}%` : "0" }} />
      </div>
      <div className={styles.tsub} data-asof={sub?.asOf ? "" : undefined}>
        {sub?.text ?? ""}
      </div>
    </section>
  );
}
