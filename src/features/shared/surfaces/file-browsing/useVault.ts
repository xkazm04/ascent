"use client";

// The vault browser's one state owner: the store (a foreign authority the sync agent also writes),
// the LISTING taken from it at a tick (the view is a cache), the navigation object (persisted as a
// blob on every change), the selection (identities), the trash, and — via useVaultMutations — the
// browser's own writes. Every write commits pessimistically: the store answers, then the view
// re-lists and the selection reconciles; the surface never settles on a state the store lacks.

import { useCallback, useMemo, useState } from "react";
import type { SurfaceVolume } from "@/lib/org/surface-catalog";
import { ROOT, WINDOW, makeEntries, type Entry } from "./fixtures";
import type { Kind } from "./kinds";
import { churn } from "./mutations";
import { defaultNav, hydrate, serialize, type NavState, type RestoreReport } from "./navState";
import { children, listDir, makeStore, targetDirs, trashRows, type Listing, type SortKey, type Store } from "./store";
import { useSelection } from "./useSelection";
import { useVaultMutations } from "./useVaultMutations";

const boot = (volume: SurfaceVolume) => {
  const store = makeStore(makeEntries(volume));
  return { store, listing: listDir(store, ROOT, "name") };
};

export function useVault(volume: SurfaceVolume) {
  const [first] = useState(() => boot(volume));
  const [store, setStore] = useState<Store>(first.store);
  const [listing, setListing] = useState<Listing>(first.listing);
  const [nav, setNav] = useState<NavState>(defaultNav);
  const [blob, setBlob] = useState(() => serialize(defaultNav(), first.store));
  const [restoreReport, setRestoreReport] = useState<RestoreReport | null>(null);
  const [journal, setJournal] = useState<string[]>([]);
  const sel = useSelection();

  // The volume knob rebuilds the fiction (adjust-state-during-render; every setter is this component's).
  const [prevVolume, setPrevVolume] = useState(volume);
  if (prevVolume !== volume) {
    setPrevVolume(volume);
    const next = boot(volume);
    setStore(next.store);
    setListing(next.listing);
    setNav(defaultNav());
    setBlob(serialize(defaultNav(), next.store));
    setRestoreReport(null);
    setJournal([]);
    sel.clear();
  }

  /** Persist on change — one blob, written every time the map changes, never on exit. */
  const writeNav = useCallback(
    (next: NavState, at: Store = store) => {
      setNav(next);
      setBlob(serialize(next, at));
    },
    [store],
  );

  /** Re-list from a store and reconcile the selection by identity: a refresh replaces data, not the
   *  session. `keep=false` is the navigation case, where the selection was cleared on purpose. */
  const relist = useCallback(
    (at: Store, where: NavState = nav, keep = true) => {
      const fresh = listDir(at, where.location, where.sort);
      setListing(fresh);
      if (keep) sel.reconcile(new Set(fresh.all.map((e) => e.id)));
    },
    [nav, sel],
  );

  const commit = useCallback(
    (next: Store) => {
      setStore(next);
      relist(next);
    },
    [relist],
  );

  const refresh = useCallback(() => relist(store), [relist, store]);

  const navigate = useCallback(
    (id: string) => {
      const next = { ...nav, location: id, expanded: new Set(nav.expanded).add(id) };
      writeNav(next);
      sel.clear(); // armed intent does not travel between folders
      relist(store, next, false);
    },
    [nav, relist, sel, store, writeNav],
  );

  const toggleExpand = useCallback(
    (id: string) => {
      const expanded = new Set(nav.expanded);
      if (expanded.has(id)) expanded.delete(id);
      else expanded.add(id);
      writeNav({ ...nav, expanded });
    },
    [nav, writeNav],
  );

  const setSort = useCallback(
    (sort: SortKey) => {
      const next = { ...nav, sort };
      writeNav(next);
      relist(store, next);
    },
    [nav, relist, store, writeNav],
  );

  const toggleKind = useCallback(
    (k: Kind) => {
      const filter = new Set(nav.filter);
      if (filter.has(k)) filter.delete(k);
      else filter.add(k);
      writeNav({ ...nav, filter });
    },
    [nav, writeNav],
  );

  const clearFilter = useCallback(() => writeNav({ ...nav, filter: new Set() }), [nav, writeNav]);

  /** "Restart": rebuild the map from the blob and MERGE it with the live store. */
  const restart = useCallback(() => {
    const { nav: next, report } = hydrate(blob, store);
    setNav(next);
    setRestoreReport(report);
    sel.clear();
    relist(store, next, false);
  }, [blob, relist, sel, store]);

  const resetView = useCallback(() => {
    const next = defaultNav();
    writeNav(next);
    setRestoreReport(null);
    sel.clear();
    relist(store, next, false);
  }, [relist, sel, store, writeNav]);

  /** The other window writes; the view is NOT told (that is the point). */
  const churnStore = useCallback(() => {
    const out = churn(store, store.tick * 7919 + volume, store.entries.get(nav.location), children(store, nav.location));
    setStore(out.store);
    setJournal((j) => [...out.journal.map((l) => `t${out.store.tick} · ${l}`), ...j].slice(0, 6));
  }, [nav.location, store, volume]);

  const matching = useMemo(() => (nav.filter.size === 0 ? listing.all : listing.all.filter((e) => nav.filter.has(e.kind))), [listing.all, nav.filter]);
  const visible = useMemo(() => matching.slice(0, WINDOW), [matching]);
  const kindCounts = useMemo(() => {
    const out: Partial<Record<Kind, number>> = {};
    for (const e of listing.all) out[e.kind] = (out[e.kind] ?? 0) + 1;
    return out;
  }, [listing.all]);

  /** The identity list the next mutation receives, resolved against the LIVE store (the authority). */
  const resolveTargets = useCallback((): string[] => {
    const live = listDir(store, nav.location, nav.sort).all.filter((e) => nav.filter.size === 0 || nav.filter.has(e.kind)).map((e) => e.id);
    return sel.resolve(live);
  }, [nav, sel, store]);

  const writes = useVaultMutations(store, commit, resolveTargets, volume);
  const dirs = useMemo(() => targetDirs(store), [store]);
  const trash = useMemo(() => trashRows(store), [store]);
  const focused: Entry | null = useMemo(() => (sel.focus ? (visible.find((e) => e.id === sel.focus) ?? null) : null), [sel.focus, visible]);

  return {
    store, listing, stale: listing.tick !== store.tick, nav, blob, restoreReport, journal, sel,
    matching, visible, kindCounts, dirs, trash, focused,
    refresh, navigate, toggleExpand, setSort, toggleKind, clearFilter, restart, resetView, churnStore, resolveTargets,
    ...writes,
  };
}

export type Vault = ReturnType<typeof useVault>;
