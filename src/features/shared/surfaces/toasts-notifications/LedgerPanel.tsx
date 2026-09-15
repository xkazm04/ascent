"use client";

// durable-notification-ledger: the desk's stable navigation with the bell, and the center behind it.
// The badge is derived from the rows under one named predicate (unread) — it cannot drift from the
// list. Opening the center marks NOTHING read; viewing an entry does. Obligations are pinned apart
// and survive "mark all read"; the reaper's rules are printed beside what it has reaped.

import type { Desk } from "./useDesk";
import { type Entry, RETENTION, badge, sections } from "./ledger";
import { BTN, BTN_ON, Readout, Region } from "./sceneParts";
import { slotsFor } from "./severity";

export function LedgerRegion({ desk }: { desk: Desk }) {
  const { state, dispatch } = desk;
  const b = badge(state.ledger);
  const { obligations, news } = sections(state.ledger);
  const open = state.centerOpen;
  return (
    <Region technique="durable-notification-ledger" title="The fact behind the announcement" note="Every message that matters has a durable twin with the SAME identity. Acting on either clears both; the badge states its predicate.">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-divider px-2 py-1.5" role="navigation" aria-label="Desk navigation">
        <span className="type-caption text-slate-400">Fleet · Scans · Billing</span>
        <button type="button" className={`${open ? BTN_ON : BTN} relative`} onClick={() => dispatch({ type: "center:toggle" })} aria-expanded={open} aria-label={`Notification center, ${b.count} ${b.predicate}`}>
          🔔 center
          <span className={`ml-1 rounded-full px-1.5 font-mono tabular-nums ${b.count ? "bg-accent text-on-accent" : "bg-divider text-slate-500"}`} data-badge={b.count} data-predicate={b.predicate}>
            {b.count}
          </span>
        </button>
      </div>
      <p className="mt-1 type-micro text-slate-500">badge = count of rows where read is false — derived on every render, never incremented at a call site. Zero is one visit away.</p>

      {open ? (
        <div className="mt-2 space-y-2" data-center>
          <div className="flex items-center justify-between">
            <span className="type-caption text-slate-400">{obligations.length} obligations · {news.length} news</span>
            <button type="button" className={BTN} onClick={() => dispatch({ type: "ledger:read-all" })}>
              mark all read
            </button>
          </div>
          {obligations.length ? <p className="type-micro text-warn">Obligations — pinned; leave only by action or your explicit dismissal.</p> : null}
          <ul className="space-y-1" data-obligations>
            {obligations.map((e) => (
              <Row key={e.id} e={e} desk={desk} />
            ))}
          </ul>
          {news.length ? <p className="type-micro text-slate-500">News — newest first; same-key repeats are one fact with a count.</p> : null}
          <ul className="space-y-1" data-news>
            {news.map((e) => (
              <Row key={e.id} e={e} desk={desk} />
            ))}
          </ul>
          {state.ledger.length === 0 ? <p className="type-caption text-slate-600">Nothing on the record yet. Successes and info stay out unless they were awaited.</p> : null}
        </div>
      ) : null}

      <div className="mt-3 space-y-1">
        <Readout label="reaper" value={`read news ${RETENTION.readAwarenessMs / 1000}s · unread ${RETENTION.unreadAwarenessMs / 1000}s · obligations never · cap ${RETENTION.cap}`} />
        <Readout label="reaped so far" value={<span data-reaped={state.reaped}>{state.reaped}</span>} />
      </div>
    </Region>
  );
}

function Row({ e, desk }: { e: Entry; desk: Desk }) {
  const { dispatch } = desk;
  const slots = slotsFor(e.severity);
  return (
    <li className={`flex items-start gap-2 rounded-md border px-2 py-1 ${e.read ? "border-divider" : "border-accent/40 bg-accent/5"}`} data-entry={e.id} data-read={e.read} data-resolved={e.resolved} data-count={e.count}>
      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${e.read ? "bg-divider" : "bg-accent"}`} aria-hidden />
      <button type="button" className="focus-ring min-w-0 flex-1 text-left" onClick={() => dispatch({ type: "ledger:read", id: e.id })} aria-label={`View: ${e.title}`}>
        <span className={`block truncate type-caption ${slots.text}`}>
          {e.title}
          {e.count > 1 ? <span className="ml-1 font-mono tabular-nums text-slate-400">×{e.count}</span> : null}
        </span>
        <span className="block type-micro text-slate-500">
          {e.severity} · {e.read ? "read" : "unread"} · {e.resolved ? "resolved" : e.actionRequired ? "unresolved" : "news"} · t+{(e.lastAt / 1000).toFixed(1)}s
        </span>
      </button>
      {e.verb && !e.resolved && e.verb !== "Undo" ? (
        <button type="button" className={BTN} onClick={() => dispatch({ type: "ledger:act", id: e.id })} aria-label={`${e.verb} from the ledger: ${e.title}`}>
          {e.verb}
        </button>
      ) : null}
    </li>
  );
}
