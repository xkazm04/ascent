"use client";

// listing-and-refresh: the directory read under a DECLARED contract (shallow, a window, an exclusion
// policy, an order), with per-entry error policy (skip-and-count, then disclose) and the two zero
// cases spelled differently. The rows are a cache taken at a store tick; the "sync agent" button is
// the other window writing to the store without telling the view — the stale badge is the admitted
// window, and refresh replaces the data, never the session (selection and expansion survive by identity).

import { fmtBytes, WINDOW } from "./fixtures";
import { LISTING_POLICY } from "./store";
import { BTN, KindGlyph, Readout, Region } from "./sceneParts";
import type { Vault } from "./useVault";

export function ListingRegion({ vault }: { vault: Vault }) {
  const { listing, visible, matching, stale, sel } = vault;
  const order = visible.map((e) => e.id);
  const dirName = vault.store.entries.get(listing.dirId)?.name ?? listing.dirId;
  const status = listing.status === "ok" && matching.length === 0 && listing.all.length > 0 ? "filtered-out" : listing.status;
  return (
    <Region technique="listing-and-refresh" title="A directory read is a cache" note="Contract: shallow · 40-row window · dot-files excluded · containers first. Unreadable entries are skipped, counted, disclosed.">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="type-caption text-slate-400" data-listing-tick={listing.tick} data-stale={stale}>
          view of <span className="text-slate-200">{dirName}</span> as of t{listing.tick} · store at t{vault.store.tick}
        </span>
        <span className={`rounded px-1.5 type-micro ${stale ? "bg-warn/10 text-warn" : "text-slate-600"}`}>{stale ? "stale" : "current"}</span>
        <button type="button" className={BTN} onClick={vault.refresh} aria-label="Refresh the listing">
          refresh
        </button>
        <button type="button" className={BTN} onClick={vault.churnStore} aria-label="Another writer changes the store">
          sync agent writes
        </button>
      </div>
      <ul className="max-h-64 space-y-0.5 overflow-auto rounded-lg border border-divider p-1" aria-label={`Entries in ${dirName}`} data-listing-status={status}>
        {status === "unreadable" ? <li className="p-2 type-caption text-danger">Could not read this directory (permission refused). Nothing is known about its contents.</li> : null}
        {status === "missing" ? <li className="p-2 type-caption text-warn">This folder no longer exists. The store removed it; go up.</li> : null}
        {status === "empty" ? <li className="p-2 type-caption text-slate-500">Nothing here — the directory read succeeded and it is empty.</li> : null}
        {status === "filtered-out" ? <li className="p-2 type-caption text-slate-500">{listing.all.length} entries here, none match the active kind filter.</li> : null}
        {visible.map((e) => {
          const on = sel.isSelected(e.id);
          const focused = sel.focus === e.id;
          return (
            <li key={e.id} data-row={e.id} data-selected={on}>
              <div
                role="button"
                tabIndex={0}
                aria-pressed={on}
                className={`focus-ring flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1 transition-colors ${on ? "border-accent/60 bg-accent/10" : "border-transparent hover:bg-surface/60"} ${focused ? "ring-1 ring-slate-600" : ""}`}
                onClick={(ev) => sel.click(e.id, { toggle: ev.ctrlKey || ev.metaKey, range: ev.shiftKey }, order)}
                onDoubleClick={() => (e.isDir ? vault.navigate(e.id) : undefined)}
                onKeyDown={(ev) => {
                  if (ev.key === " ") {
                    ev.preventDefault();
                    sel.click(e.id, { toggle: true }, order);
                  } else if (ev.key === "Enter") {
                    if (e.isDir) vault.navigate(e.id);
                    else sel.click(e.id, {}, order);
                  }
                }}
              >
                <KindGlyph kind={e.kind} />
                <span className={`min-w-0 flex-1 truncate type-caption ${e.isDir ? "text-slate-200" : "text-slate-300"}`}>{e.name}</span>
                <span className="type-micro text-slate-600">{e.kind}</span>
                <span className="w-14 text-right type-micro tabular-nums text-slate-500">{e.isDir ? "" : fmtBytes(e.size)}</span>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 grid gap-1 sm:grid-cols-2">
        <Readout label="loaded / matching" value={`${visible.length} / ${matching.length.toLocaleString()} (window ${WINDOW})`} />
        <Readout label="could not read" value={<span data-skipped={listing.skipped}>{listing.skipped}</span>} tone={listing.skipped > 0 ? "text-warn" : "text-slate-200"} />
        <Readout label="excluded by policy" value={`${listing.hidden} (${LISTING_POLICY.exclusion.split(" (")[0]})`} />
        <Readout label="order" value="folders first · tiebreak id" />
      </div>
      {vault.journal.length > 0 ? (
        <ul className="mt-2 space-y-0.5 rounded-md border border-dashed border-divider p-2" aria-label="The other window's journal">
          {vault.journal.map((line) => (
            <li key={line} className="type-micro text-slate-500">
              {line}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-2 type-caption text-slate-500">Click selects · Ctrl/⌘ toggles · Shift ranges · double-click or Enter opens a folder. Staleness window: current as of navigation, refresh, and every mutation of our own.</p>
    </Region>
  );
}
