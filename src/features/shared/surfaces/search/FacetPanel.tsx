"use client";

// faceting-and-filters: the map of where the results live. Four facets from the ONE schema, counts
// under the disjunctive convention (a facet's own selection lifted, every other still applied),
// zero-count values disabled but visible, OR within a group and AND across. Active clauses — the
// default exclusion included — render as removable chips in one place with a clear-all; the
// narrowed-vs-default predicate is one function; every filter change resets the page.

import { SCHEMA, FACET_FIELDS } from "./fixtures";
import { activeChips, DEFAULT_PREDICATE, isNarrowed, toggle } from "./facets";
import type { FleetSearch } from "./useFleetSearch";
import { BTN, Chip, Readout, Region } from "./sceneParts";

export function FacetPanel({ s }: { s: FleetSearch }) {
  const chips = activeChips(s.full);
  const narrowed = isNarrowed(s.full);
  const fromText = s.parsed.clauses.length;
  return (
    <Region technique="faceting-and-filters" title="Counts that carry their predicate" note="OR within a facet, AND across. Each count answers: how many would I have if I also picked this?">
      <div className="mb-3 flex flex-wrap items-center gap-1.5" data-active-chips={chips.length}>
        {chips.map((c) => (
          <Chip
            key={`${c.side}.${c.field}.${c.value}`}
            tone={c.side === "exclude" ? "warn" : "idle"}
            title={c.isDefault ? "a declared default — removable like any choice" : undefined}
            onRemove={() => s.setPredicate(toggle(s.predicate, c.side, c.field, c.value))}
          >
            <span data-chip-default={c.isDefault}>
              {c.side === "exclude" ? "not " : ""}
              {c.field} = {c.value}
              {c.isDefault ? " · default" : ""}
            </span>
          </Chip>
        ))}
        {chips.length ? (
          <button type="button" className={BTN} onClick={() => s.setPredicate(DEFAULT_PREDICATE)}>
            clear all
          </button>
        ) : (
          <span className="type-caption text-slate-500">no active clauses</span>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {FACET_FIELDS.map((f) => (
          <fieldset key={f} className="rounded-lg border border-divider p-2" data-facet={f}>
            <legend className="px-1 type-label uppercase tracking-[0.2em] text-slate-500">{f}</legend>
            <ul className="space-y-0.5">
              {SCHEMA[f].values.map((v) => {
                const n = s.counts[f].get(v) ?? 0;
                const on = s.full.include[f].has(v);
                const excluded = s.full.exclude[f].has(v);
                return (
                  <li key={v}>
                    <label className={`flex items-center justify-between gap-2 rounded px-1 type-caption ${n === 0 && !on ? "text-slate-600" : "text-slate-300"}`}>
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="accent-[var(--color-accent)]"
                          checked={on}
                          disabled={(n === 0 && !on) || excluded}
                          onChange={() => s.setPredicate(toggle(s.predicate, "include", f, v))}
                          aria-label={`${f} ${v}`}
                        />
                        {v}
                        {excluded ? <span className="text-warn">excluded</span> : null}
                      </span>
                      <span className="font-mono tabular-nums text-slate-500" data-count={`${f}:${v}`}>
                        {n.toLocaleString()}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ))}
      </div>
      <div className="mt-3 space-y-1">
        <Readout label="narrowed vs default" value={<span data-narrowed={narrowed}>{narrowed ? "yes" : "no — the default slice"}</span>} tone={narrowed ? "text-accent-soft" : "text-slate-400"} />
        <Readout label="clauses from the text box" value={String(fromText)} />
        <Readout label="page resets on filter change" value={<span data-page-resets={s.pageResets}>{s.pageResets}</span>} />
      </div>
      <p className="mt-2 type-caption text-slate-500">
        Counts cover all {s.hitRows.length.toLocaleString()} text hits (the whole set the engine returned), not the {s.pageRows.length} rows shown. The option lists come from the schema, never from the loaded window.
      </p>
    </Region>
  );
}
