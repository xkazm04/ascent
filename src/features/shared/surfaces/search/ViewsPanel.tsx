"use client";

// saved-views: the current text + predicate + sort promoted to a named question. Applying a view
// re-runs it against the corpus; the surface shows when it is NEAR the view but not AT it (modified
// marker, three exits); the default slice is a view in the same list; a view saved under a retired
// field renders its dead clause and withholds results instead of widening them; a rename never
// touches the identity the shortcut hangs off.

import { useState } from "react";
import { DEFAULT_PREDICATE } from "./facets";
import type { FleetSearch } from "./useFleetSearch";
import { DEFAULT_VIEW, isDirty, mintViewId, SEED_VIEWS, toPredicate, toStored, validateView, type SavedView, type ViewPredicate } from "./views";
import { BTN, BTN_ON, Chip, Readout, Region } from "./sceneParts";

export function ViewsPanel({ s }: { s: FleetSearch }) {
  const [views, setViews] = useState<SavedView[]>(SEED_VIEWS);
  // The applied view and the exact state its application produced: "dirty" compares against that snapshot.
  const [appliedId, setAppliedId] = useState<string>(SEED_VIEWS[0].id);
  const [snapshot, setSnapshot] = useState<ViewPredicate>(SEED_VIEWS[0].predicate);
  const applied = views.find((v) => v.id === appliedId) ?? views[0] ?? DEFAULT_VIEW;
  const current = toStored(s.text, s.predicate, s.sort);
  const dead = validateView(applied.predicate);
  const dirty = isDirty(current, snapshot);

  const apply = (v: SavedView) => {
    const live = toPredicate(v.predicate);
    // A dead clause withholds results (an impossible include) rather than dropping the clause and widening them.
    const p = validateView(v.predicate).length ? { ...live, include: { ...live.include, status: new Set(["∅ withheld"]) } } : live;
    setAppliedId(v.id);
    setSnapshot(toStored(v.predicate.text, p, v.predicate.sort));
    s.setText(v.predicate.text);
    s.setPredicate(p);
    s.setSort(v.predicate.sort);
  };
  const update = () => (setViews((vs) => vs.map((v) => (v.id === applied.id ? { ...v, predicate: current } : v))), setSnapshot(current));
  const saveAs = () => {
    const v: SavedView = { id: mintViewId(), name: `View ${views.length}`, predicate: current, shared: false, builtIn: false };
    setViews((vs) => [...vs, v]);
    setAppliedId(v.id);
    setSnapshot(current);
  };
  const repair = () => {
    const fixed: SavedView = { ...applied, predicate: { ...applied.predicate, include: applied.predicate.include.filter((c) => !dead.some((d) => d.field === c.field)), exclude: applied.predicate.exclude } };
    setViews((vs) => vs.map((v) => (v.id === applied.id ? fixed : v)));
    apply(fixed);
  };
  const rename = () => setViews((vs) => vs.map((v) => (v.id === applied.id ? { ...v, name: `${v.name} ·` } : v)));

  return (
    <Region technique="saved-views" title="A question, saved" note="The predicate is stored, never the rows. Every application validates it against the live schema.">
      <ul className="space-y-1" data-views>
        {views.map((v) => {
          const on = v.id === applied.id;
          return (
            <li key={v.id} className="flex items-center justify-between gap-2">
              <button type="button" className={on ? BTN_ON : BTN} onClick={() => apply(v)} aria-current={on ? "true" : undefined} data-view={v.id}>
                {v.name}
                {on && dirty ? <span className="text-warn"> · modified</span> : null}
              </button>
              <span className="type-caption text-slate-600">
                {v.builtIn ? "default · " : ""}
                {v.shared ? "shared" : "personal"} · {v.id}
              </span>
            </li>
          );
        })}
      </ul>

      {dead.length ? (
        <div className="mt-3 rounded-lg border border-danger/40 bg-danger/5 p-2" role="alert" data-dead-clauses={dead.length}>
          <p className="type-caption text-danger">This view&apos;s clause no longer binds — results are withheld, not widened.</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {dead.map((d) => (
              <Chip key={d.field} tone="danger" title={d.why}>
                {d.field} = {d.values.join(", ")} · {d.why}
              </Chip>
            ))}
            <button type="button" className={BTN} onClick={repair}>
              drop the dead clause
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={BTN} disabled={!dirty || applied.builtIn} onClick={update} title={applied.builtIn ? "the default view is not editable in place" : undefined}>
          update view
        </button>
        <button type="button" className={BTN} disabled={!dirty} onClick={saveAs}>
          save as new
        </button>
        <button type="button" className={BTN} disabled={!dirty} onClick={() => apply(applied)}>
          revert
        </button>
        <button type="button" className={BTN} onClick={rename}>
          rename
        </button>
      </div>
      <div className="mt-2 space-y-1">
        <Readout label="applied" value={<span data-applied={applied.id}>{applied.name}</span>} />
        <Readout label="state" value={<span data-dirty={dirty}>{dirty ? "near the view, not at it" : "at the view"}</span>} tone={dirty ? "text-warn" : "text-slate-200"} />
        <Readout label="stored form" value={`text “${current.text}” · ${current.include.length + current.exclude.length} clause(s) · ${current.sort}`} tone="text-slate-400" />
      </div>
      <p className="mt-2 type-caption text-slate-500">Shared views fork on edit (save as new); the default is {DEFAULT_PREDICATE.exclude.status.size} exclusion, listed like any other view.</p>
    </Region>
  );
}
