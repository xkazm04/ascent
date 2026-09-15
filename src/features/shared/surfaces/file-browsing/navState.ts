// navigation-state: the user's mental map as ONE named object — location, expansion set, sort,
// filter tokens — persisted as a unit (one JSON blob, written on change) and restored by IDENTITY:
// hydration is a merge with the live store, never a blind replay. Selection and scroll are
// deliberately NOT in it (armed intent and positional state do not survive a session). The blob
// tolerates unknown and missing fields, so schema drift degrades to defaults, never to amnesia. No React.

import { ROOT } from "./fixtures";
import { KIND_ORDER, type Kind } from "./kinds";
import type { SortKey, Store } from "./store";

export type NavState = {
  location: string;
  /** Identities of expanded tree nodes — never indices. */
  expanded: ReadonlySet<string>;
  sort: SortKey;
  /** Active kind tokens; empty = no filter. */
  filter: ReadonlySet<Kind>;
};

export const NAV_VERSION = 1;
const SORTS: readonly SortKey[] = ["name", "kind", "size"];

export function defaultNav(): NavState {
  return { location: ROOT, expanded: new Set([ROOT]), sort: "name", filter: new Set() };
}

/** The persisted shape. `locationPath` (root → location, as identities) is what lets restore walk
 *  up to the nearest surviving ancestor when the location itself is gone. */
export function serialize(nav: NavState, store: Store): string {
  const path: string[] = [];
  let cur = store.entries.get(nav.location);
  let guard = 0;
  while (cur && guard++ < 64) {
    path.unshift(cur.id);
    cur = cur.parentId ? store.entries.get(cur.parentId) : undefined;
  }
  return JSON.stringify({ v: NAV_VERSION, location: nav.location, locationPath: path, expanded: [...nav.expanded], sort: nav.sort, filter: [...nav.filter] });
}

export type RestoreReport = {
  /** Expanded identities that still exist and were re-expanded. */
  kept: number;
  /** Expanded identities the store no longer has — dropped silently; a missing folder is not an error. */
  droppedExpanded: number;
  /** Where the restore landed. */
  landedOn: string;
  /** True when the saved location was gone and the nearest surviving ancestor was used, saying so. */
  relocated: boolean;
  /** Filter tokens the vocabulary no longer knows — dropped; a renamed token must not orphan the view. */
  droppedFilters: number;
};

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Tolerant parse + reconcile against the live store. Garbage in → defaults out, with the report saying so. */
export function hydrate(blob: string, store: Store): { nav: NavState; report: RestoreReport } {
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(blob);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>;
  } catch {
    raw = {};
  }
  const isDir = (id: string): boolean => Boolean(store.entries.get(id)?.isDir && store.entries.get(id)?.readable);

  const expanded = new Set<string>();
  let droppedExpanded = 0;
  let kept = 0;
  for (const id of strings(raw.expanded)) {
    if (isDir(id)) {
      expanded.add(id);
      kept += 1;
    } else droppedExpanded += 1;
  }
  expanded.add(ROOT);

  const wanted = typeof raw.location === "string" ? raw.location : ROOT;
  let location = ROOT;
  let relocated = false;
  if (isDir(wanted)) location = wanted;
  else {
    relocated = wanted !== ROOT;
    const path = strings(raw.locationPath);
    for (let i = path.length - 1; i >= 0; i--) {
      if (isDir(path[i]!)) {
        location = path[i]!;
        break;
      }
    }
  }
  if (relocated) expanded.add(location);

  const sort = SORTS.includes(raw.sort as SortKey) ? (raw.sort as SortKey) : "name";
  const filter = new Set<Kind>();
  let droppedFilters = 0;
  for (const t of strings(raw.filter)) {
    if ((KIND_ORDER as readonly string[]).includes(t)) filter.add(t as Kind);
    else droppedFilters += 1;
  }
  return {
    nav: { location, expanded, sort, filter },
    report: { kept, droppedExpanded, landedOn: location, relocated, droppedFilters },
  };
}
