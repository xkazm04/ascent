"use client";

// reverse-chronology-semantics: the four decisions as controls. Which time orders the feed (event
// vs arrival — switch it and watch the late row move to where THAT key puts it); the total order
// (the tuple comparator vs a timestamp-only one — refetch shuffles delivery order and counts the rows
// that swapped); who mints the key (an optimistic note waits in a pending strip until the server
// assigns its seq); and how time reads (relative label, absolute on hover, day dividers from the
// same helper on the scene's one UTC clock).

import type { OrderKey } from "./feedOrder";
import type { Action, Comparator, State } from "./feedStore";
import { BTN, BTN_ON, Readout, Region } from "./sceneParts";

const KEYS: { key: OrderKey; label: string }[] = [
  { key: "event", label: "event time" },
  { key: "arrival", label: "arrival time" },
];
const COMPARATORS: { c: Comparator; label: string }[] = [
  { c: "tuple", label: "(ts desc, seq desc)" },
  { c: "timestamp", label: "ts desc only" },
];

export function ChronologyRegion({ s, dispatch }: { s: State; dispatch: (a: Action) => void }) {
  return (
    <Region technique="reverse-chronology-semantics" title="Newest first is four decisions" note="One ordering key, one total order, one authority for the key, one clock for the labels.">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Ordering key">
          <span className="type-caption text-slate-500">order by</span>
          {KEYS.map((k) => (
            <button key={k.key} type="button" className={s.key === k.key ? BTN_ON : BTN} aria-pressed={s.key === k.key} onClick={() => dispatch({ type: "key", key: k.key })}>
              {k.label}
            </button>
          ))}
          <button type="button" className={BTN} onClick={() => dispatch({ type: "arrive", count: 1, late: true })}>
            late arrival (happened earlier, arrives now)
          </button>
        </div>
        <p className="type-caption text-slate-500">
          Under event time the late row assembles the past at its true position (and counts as unseen if it lands above the anchor); under arrival time it sits at the head — say so, because readers assume event time. The cursor and both anchors switch with the key.
        </p>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Comparator">
          <span className="type-caption text-slate-500">comparator</span>
          {COMPARATORS.map((c) => (
            <button key={c.c} type="button" className={s.comparator === c.c ? BTN_ON : BTN} aria-pressed={s.comparator === c.c} onClick={() => dispatch({ type: "comparator", comparator: c.c })}>
              {c.label}
            </button>
          ))}
          <button type="button" className={BTN} onClick={() => dispatch({ type: "arrive", count: 12, sync: true })}>
            sync burst ×12 (one second)
          </button>
          <button type="button" className={BTN} onClick={() => dispatch({ type: "refetch" })}>
            refetch (shuffle delivery order)
          </button>
        </div>
        <Readout label="rows that swapped across the refetch" value={<span data-swaps={s.swaps}>{s.swaps}</span>} tone={s.swaps > 0 ? "text-danger" : "text-success-soft"} />
        <p className="type-caption text-slate-500">
          A burst shares one second. The tuple comparator is a total order, so a refetch renders the same sequence; timestamp-only lets the stable sort fall to delivery order at every tie.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={BTN} onClick={() => dispatch({ type: "post" })} disabled={s.pending !== null}>
            post a note (optimistic)
          </button>
          <span className="type-caption text-slate-500">The renderer&apos;s clock never ranks: the note waits outside the list until the server assigns (ts, seq).</span>
        </div>
      </div>
    </Region>
  );
}
