"use client";

// The fleet ledger's state, in one hook the five regions read: the regime (all-client snapshot or
// all-server window), the query (filter, sort, window), the simulated round-trip with latest-wins
// request ids, the body-state inputs (inFlight, settled, error), the walk ledger that counts rows
// repeated across page boundaries, the table-scoped seen-set for entrance guarding, the selection,
// and the render log the performance instrument reads. `regime` is refused — not tuned — past the
// written-down all-client bound. Written against the React Compiler rules: no setState in an effect
// body (deliveries land from timers and handlers), no ref read during render, no clock read at all.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SurfaceVolume } from "@/lib/org/surface-catalog";
import { PAGE_SIZE, insertedRepo, makeRepos, type Repo } from "./fixtures";
import { ALL_CLIENT_BOUND, DEFAULT_SORT, bodyState, matches, regimeAllowed, runQuery, sortRepos, type Query, type Regime, type Response, type Sort } from "./ledger";

export const LATENCY_MS = 650;
type Walk = { step: number; first: Map<string, number>; repeats: number };
const NO_ROWS: Repo[] = [];
const FRESH_WALK: Walk = { step: 1, first: new Map(), repeats: 0 };
const firstWindow = (regime: Regime): Query["window"] => (regime === "client" ? { kind: "offset", page: 1 } : { kind: "keyset", cursor: null });

