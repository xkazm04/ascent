"use client";

// selection-model: the bulk bar derives EVERYTHING from the selection set — the count, the
// identity list, which actions apply — one producer, many consumers. The count carries its
// predicate: "N identities" for a materialized set, "everything matching (M) minus K" for a
// predicate selection over the unloaded universe. Items that vanish on refresh drop out visibly.

import { motion } from "framer-motion";
import { BTN, Readout, Region } from "./sceneParts";
import type { Vault } from "./useVault";

export function SelectionRegion({ vault, reduced }: { vault: Vault; reduced: boolean }) {
  const { sel, visible, matching } = vault;
  const loaded = visible.map((e) => e.id);
  const aimed = sel.resolve(matching.map((e) => e.id));
  const count = aimed.length;
  const predicate = sel.sel.mode === "predicate" ? `everything matching (${matching.length.toLocaleString()}) minus ${sel.sel.exclude.size} excluded` : `${count} identit${count === 1 ? "y" : "ies"} (of ${loaded.length} loaded)`;
  const name = (id: string | null) => (id ? (vault.store.entries.get(id)?.name ?? `${id} (gone)`) : "—");
  return (
    <Region technique="selection-model" title="Selection is a set of identities" note="Anchor and focus are identities too. Range resolves in visual order at the gesture, then is stored as ids.">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={BTN} onClick={() => sel.selectLoaded(loaded)}>
          select all loaded ({loaded.length})
        </button>
        <button type="button" className={BTN} onClick={sel.selectMatching}>
          select all matching ({matching.length.toLocaleString()}) as predicate
        </button>
        <button type="button" className={BTN} onClick={() => sel.invertLoaded(loaded)}>
          invert loaded
        </button>
        <button type="button" className={BTN} onClick={sel.clear} disabled={count === 0}>
          clear
        </button>
      </div>
      <motion.div
        key={count > 0 ? "bar" : "none"}
        initial={reduced || count === 0 ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className={`mt-3 rounded-md border px-3 py-2 ${count > 0 ? "border-accent/50 bg-accent/10" : "border-divider"}`}
        role="status"
        aria-live="polite"
        data-selection-mode={sel.sel.mode}
        data-selected-count={count}
      >
        <span className="type-mono-sm tabular-nums text-white">{count.toLocaleString()} selected</span>
        <span className="ml-2 type-caption text-slate-400">— {predicate}</span>
      </motion.div>
      <div className="mt-2 grid gap-1 sm:grid-cols-2">
        <Readout label="anchor" value={name(sel.anchor)} />
        <Readout label="focus" value={name(sel.focus)} />
        <Readout label="dropped since aim" value={<span data-dropped={sel.dropped}>{sel.dropped}</span>} tone={sel.dropped > 0 ? "text-warn" : "text-slate-200"} />
        <Readout label="next mutation receives" value={`${count.toLocaleString()} ids`} />
      </div>
      <p className="mt-2 type-caption text-slate-500">
        {sel.sel.mode === "predicate" ? "A predicate is resolved by the store at fire time — the partial window is never called everything." : "Select-all against the window says loaded; the other button is the honest way to mean everything."}
      </p>
    </Region>
  );
}
