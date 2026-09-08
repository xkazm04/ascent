"use client";

// navigation-state: the tree (the map) and the location trail (the "you are here") are two
// renderings of ONE value — `nav.location` — so they cannot disagree. The expansion set is
// identities; the whole object round-trips as one JSON blob written on every change (shown live);
// "simulate restart" hydrates from that blob and MERGES with the live store: expanded folders that
// vanished are dropped, a vanished location walks up to the nearest surviving ancestor, and the
// report says so. "reset view" is the cheap escape door from a drifted map.

import { ROOT, TRASH, type Entry } from "./fixtures";
import { children, pathOf, type Store } from "./store";
import { BTN, Readout, Region } from "./sceneParts";
import type { Vault } from "./useVault";

const dirsUnder = (store: Store, id: string): Entry[] => children(store, id).filter((e) => e.isDir && e.id !== TRASH).sort((a, b) => a.name.localeCompare(b.name));

function TreeNode({ vault, entry, level }: { vault: Vault; entry: Entry; level: number }) {
  const kids = dirsUnder(vault.store, entry.id);
  const open = vault.nav.expanded.has(entry.id);
  const here = vault.nav.location === entry.id;
  return (
    <li role="treeitem" aria-level={level} aria-expanded={kids.length > 0 ? open : undefined} aria-selected={here} data-tree-node={entry.id}>
      <div className="flex items-center gap-1" style={{ paddingLeft: `${(level - 1) * 0.75}rem` }}>
        <button
          type="button"
          className="focus-ring w-4 type-caption text-slate-500 disabled:opacity-30"
          aria-label={`${open ? "Collapse" : "Expand"} ${entry.name}`}
          disabled={kids.length === 0}
          onClick={() => vault.toggleExpand(entry.id)}
        >
          {kids.length === 0 ? "·" : open ? "▾" : "▸"}
        </button>
        <button
          type="button"
          className={`focus-ring rounded px-1 type-caption ${here ? "bg-accent/10 text-accent-soft" : entry.readable ? "text-slate-300 hover:text-white" : "text-slate-600"}`}
          aria-current={here ? "location" : undefined}
          onClick={() => vault.navigate(entry.id)}
        >
          {entry.name}
          {entry.readable ? "" : " (unreadable)"}
        </button>
      </div>
      {open && kids.length > 0 ? (
        <ul role="group" className="space-y-0.5">
          {kids.map((k) => (
            <TreeNode key={k.id} vault={vault} entry={k} level={level + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function NavRegion({ vault }: { vault: Vault }) {
  const root = vault.store.entries.get(ROOT)!;
  const trail = pathOf(vault.store, vault.nav.location);
  // Width pressure collapses the MIDDLE: root and current stay visible — those are the two that orient.
  const shown = trail.length > 4 ? [trail[0]!, null, ...trail.slice(-2)] : trail;
  const r = vault.restoreReport;
  return (
    <Region technique="navigation-state" title="The map, persisted as one object" note="Tree and trail read one location. Expansion is a set of identities. The blob below is written on every change — never on exit.">
      <nav aria-label="Location" className="mb-2 flex flex-wrap items-center gap-1 type-caption">
        {shown.map((seg, i) =>
          seg === null ? (
            <span key="ellipsis" className="text-slate-600">
              …
            </span>
          ) : (
            <span key={seg.id} className="flex items-center gap-1">
              {i > 0 ? <span className="text-slate-700">/</span> : null}
              <button type="button" className={`focus-ring rounded px-1 ${seg.id === vault.nav.location ? "text-white" : "text-slate-400 hover:text-white"}`} onClick={() => vault.navigate(seg.id)} data-crumb={seg.id}>
                {seg.name}
              </button>
            </span>
          ),
        )}
        {trail.length === 0 ? <span className="text-warn">location gone — restart to relocate</span> : null}
      </nav>
      <ul role="tree" aria-label="Folders" className="space-y-0.5 rounded-lg border border-divider p-2">
        <TreeNode vault={vault} entry={root} level={1} />
      </ul>
      <pre className="mt-3 max-h-24 overflow-auto rounded-md border border-divider bg-surface/40 p-2 type-micro text-slate-500" data-nav-blob>
        {vault.blob}
      </pre>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" className={BTN} onClick={vault.restart}>
          simulate restart (hydrate + merge)
        </button>
        <button type="button" className={BTN} onClick={vault.resetView}>
          reset view
        </button>
      </div>
      <div className="mt-2 space-y-1" data-restore-report={r ? (r.relocated ? "relocated" : "restored") : "none"}>
        <Readout label="restore" value={r ? `${r.kept} re-expanded · ${r.droppedExpanded} dropped · ${r.droppedFilters} unknown filters` : "not yet"} />
        <Readout label="landed on" value={r ? `${vault.store.entries.get(r.landedOn)?.name ?? r.landedOn}${r.relocated ? " (nearest surviving ancestor)" : ""}` : "—"} tone={r?.relocated ? "text-warn" : "text-slate-200"} />
      </div>
      <p className="mt-2 type-caption text-slate-500">Not in the blob: selection (armed intent) and scroll (positional). Restore is a merge with the store, never a replay.</p>
    </Region>
  );
}
