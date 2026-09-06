// faceting-and-filters: the predicate the surface carves the hit set with — OR within a field, AND
// across fields, free text ANDs with everything — and facet counts under the disjunctive convention
// (a facet's own selection is lifted while every other facet's still applies). The default slice is a
// predicate like any other, so "has the user filtered?" compares against the default, not against
// emptiness. Query clauses and panel selections land in the SAME predicate. No React.

import { FACET_FIELDS, type FacetField, type Repo } from "./fixtures";
import type { Clause } from "./parse";

export type Selection = Record<FacetField, ReadonlySet<string>>;
export type Predicate = { include: Selection; exclude: Selection };

const empty = (): Selection => ({ owner: new Set(), status: new Set(), lang: new Set(), level: new Set() });

/** The surface opens on active repositories: a declared default, rendered as a removable chip. */
export const DEFAULT_PREDICATE: Predicate = { include: empty(), exclude: { ...empty(), status: new Set(["archived"]) } };

export const fieldValue = (r: Repo, f: FacetField): string => (f === "level" ? String(r.level) : r[f]);

/** Membership under the predicate, optionally lifting one facet's own inclusion (the disjunctive count). */
export function passes(r: Repo, p: Predicate, lift: FacetField | null = null): boolean {
  for (const f of FACET_FIELDS) {
    const v = fieldValue(r, f);
    if (p.exclude[f].has(v)) return false;
    if (f !== lift && p.include[f].size > 0 && !p.include[f].has(v)) return false;
  }
  return true;
}

/** Parsed clauses fold into the predicate: a positive clause includes, a negated one excludes. Unknown values still land, so the empty result is explainable. */
export function withClauses(base: Predicate, clauses: readonly Clause[]): Predicate {
  const include = { ...base.include };
  const exclude = { ...base.exclude };
  for (const c of clauses) {
    const target = c.negated ? exclude : include;
    target[c.field] = new Set([...target[c.field], c.value]);
  }
  return { include, exclude };
}

export function toggle(p: Predicate, side: keyof Predicate, f: FacetField, v: string): Predicate {
  const next = new Set(p[side][f]);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return { ...p, [side]: { ...p[side], [f]: next } };
}

/** Counts per value: "how many would I have if I also selected this?" — every count under one named predicate. */
export function facetCounts(rows: readonly Repo[], p: Predicate): Record<FacetField, Map<string, number>> {
  const out = { owner: new Map(), status: new Map(), lang: new Map(), level: new Map() } as Record<FacetField, Map<string, number>>;
  for (const r of rows) {
    for (const f of FACET_FIELDS) {
      if (!passes(r, p, f)) continue;
      const v = fieldValue(r, f);
      out[f].set(v, (out[f].get(v) ?? 0) + 1);
    }
  }
  return out;
}

export type ActiveChip = { side: keyof Predicate; field: FacetField; value: string; isDefault: boolean };

/** Every active clause, visible in one place, individually removable; defaults are chips like any other. */
export function activeChips(p: Predicate): ActiveChip[] {
  const chips: ActiveChip[] = [];
  for (const side of ["include", "exclude"] as const)
    for (const f of FACET_FIELDS) for (const v of p[side][f]) chips.push({ side, field: f, value: v, isDefault: DEFAULT_PREDICATE[side][f].has(v) });
  return chips;
}

const key = (p: Predicate): string =>
  (["include", "exclude"] as const).map((s) => FACET_FIELDS.map((f) => `${s}.${f}=${[...p[s][f]].sort().join(",")}`).join(";")).join("|");

/** ONE narrowed-vs-default predicate for the bar, the empty state and the badge, so they cannot disagree. */
export const isNarrowed = (p: Predicate): boolean => key(p) !== key(DEFAULT_PREDICATE);
export const predicateKey = key;
