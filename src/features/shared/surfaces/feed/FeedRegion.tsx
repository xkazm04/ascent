"use client";

// live-prepend: the feed's viewport. At the head (within a small band) arrivals render in place; once
// the reader scrolls away they are HELD — never rendered above the viewport — and announced by a
// "N new · jump to latest" control that flushes them, scrolls to the head and re-arms follow mode.
// Arrivals are delivered per batch (one commit for a burst), deduped by identity at the merge door,
// and the seam after a dropped connection is a cursor walk newer-than the last delivered tuple; a
// failed walk is said, never rendered as a clean resume. Entrances are identity-keyed and only play
// within the first viewport.

import { useEffect, useRef, useState } from "react";
import { rowKey } from "./feedOrder";
import type { Action, State } from "./feedStore";
import { FeedRows, PendingStrip } from "./FeedRows";
import { BTN, Readout, Region } from "./sceneParts";
import type { Derived } from "./useFeed";

/** Tolerance band for "at the head": biased toward reading — a nudge of one row leaves follow mode. */
export const BAND_PX = 24;

export function FeedRegion({ s, d, dispatch, reduced }: { s: State; d: Derived; dispatch: (a: Action) => void; reduced: boolean }) {
  const viewport = useRef<HTMLDivElement>(null);
  // The identity-keyed entrance guard: ids that have already rendered. Written after commit, so a
  // refetch or a catch-up that re-delivers a known id renders it plainly.
  const [entered, setEntered] = useState<ReadonlySet<string>>(() => new Set());
  const keys = d.rows.map(rowKey);
  useEffect(() => {
    if (keys.every((k) => entered.has(k))) return;
    setEntered((prev) => new Set([...prev, ...keys]));
  }, [keys, entered]);

  const jump = () => {
    dispatch({ type: "jump" });
    if (viewport.current) viewport.current.scrollTop = 0;
  };

  return (
    <Region technique="live-prepend" title="Fleet activity" note="Newest first; no sort control exists. Scroll down, then let rows arrive: the viewport never moves.">
      <div className="relative">
        {s.held.length > 0 ? (
          <button type="button" onClick={jump} className="focus-ring absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-full bg-accent px-3 py-1 type-caption font-medium text-on-accent" data-new-pill={s.held.length}>
            {s.held.length} new · jump to latest
          </button>
        ) : null}
        <div
          ref={viewport}
          className="max-h-[26rem] overflow-y-auto rounded-lg border border-divider p-3"
          role="log"
          aria-label="Fleet activity feed"
          data-at-head={s.atHead}
          onScroll={(e) => dispatch({ type: "scroll", atHead: e.currentTarget.scrollTop <= BAND_PX })}
        >
          {!s.connected ? <p className="mb-2 type-caption text-warn">connection dropped — arrivals are accumulating on the server</p> : null}
          {s.seam === "missed" ? (
            <p className="mb-2 flex items-center justify-between gap-2 type-caption text-warn" data-seam="missed">
              connection restored — events may have been missed
              <button type="button" className={BTN} onClick={() => dispatch({ type: "reconnect", ok: true })}>
                refresh to be sure
              </button>
            </p>
          ) : null}
          {s.pending ? <PendingStrip o={s.pending} onConfirm={() => dispatch({ type: "confirm" })} /> : null}
          {d.rows.length === 0 ? <p className="type-body-sm text-slate-500">Nothing has happened here yet.</p> : null}
          <FeedRows rows={d.rows} orderKey={s.key} now={s.now} entry={s.entry} stored={s.stored} expanded={s.expanded} entered={entered} reduced={reduced} onExpand={(id) => dispatch({ type: "expand", id })} />
          <EdgeMarker s={s} dispatch={dispatch} />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={BTN} onClick={() => dispatch({ type: "arrive", count: 1 })}>
          arrive ×1
        </button>
        <button type="button" className={BTN} onClick={() => dispatch({ type: "arrive", count: 12 })}>
          burst ×12
        </button>
        {s.connected ? (
          <button type="button" className={BTN} onClick={() => dispatch({ type: "disconnect" })}>
            drop connection
          </button>
        ) : (
          <>
            <button type="button" className={BTN} onClick={() => dispatch({ type: "reconnect", ok: true })}>
              reconnect · catch-up
            </button>
            <button type="button" className={BTN} onClick={() => dispatch({ type: "reconnect", ok: false })}>
              reconnect · catch-up fails
            </button>
          </>
        )}
      </div>
      <div className="mt-2 space-y-1">
        <Readout label="reader mode" value={<span data-mode={s.atHead ? "following" : "reading"}>{s.atHead ? "at head · following" : "scrolled away · reading"}</span>} />
        <Readout label="held / flushes" value={`${s.held.length} / ${s.flushes}`} />
        <Readout label="last catch-up" value={s.catchup ? `${s.catchup.fetched} fetched · ${s.catchup.dropped} duplicate dropped` : "—"} />
      </div>
    </Region>
  );
}

/** The feed's edge: history ends HERE for a stated reason, with the archive named — never a mute stop. */
function EdgeMarker({ s, dispatch }: { s: State; dispatch: (a: Action) => void }) {
  const retained = s.server.length;
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-divider pt-2 type-caption text-slate-500" data-edge={s.lastPage?.truncated ? "truncated" : "paging"}>
      <span>
        showing the last {s.retention.horizonDays} days · {retained.toLocaleString("en-US")} retained · older rows: {s.retention.archive}
        {s.lastPage?.truncated ? " · history ends at the horizon" : ""}
      </span>
      <button type="button" className={BTN} onClick={() => dispatch({ type: "pageOlder" })} disabled={s.lastPage?.truncated === true}>
        older
      </button>
    </div>
  );
}
