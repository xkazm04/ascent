// The desk's top bar: brand, org, the feed's state, search, the Live view switch and the On Air wall.
// No hooks of its own (the search is its own client island), so it carries no "use client".

import { LiveViewSwitch } from "../LiveViewSwitch";
import { DeskSearch } from "./DeskSearch";
import type { DeskCtx } from "./deskCtx";
import type { SearchHit } from "./searchModel";
import s from "./desk.module.css";

export type FeedWord = { tone: "live" | "stale" | "off"; text: string };

export function DeskHeader({ ctx, feed, index }: { ctx: DeskCtx; feed: FeedWord; index: SearchHit[] }) {
  const { slug, hrefs } = ctx;
  return (
    <header className={s.top}>
      <div className={s.brand}>
        <span>ASCENT</span>
        <span className={s.sep}>·</span>
        <span className={s.live}>LIVE</span>
      </div>
      <div className={s.org}>
        org <b>{slug}</b>
      </div>
      <span className={`${s.feedchip} ${feed.tone === "stale" ? s.stale : feed.tone === "off" ? s.off : ""}`} data-role="desk-chip" data-testid="desk-feed">
        <i />
        <span>{feed.text}</span>
      </span>
      <DeskSearch index={index} go={ctx.go} />
      <LiveViewSwitch slug={slug} current="desk" ledgerHref={hrefs.ledger} cockpitHref={hrefs.cockpit} deskHref={hrefs.desk} />
      <a className={`${s.btn} ${s.primary}`} href={hrefs.onAir} target="_blank" rel="noopener">
        On Air ↗
      </a>
    </header>
  );
}
