"use client";

// feed-retention: the contract, declared where the feed is created and readable here — an age bound
// composed with a per-actor floor, parameters as settings, the reaper NAMED and invoked on every insert
// over settled rows only. The horizon is visible: the list's edge says "showing the last N days" with
// the archive named; paging past the horizon yields a truncation marker, never an empty page; an
// anchor older than the horizon forfeits — and the forfeit is counted and said.

import { absolute } from "./feedOrder";
import { HORIZON_CHOICES, REAPER } from "./feedRetention";
import type { Action, State } from "./feedStore";
import { BTN, BTN_ON, Readout, Region } from "./sceneParts";
import type { Derived } from "./useFeed";

export function RetentionRegion({ s, d, dispatch }: { s: State; d: Derived; dispatch: (a: Action) => void }) {
  return (
    <Region technique="feed-retention" title="Retention is declared" note="Age bound × per-actor floor, settled rows only. The edge of history renders as an edge.">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Retention horizon">
          <span className="type-caption text-slate-500">horizon</span>
          {HORIZON_CHOICES.map((days) => (
            <button key={days} type="button" className={s.retention.horizonDays === days ? BTN_ON : BTN} aria-pressed={s.retention.horizonDays === days} onClick={() => dispatch({ type: "horizon", days })}>
              {days} days
            </button>
          ))}
          <span className="type-caption text-slate-500">· floor: newest {s.retention.floorPerActor} per actor</span>
        </div>
        <Readout label="reaper" value={<span className="text-slate-300">{REAPER}</span>} />
        <Readout label="reaped so far" value={<span data-reaped={s.reapedTotal}>{s.reapedTotal.toLocaleString("en-US")}</span>} />
        <Readout label="retained / horizon at" value={<span data-retained={s.server.length}>{`${s.server.length.toLocaleString("en-US")} / ${absolute(d.horizonTs).slice(0, 10)}`}</span>} />
        <Readout label="oldest retained" value={d.oldestKeptTs === null ? "—" : absolute(d.oldestKeptTs).slice(0, 10)} />
        <Readout label="last history page" value={<span data-page={s.lastPage ? (s.lastPage.truncated ? "truncated" : "rows") : "none"}>{s.lastPage ? `${s.lastPage.rows} rows${s.lastPage.truncated ? " · truncation marker" : ""}` : "—"}</span>} />
        {s.forfeited > 0 ? (
          <p className="type-caption text-warn" data-forfeited={s.forfeited}>
            {s.forfeited.toLocaleString("en-US")} unseen event{s.forfeited === 1 ? "" : "s"} older than {s.retention.horizonDays} days were removed — the anchor snapped to the horizon; the badge did not pretend nothing happened.
          </p>
        ) : (
          <p className="type-caption text-slate-500" data-forfeited={0}>
            Shorten the horizon below the anchor and the surface says what the reaper took from the unseen set instead of zeroing the badge.
          </p>
        )}
        <p className="type-caption text-slate-500">
          The floor is a total-order cut (the one comparator), so a tie at the K-th row keeps exactly K. The running scan at the head is never eligible: it has not settled, so it is not history.
        </p>
      </div>
    </Region>
  );
}
