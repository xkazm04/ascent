"use client";

// The rows of the feed: day dividers and the "new since you last looked" divider (both derived from
// the same tuple the order uses), single occurrences, and cluster rows — a summary WITH its predicate
// (relation · count · span) that shows its worst member's outcome and discloses the run in place.
// Entrances are identity-keyed (a row that has entered once never re-animates on a refetch) and only
// play within the first viewport; under `reduced` every row appears settled.

import { motion } from "framer-motion";
import { absolute, dayBucket, newerThan, relative, rowKey, rowTs, type FeedRow, type OrderKey, type Tuple } from "./feedOrder";
import { textOf, type Occurrence } from "./fixtures";
import { BTN } from "./sceneParts";

export const ANIMATED_DEPTH = 12;

type Props = {
  rows: FeedRow[];
  orderKey: OrderKey;
  now: number;
  entry: Tuple;
  stored: Tuple;
  expanded: readonly string[];
  entered: ReadonlySet<string>;
  reduced: boolean;
  onExpand: (id: string) => void;
};

function Row({ o, orderKey, now, stored, className = "" }: { o: Occurrence; orderKey: OrderKey; now: number; stored: Tuple; className?: string }) {
  const ts = orderKey === "event" ? o.eventAt : o.arrivedAt;
  const unseen = newerThan(o, stored, orderKey);
  const alarm = o.kind === "scan-failed" || o.kind === "security";
  return (
    <div className={`flex items-baseline justify-between gap-3 ${className}`} data-row={o.id} data-unseen={unseen} data-settled={o.settled}>
      <span className="min-w-0 truncate type-body-sm">
        <span className={`mr-2 inline-block h-1.5 w-1.5 rounded-full align-middle ${unseen ? "bg-accent" : "bg-transparent"}`} aria-hidden />
        <span className={alarm ? "text-danger" : o.settled ? "text-slate-300" : "text-slate-500"}>{textOf(o)}</span>
        {o.warn ? <span className="ml-1 text-warn">warning</span> : null}
      </span>
      <time className="shrink-0 type-caption tabular-nums text-slate-500" dateTime={new Date(ts).toISOString()} title={absolute(ts)} aria-label={absolute(ts)}>
        {relative(ts, now)}
      </time>
    </div>
  );
}

function Cluster({ c, open, onExpand, ...rest }: { c: Extract<FeedRow, { type: "cluster" }>; open: boolean; onExpand: (id: string) => void; orderKey: OrderKey; now: number; stored: Tuple }) {
  const unseenMembers = c.members.filter((m) => newerThan(m, rest.stored, rest.orderKey)).length;
  const span = `${absolute(c.oldest).slice(11, 16)}–${absolute(c.newest).slice(11, 16)}`;
  return (
    <div data-cluster={c.id} data-members={c.members.length} data-open={open}>
      <div className="flex items-baseline justify-between gap-3">
        <button type="button" className="focus-ring min-w-0 truncate text-left type-body-sm" aria-expanded={open} onClick={() => onExpand(c.id)}>
          <span className={`mr-2 inline-block h-1.5 w-1.5 rounded-full align-middle ${unseenMembers ? "bg-accent" : "bg-transparent"}`} aria-hidden />
          <span className="text-slate-300">
            {c.relation.split(":")[0]} · synced <span className="tabular-nums">{c.members.length}</span> repos
          </span>
          <span className="ml-1 text-slate-500">· {span}</span>
          {c.warn ? <span className="ml-1 text-warn">{c.warn} warning{c.warn === 1 ? "" : "s"}</span> : null}
          <span className="ml-1 text-slate-600">{open ? "▾" : "▸"}</span>
        </button>
        <time className="shrink-0 type-caption tabular-nums text-slate-500" title={absolute(c.newest)}>
          {relative(c.newest, rest.now)}
        </time>
      </div>
      {open ? (
        <div className="ml-4 mt-1 space-y-1 border-l border-divider pl-3">
          {c.members.map((m) => (
            <Row key={m.id} o={m} {...rest} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function FeedRows({ rows, orderKey, now, entry, stored, expanded, entered, reduced, onExpand }: Props) {
  let lastDay = "";
  let dividerDone = false;
  return (
    <ol className="space-y-1.5">
      {rows.map((r, i) => {
        const ts = rowTs(r, orderKey);
        const day = dayBucket(ts, now);
        const dayDivider = day !== lastDay ? day : null;
        lastDay = day;
        const isNew = ts > entry.ts || (ts === entry.ts && (r.type === "row" ? r.o.seq : r.members[0].seq) > entry.seq);
        const sinceDivider = !dividerDone && !isNew;
        if (sinceDivider) dividerDone = true;
        const key = rowKey(r);
        const enters = !reduced && i < ANIMATED_DEPTH && !entered.has(key);
        return (
          <motion.li key={key} data-entered={enters ? "now" : "settled"} initial={enters ? { opacity: 0, y: -8 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24 }}>
            {dayDivider ? <div className="mb-1 mt-2 type-label tracking-widest text-slate-600">{dayDivider}</div> : null}
            {sinceDivider ? (
              <div className="mb-1.5 flex items-center gap-2 type-caption text-accent-soft" data-divider="since-last-look">
                <span className="h-px flex-1 bg-accent/40" aria-hidden />
                new since you last looked ends here
                <span className="h-px flex-1 bg-accent/40" aria-hidden />
              </div>
            ) : null}
            {r.type === "row" ? <Row o={r.o} orderKey={orderKey} now={now} stored={stored} /> : <Cluster c={r} open={expanded.includes(r.id)} onExpand={onExpand} orderKey={orderKey} now={now} stored={stored} />}
          </motion.li>
        );
      })}
    </ol>
  );
}

export function PendingStrip({ o, onConfirm }: { o: Occurrence; onConfirm: () => void }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3 rounded-md border border-dashed border-slate-700 px-2 py-1" data-pending>
      <span className="type-caption text-slate-400">pending · {textOf(o)} · no key yet (the renderer's clock does not rank)</span>
      <button type="button" className={BTN} onClick={onConfirm}>
        server confirms
      </button>
    </div>
  );
}
