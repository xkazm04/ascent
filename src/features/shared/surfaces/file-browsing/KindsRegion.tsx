"use client";

// kind-taxonomy: every chip, count, glyph, sort order and rung ceiling in the scene derives from
// KINDS in kinds.ts. A chip's count is the count UNDER THE CURRENT SCOPE and says so; an active
// filter is visible from across the room (the banner); a filter whose bucket no longer exists in
// scope is STRANDED and disclosed instead of leaving a silently empty view. Sort by kind uses the
// vocabulary's declared order, never the token's spelling.

import { KINDS, KIND_ORDER, LEAF_KINDS, type Kind } from "./kinds";
import type { SortKey } from "./store";
import { BTN, BTN_ON, Region } from "./sceneParts";
import type { Vault } from "./useVault";

const SORTS: readonly SortKey[] = ["name", "kind", "size"];

export function KindsRegion({ vault }: { vault: Vault }) {
  const { nav, kindCounts } = vault;
  const active = [...nav.filter];
  const stranded = active.filter((k) => (kindCounts[k] ?? 0) === 0);
  const scope = vault.store.entries.get(nav.location)?.name ?? nav.location;
  return (
    <Region technique="kind-taxonomy" title="One vocabulary, every consumer" note="Chips, glyphs, the sort comparator and the preview ceiling all read KINDS. Counts are per this folder, and say so.">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Kind filter">
        {LEAF_KINDS.map((k) => {
          const on = nav.filter.has(k);
          const n = kindCounts[k] ?? 0;
          return (
            <button key={k} type="button" className={on ? BTN_ON : BTN} aria-pressed={on} onClick={() => vault.toggleKind(k)} data-kind-chip={k} data-count={n}>
              {KINDS[k].glyph} {KINDS[k].label} <span className="tabular-nums text-slate-500">({n})</span>
            </button>
          );
        })}
        <span className="ml-auto flex items-center gap-1 type-caption text-slate-500">
          sort
          {SORTS.map((s) => (
            <button key={s} type="button" className={nav.sort === s ? BTN_ON : BTN} aria-pressed={nav.sort === s} onClick={() => vault.setSort(s)}>
              {s}
            </button>
          ))}
        </span>
      </div>
      {active.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-accent/40 bg-accent/5 px-2 py-1" data-filter-banner={active.join(",")}>
          <span className="type-caption text-accent-soft">
            showing {active.map((k) => KINDS[k].label.toLowerCase()).join(" + ")} only · counts are for {scope}
          </span>
          {stranded.length > 0 ? (
            <span className="type-caption text-warn" data-stranded={stranded.join(",")}>
              stranded: {stranded.map((k) => KINDS[k].label.toLowerCase()).join(", ")} — nothing of that kind is here any more
            </span>
          ) : null}
          <button type="button" className={`${BTN} ml-auto`} onClick={vault.clearFilter}>
            clear
          </button>
        </div>
      ) : null}
      <table className="mt-3 w-full type-micro">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="font-normal">token</th>
            <th className="font-normal">rank</th>
            <th className="font-normal">glyph</th>
            <th className="font-normal">ceiling</th>
            <th className="font-normal">signal</th>
          </tr>
        </thead>
        <tbody>
          {KIND_ORDER.map((k: Kind, i) => (
            <tr key={k} className="border-t border-divider text-slate-400">
              <td className="py-0.5 text-slate-300">{k}</td>
              <td className="py-0.5 tabular-nums">{i}</td>
              <td className="py-0.5">{KINDS[k].glyph}</td>
              <td className="py-0.5">rung {KINDS[k].maxRung}</td>
              <td className="py-0.5 text-slate-500">{KINDS[k].container ? "container" : KINDS[k].ext.length ? `.${KINDS[k].ext.join(" .")}` : "fallback bucket"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Region>
  );
}
