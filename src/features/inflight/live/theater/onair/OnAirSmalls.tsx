// THE SMALL MONITORS — every repo of the fleet the big monitors have no room for, one card each:
// a tally, the repo, one state word and one line. Stale → each says NO SIGNAL and when it last heard.

import type { CSSProperties } from "react";
import type { SmallItem } from "./onairSmallsModel";
import mon from "./onairMonitor.module.css";
import styles from "./onairWall.module.css";

export function OnAirSmalls({ items, cols, stale, heardShort }: { items: readonly SmallItem[]; cols: number; stale: boolean; heardShort: string }) {
  if (items.length === 0) return null;
  return (
    <section className={styles.smalls} style={{ "--cols": cols } as CSSProperties} aria-label="Every other repo of the fleet">
      {items.map((it) => (
        <div key={it.repo} className={styles.sm} data-tone={it.tone} data-role="onair-small" title={it.repo}>
          <div className={styles.smh}>
            <span className={mon.tally} data-tone={stale ? "grey" : it.tone} />
            <b>{it.name}</b>
          </div>
          <div className={styles.sms}>{it.state}</div>
          <div className={styles.smu}>{it.sub}</div>
          <div className={styles.ns}>
            NO SIGNAL<small>{heardShort}</small>
          </div>
        </div>
      ))}
    </section>
  );
}
