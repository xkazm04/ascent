"use client";

// read-position-and-unseen: an ANCHOR is stored, the count is derived. Two anchors, two jobs: the
// entry snapshot is frozen at mount and renders the "since you last looked" divider; the stored
// anchor advances on "mark all read" (anchor-set-to-head, idempotent — a second click writes nothing)
// and on the heartbeat that a crash-safe surface would run. Compute the delta against the store and
// the heartbeat erases it — the flash-then-zero bug; compute it against the snapshot and it cannot.
// The badge carries its predicate: the filter chips re-scope the list AND the count together.

import { absolute } from "./feedOrder";
import type { Action, Filter, State } from "./feedStore";
import { BTN, BTN_ON, Readout, Region } from "./sceneParts";
import { badgeLabel, type Derived } from "./useFeed";

const FILTERS: { f: Filter; label: string }[] = [
  { f: "all", label: "all kinds" },
  { f: "security", label: "security only" },
];

export function ReadRegion({ s, d, dispatch }: { s: State; d: Derived; dispatch: (a: Action) => void }) {
  const scope = s.filter === "all" ? "all kinds" : "security only";
  return (
    <Region technique="read-position-and-unseen" title="An anchor, not a counter" note="Seen means: the surface was opened and the reader marked it read — chosen once, stated here, held.">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-divider px-3 py-1 type-caption text-slate-300" data-badge={d.unseen}>
            <span className="rounded-full bg-accent px-1.5 py-px tabular-nums text-on-accent">{badgeLabel(d.unseen)}</span>
            unseen · {scope}
          </span>
          <span className="type-caption text-slate-500" data-since-entry={d.sinceEntry}>
            {d.sinceEntry} since you last looked ({scope})
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Feed filter">
          {FILTERS.map((x) => (
            <button key={x.f} type="button" className={s.filter === x.f ? BTN_ON : BTN} aria-pressed={s.filter === x.f} onClick={() => dispatch({ type: "filter", filter: x.f })}>
              {x.label}
            </button>
          ))}
          <button type="button" className={BTN} onClick={() => dispatch({ type: "markRead" })}>
            mark all read
          </button>
          <button type="button" className={BTN} onClick={() => dispatch({ type: "markRead" })} aria-label="Heartbeat: advance the stored anchor">
            heartbeat
          </button>
        </div>
        <Readout label="stored anchor" value={<span data-stored={`${s.stored.ts}:${s.stored.seq}`}>{`${absolute(s.stored.ts).slice(0, 16)} · seq ${s.stored.seq}`}</span>} />
        <Readout label="entry anchor (frozen)" value={`${absolute(s.entry.ts).slice(0, 16)} · seq ${s.entry.seq}`} />
        <Readout label="anchor writes" value={<span data-writes={s.writes}>{s.writes}</span>} />
        <p className="type-caption text-slate-500">
          The badge is a comparison over occurrences (held buffer included) — it cannot drift, only lag. Display caps at {badgeLabel(100)}; the derivation stays exact. Zero is a claim: a late arrival above the anchor counts, because the test is the tuple, not a remembered head.
        </p>
      </div>
    </Region>
  );
}
