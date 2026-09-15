"use client";

// pagination: the ledger's footer. All-client pages by OFFSET with a numbered pager (random access
// over a modest, snapshotted set); all-server walks by KEYSET — a cursor that is the ordering tuple of
// the last delivered row, sealed with the order it belongs to, and only ever "next" or "restart". The
// count carries its predicate, and it is a bound ("50+") when the tier did not pay for a full scan.
// "Insert a repository" mutates the store while you browse: walk on, and the ledger counts the rows
// repeated at page boundaries — offset shifts, keyset holds.

import { PAGE_SIZE } from "./fixtures";
import { decodeCursor } from "./ledger";
import { BTN, BTN_ON, Readout, Region } from "./sceneParts";
import type { Ledger } from "./useLedger";

export function FooterRegion({ l }: { l: Ledger }) {
  const v = l.view;
  const w = l.query.window;
  const start = v && v.rows.length ? (w.kind === "offset" ? (w.page - 1) * PAGE_SIZE : (l.walk.step - 1) * PAGE_SIZE) + 1 : 0;
  const end = v ? start + v.rows.length - 1 : 0;
  const predicate = l.query.filter ? `matching “${l.query.filter}”` : "in the fleet, no filter";
  const count =
    !v ? "—" : v.total.kind === "exact" ? `${start}–${end} of ${v.total.n.toLocaleString()} ${predicate}` : `${start}–${end} of ${end.toLocaleString()}${v.total.hasMore ? "+" : ""} ${predicate}`;
  const cursor = w.kind === "keyset" && w.cursor ? decodeCursor(w.cursor, l.query.sort) : null;
  const pages = l.pageCount ?? 1;
  const page = w.kind === "offset" ? w.page : 1;
  const shown = Array.from({ length: pages }, (_, i) => i + 1).filter((p) => p === 1 || p === pages || Math.abs(p - page) <= 2);

  return (
    <Region technique="pagination" title="Bounded window, honest count" note={w.kind === "offset" ? "Offset: skip N, take 25. Random access, modest set — and every insert ahead of you shifts the page under you." : "Keyset: take 25 after this tuple. Anchored to a row, not a position — an insert elsewhere cannot shift it; random access is what it gives up."}>
      <div className="flex flex-wrap items-center gap-2">
        {w.kind === "offset" ? (
          <nav aria-label="Pages" className="flex flex-wrap items-center gap-1">
            {shown.map((p, i) => (
              <span key={p} className="contents">
                {i > 0 && shown[i - 1] !== p - 1 ? <span className="px-1 type-caption text-slate-600">…</span> : null}
                <button type="button" className={p === page ? BTN_ON : BTN} aria-current={p === page ? "page" : undefined} onClick={() => l.goPage(p)} disabled={l.inFlight}>
                  {p}
                </button>
              </span>
            ))}
          </nav>
        ) : (
          <>
            <button type="button" className={BTN} onClick={l.next} disabled={!v?.nextCursor || l.inFlight} aria-label="Next page">
              next →
            </button>
            <button type="button" className={BTN} onClick={l.restart} disabled={l.inFlight || l.walk.step === 1} aria-label="Restart the walk">
              ↺ restart
            </button>
          </>
        )}
        <span className="ml-auto type-mono-sm tabular-nums text-slate-200" data-count={count}>
          {count}
        </span>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Readout label="mechanic" value={w.kind} />
          <Readout label="page size" value={`${PAGE_SIZE} (one of a few; never free-form)`} />
          <Readout label="total" value={!v ? "—" : v.total.kind === "exact" ? "exact: full predicate scan paid" : "bound: 25 + 1 fetched, hasMore only"} />
          {w.kind === "keyset" ? (
            <Readout label="cursor" value={cursor ? `(${l.query.sort.col}=${String(cursor.value)}, ${cursor.id})` : "origin"} />
          ) : null}
        </div>
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={BTN} onClick={l.insert}>
              insert a repository
            </button>
            <span className="type-caption text-slate-500">
              store {l.storeSize.toLocaleString()} rows{l.snapshotBehind > 0 ? ` · snapshot ${l.snapshotBehind} behind` : ""}
            </span>
          </div>
          <Readout label="walk step" value={l.walk.step} />
          <Readout label="rows repeated at a boundary" value={<span data-repeats={l.walk.repeats}>{l.walk.repeats}</span>} tone={l.walk.repeats > 0 ? "text-warn" : "text-slate-200"} />
          <p className="type-caption text-slate-500">
            {w.kind === "offset" ? "Insert, then refresh and page forward: the row that was last on the previous page comes back." : "Insert, then page forward: the boundary is a row, so nothing repeats."}
          </p>
        </div>
      </div>
    </Region>
  );
}
