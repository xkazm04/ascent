// The foreign store and the READ contract over it (listing-and-refresh). The store is an immutable
// snapshot `{ entries, tick }`; every writer — the browser's own mutations in mutations.ts and the
// "sync agent" that plays the other window — returns a new snapshot with `tick + 1`. A Listing is a
// read taken AT a tick: what the view renders is that cache, never "the directory", and the gap
// between `listing.tick` and `store.tick` is the staleness the scene admits on screen. No React.

import { ROOT, TRASH, WINDOW, type Entry } from "./fixtures";
import { kindRank } from "./kinds";

export type Store = { entries: ReadonlyMap<string, Entry>; tick: number };
export type SortKey = "name" | "kind" | "size";

/** The read contract, decided once and shown in the listing region. Every reader applies it. */
export const LISTING_POLICY = {
  scope: "one directory, shallow (lazy tree)",
  window: WINDOW,
  exclusion: 'names starting with "." (the store\'s bookkeeping)',
  order: "containers first, then the sort key, tiebreak on identity",
} as const;

export const isHidden = (e: Entry): boolean => e.name.startsWith(".");

export type Listing = {
  dirId: string;
  /** The store tick this read was taken at — the view's "current as of". */
  tick: number;
  /** `empty` and `unreadable` are spelled differently: "nothing here" vs "could not read this". */
  status: "ok" | "empty" | "unreadable" | "missing";
  /** The complete, sorted, in-memory listing; the view mounts a WINDOW of it. */
  all: Entry[];
  /** Entries the store refused to read — skipped, counted, disclosed. */
  skipped: number;
  /** Entries the exclusion policy omitted on purpose. */
  hidden: number;
};

export function makeStore(entries: Map<string, Entry>): Store {
  return { entries, tick: 1 };
}

export function bump(store: Store, entries: Map<string, Entry>): Store {
  return { entries, tick: store.tick + 1 };
}

/** Raw children of a directory, unsorted and unfiltered — the store's answer before policy. */
export function children(store: Store, dirId: string): Entry[] {
  const out: Entry[] = [];
  for (const e of store.entries.values()) if (e.parentId === dirId) out.push(e);
  return out;
}

export function compare(sort: SortKey): (a: Entry, b: Entry) => number {
  return (a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1; // containers before leaves, whatever the key
    const c = sort === "name" ? a.name.localeCompare(b.name) : sort === "kind" ? kindRank(a.kind) - kindRank(b.kind) : b.size - a.size;
    return c !== 0 ? c : a.id.localeCompare(b.id); // stable tiebreak on identity, so refreshes do not shuffle
  };
}

/** One directory read under the contract: shallow, policy-filtered, per-entry error policy. */
export function listDir(store: Store, dirId: string, sort: SortKey): Listing {
  const dir = store.entries.get(dirId);
  const base = { dirId, tick: store.tick, all: [], skipped: 0, hidden: 0 };
  if (!dir || !dir.isDir) return { ...base, status: "missing" };
  if (!dir.readable) return { ...base, status: "unreadable" };
  let skipped = 0;
  let hidden = 0;
  const all: Entry[] = [];
  for (const e of children(store, dirId)) {
    if (isHidden(e)) hidden += 1; // declared exclusion, applied by this one reader
    else if (!e.readable) skipped += 1; // skip-and-count: the walk continues, the count is disclosed
    else all.push(e);
  }
  all.sort(compare(sort));
  return { dirId, tick: store.tick, status: all.length === 0 && skipped === 0 ? "empty" : "ok", all, skipped, hidden };
}

/** Root → id, as entries. Empty when the id is gone; the trail and the tree both read this. */
export function pathOf(store: Store, id: string): Entry[] {
  const out: Entry[] = [];
  let cur = store.entries.get(id);
  let guard = 0;
  while (cur && guard++ < 64) {
    out.unshift(cur);
    if (cur.id === ROOT || !cur.parentId) break;
    cur = store.entries.get(cur.parentId);
  }
  return out;
}

export function isDescendant(store: Store, id: string, ancestorId: string): boolean {
  let cur = store.entries.get(id);
  let guard = 0;
  while (cur && cur.parentId && guard++ < 64) {
    if (cur.parentId === ancestorId) return true;
    cur = store.entries.get(cur.parentId);
  }
  return false;
}

/** Directories a move can target: every readable, live directory except the trash. */
export function targetDirs(store: Store): Entry[] {
  const out: Entry[] = [];
  for (const e of store.entries.values()) {
    if (e.isDir && e.readable && e.id !== TRASH && !e.origin && !isDescendant(store, e.id, TRASH)) out.push(e);
  }
  return out.sort((a, b) => pathOf(store, a.id).length - pathOf(store, b.id).length || a.name.localeCompare(b.name));
}

export const trashRows = (store: Store): Entry[] => children(store, TRASH).sort((a, b) => (a.trashedAt ?? 0) - (b.trashedAt ?? 0) || a.id.localeCompare(b.id));