export function useLedger(volume: SurfaceVolume) {
  const initialRegime: Regime = volume > ALL_CLIENT_BOUND ? "server" : "client";
  const [data, setData] = useState<Repo[]>(() => makeRepos(volume)); // the store: what the "server" holds
  const [regime, setRegimeState] = useState<Regime>(initialRegime);
  const [query, setQuery] = useState<Query>(() => ({ filter: "", sort: DEFAULT_SORT, window: firstWindow(initialRegime) }));
  const [snapshot, setSnapshot] = useState<Repo[] | null>(null); // all-client: the copy the client holds
  const [served, setServed] = useState<Response | null>(null); // all-server: the last window delivered
  const [inFlight, setInFlight] = useState(true); // the first arrival is in flight from the first frame
  const [settled, setSettled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failNext, setFailNext] = useState(false);
  const [staleRefreshes, setStaleRefreshes] = useState(0);
  const [inserts, setInserts] = useState(0);
  const [splitSort, setSplitSort] = useState(false); // the forbidden knob: sort the loaded page on the client
  const [localSort, setLocalSort] = useState<Sort>(DEFAULT_SORT);
  const [quickFind, setQuickFind] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [walk, setWalk] = useState<Walk>(FRESH_WALK);
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set()); // table-scoped: outlives every row
  const reqId = useRef(1);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const log = useRef<{ n: number; el: HTMLElement | null }>({ n: 0, el: null });

  /** The walk ledger: which step first delivered each identity; delivered again on a later step = a repeat. */
  const recordDelivery = useCallback((rows: readonly Repo[], step: number, reset: boolean) => {
    setWalk((w) => {
      const first = reset ? new Map<string, number>() : new Map(w.first);
      let repeats = 0;
      for (const r of rows) {
        const at = first.get(r.id);
        if (at === undefined) first.set(r.id, step);
        else if (at !== step) repeats += 1;
      }
      return { step, first, repeats };
    });
  }, []);

  /** The response landing, LATENCY_MS after dispatch — dropped if a newer request superseded it. */
  const land = useCallback(
    (id: number, target: "window" | "snapshot", answer: Response, store: Repo[], fail: boolean, step: number, reset: boolean) => {
      timers.current.push(
        setTimeout(() => {
          if (id !== reqId.current) return; // superseded: never applied
          setInFlight(false);
          setSettled(true);
          if (fail) {
            setError("The fleet store did not answer (simulated).");
            setStaleRefreshes((n) => n + 1);
            return;
          }
          if (target === "snapshot") setSnapshot(store);
          else setServed(answer);
          recordDelivery(answer.rows, step, reset);
        }, LATENCY_MS),
      );
    },
    [recordDelivery],
  );

  /** One simulated round-trip. `clear` empties the body first (a filter or context change); a page or sort change keeps the rows dimmed. */
  const dispatch = (q: Query, target: "window" | "snapshot", clear: boolean, fail: boolean, step: number, reset: boolean) => {
    const id = ++reqId.current;
    if (clear) {
      setSeen(new Set());
      setSnapshot(null);
      setServed(null);
    }
    setInFlight(true);
    setError(null);
    setFailNext(false);
    land(id, target, runQuery(data, q, data.length <= ALL_CLIENT_BOUND), data, fail, step, reset); // the server answers with what it holds NOW
  };

  // First arrival: the snapshot (all-client) or the first window (all-server). State already says in flight.
  useEffect(() => {
    land(1, initialRegime === "client" ? "snapshot" : "window", runQuery(data, query, true), data, false, 1, true);
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only; later requests are explicit
  }, []);

  // The presentation sequence is a DERIVATION of named inputs — recomputed exactly when one of them changes.
  const view: Response | null = useMemo(() => (regime === "client" ? (snapshot ? runQuery(snapshot, query, true) : null) : served), [regime, snapshot, query, served]);
  const windowRows = view?.rows ?? NO_ROWS;
  const shownSort = splitSort && regime === "server" ? localSort : query.sort;
  // Memoized so its identity — and every row view model derived from it — survives a selection toggle.
  const rows = useMemo(
    () => (splitSort && regime === "server" ? sortRepos(windowRows, localSort) : windowRows).filter((r) => matches(r, quickFind)),
    [windowRows, splitSort, regime, localSort, quickFind],
  );
  const state = bodyState(inFlight, windowRows.length, settled, error);

  const apply = (next: Query, clear: boolean, step: number, reset: boolean) => {
    log.current.n = 0;
    setQuery(next);
    if (regime === "server") dispatch(next, "window", clear, failNext, step, reset);
    else {
      setError(null); // the snapshot answers a new predicate itself; the last fetch's failure is not this answer's
      if (clear) setSeen(new Set());
      if (snapshot) recordDelivery(runQuery(snapshot, next, true).rows, step, reset); // delivered locally, at once
    }
  };
  const setFilter = (filter: string) => apply({ filter, sort: query.sort, window: firstWindow(regime) }, true, 1, true); // a new predicate: the old rows were never an answer
  const cycleSort = (col: Sort["col"], firstDir: Sort["dir"]) => {
    const cur = shownSort;
    const sort: Sort = cur.col !== col ? { col, dir: firstDir } : cur.dir === firstDir ? { col, dir: firstDir === "asc" ? "desc" : "asc" } : DEFAULT_SORT;
    if (splitSort && regime === "server") {
      setLocalSort(sort); // the forbidden path: reorders the window, the request never hears about it
      return;
    }
    apply({ ...query, sort, window: firstWindow(regime) }, false, 1, true); // the rows stay: a truthful partial answer, dimmed
  };
  const goPage = (page: number) => apply({ ...query, window: { kind: "offset", page } }, false, page, false);
  const next = () => {
    if (view?.nextCursor) apply({ ...query, window: { kind: "keyset", cursor: view.nextCursor } }, false, walk.step + 1, false);
  };
  const restart = () => apply({ ...query, window: firstWindow(regime) }, false, 1, true);
  const refresh = () => {
    log.current.n = 0;
    dispatch(query, regime === "client" ? "snapshot" : "window", false, failNext, walk.step, false);
  };
  const setRegime = (r: Regime) => {
    if (r === regime || !regimeAllowed(r, volume)) return;
    setRegimeState(r);
    setSplitSort(false);
    setQuickFind("");
    setSettled(false);
    const q = { ...query, window: firstWindow(r) };
    setQuery(q);
    dispatch(q, r === "client" ? "snapshot" : "window", true, failNext, 1, true); // a regime is a context: clear
  };
  const insert = () => {
    const n = inserts + 1;
    setInserts(n);
    setData((d) => [insertedRepo(n), ...d]); // the store moves; a held snapshot does not, until refreshed
  };
  const toggle = useCallback((id: string) => {
    log.current.n = 0; // the instrument counts rows rendered by THIS interaction
    setSelected((s) => {
      const nextSet = new Set(s);
      if (nextSet.has(id)) nextSet.delete(id);
      else nextSet.add(id);
      return nextSet;
    });
  }, []);
  /** A row's commit: one tick into the render log, written to the instrument's node — never into state. */
  const onRowRender = useCallback(() => {
    log.current.n += 1;
    if (log.current.el) log.current.el.textContent = String(log.current.n);
  }, []);
  const logEl = useCallback((el: HTMLElement | null) => {
    log.current.el = el;
  }, []);
  /** The entrance itself marks the identity (from `animationend`, which the reduced 1ms epsilon still fires). */
  const markSeen = useCallback((id: string) => setSeen((s) => (s.has(id) ? s : new Set(s).add(id))), []);

  const total = view?.total ?? null;
  const pageCount = total?.kind === "exact" ? Math.max(1, Math.ceil(total.n / PAGE_SIZE)) : null;
  return {
    regime, setRegime, regimeAllowed: (r: Regime) => regimeAllowed(r, volume), query, shownSort, view, rows, windowRows, state, inFlight, settled, error,
    failNext, setFailNext, staleRefreshes, splitSort, setSplitSort, quickFind, setQuickFind, selected, toggle, seen, markSeen, onRowRender, logEl, walk, pageCount,
    snapshotBehind: snapshot ? data.length - snapshot.length : 0, setFilter, cycleSort, goPage, next, restart, refresh, insert, storeSize: data.length,
  };
}

export type Ledger = ReturnType<typeof useLedger>;
