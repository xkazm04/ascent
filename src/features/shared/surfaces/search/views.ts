// saved-views: a view is a QUESTION — the parsed, typed predicate (text, include/exclude clauses,
// sort) — never a frozen result set. Identity is minted at creation and survives a rename; the default
// slice is a view like any other; every application validates the stored clauses against the live
// SCHEMA, and a clause that no longer binds is rendered dead, never dropped (a dropped clause WIDENS
// the result, which is the silent failure the technique exists to prevent). No React.

import { SCHEMA, isFacetField, type FacetField } from "./fixtures";
import { DEFAULT_PREDICATE, predicateKey, type Predicate } from "./facets";
import type { Sort } from "./rank";

/** The persisted form: plain arrays, field names as strings, because a saved clause may outlive the field. */
export type StoredClause = { field: string; values: string[] };
export type ViewPredicate = { text: string; include: StoredClause[]; exclude: StoredClause[]; sort: Sort };
export type SavedView = { id: string; name: string; predicate: ViewPredicate; shared: boolean; builtIn: boolean };

export function toStored(text: string, p: Predicate, sort: Sort): ViewPredicate {
  const pack = (s: Predicate["include"]): StoredClause[] =>
    (Object.keys(s) as FacetField[]).filter((f) => s[f].size > 0).map((f) => ({ field: f, values: [...s[f]].sort() }));
  return { text, include: pack(p.include), exclude: pack(p.exclude), sort };
}

export type DeadClause = { field: string; values: string[]; why: string };

/** Validate against the live schema at application time — the same single authority the parser reads. */
export function validateView(v: ViewPredicate): DeadClause[] {
  const dead: DeadClause[] = [];
  for (const c of [...v.include, ...v.exclude]) {
    if (!isFacetField(c.field)) dead.push({ field: c.field, values: c.values, why: "field retired from the schema" });
    else {
      const unknown = c.values.filter((x) => !SCHEMA[c.field as FacetField].values.includes(x));
      if (unknown.length) dead.push({ field: c.field, values: unknown, why: "value no longer in the vocabulary" });
    }
  }
  return dead;
}

/** Live clauses only; the caller has already decided what a dead clause means (here: results withheld). */
export function toPredicate(v: ViewPredicate): Predicate {
  const empty = (): Predicate["include"] => ({ owner: new Set(), status: new Set(), lang: new Set(), level: new Set() });
  const p: Predicate = { include: empty(), exclude: empty() };
  for (const side of ["include", "exclude"] as const) for (const c of v[side]) if (isFacetField(c.field)) p[side][c.field] = new Set(c.values);
  return p;
}

export const viewKey = (v: ViewPredicate): string => `${v.text.trim()}|${v.sort}|${predicateKey(toPredicate(v))}|${validateView(v).length}`;

/** Near the view but not at it: the modified marker and its three exits (update, save as new, revert). */
export const isDirty = (current: ViewPredicate, applied: ViewPredicate): boolean => viewKey(current) !== viewKey(applied);

export const DEFAULT_VIEW: SavedView = {
  id: "view-default",
  name: "Active repositories",
  predicate: toStored("", DEFAULT_PREDICATE, "relevance"),
  shared: true,
  builtIn: true,
};

export const SEED_VIEWS: SavedView[] = [
  DEFAULT_VIEW,
  { id: "view-2", name: "Failing Python", predicate: { text: "", include: [{ field: "status", values: ["fail"] }, { field: "lang", values: ["python"] }], exclude: [], sort: "recent" }, shared: true, builtIn: false },
  { id: "view-3", name: "Morning triage", predicate: { text: "session events", include: [{ field: "level", values: ["1", "2"] }], exclude: [{ field: "status", values: ["archived"] }], sort: "relevance" }, shared: false, builtIn: false },
  // Saved under last year's schema: `tier` was retired. The clause is dead and must say so on apply.
  { id: "view-4", name: "Gold tier (2025)", predicate: { text: "", include: [{ field: "tier", values: ["gold"] }], exclude: [], sort: "relevance" }, shared: true, builtIn: false },
];

let minted = SEED_VIEWS.length;
/** Identity minted once, at creation, never from the name. */
export const mintViewId = (): string => `view-${++minted}`;
