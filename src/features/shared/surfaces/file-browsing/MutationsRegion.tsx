"use client";

// file-mutations: rename, move and trash against a store the sync agent also writes. Preflight is
// shown as ADVISORY; the store's verdict at fire time is typed and rendered per case. Move and trash
// share one guard door (planMove) and report PER ITEM — "moved 12 of 15, 3 failed" with the failures
// enumerated and retryable. Conflicts are a chosen policy, never a silent clobber. The trash is a
// soft delete whose reaper is named beside it.

import { useState } from "react";
import { motion } from "framer-motion";
import { SelectInput, TextInput } from "@/components/ui";
import { TRASH } from "./fixtures";
import { isFailure, preflightRename, TRASH_CAP, type ConflictPolicy, type Verdict } from "./mutations";
import { BTN, Readout, Region } from "./sceneParts";
import type { Vault } from "./useVault";

const VERDICT_COPY: Record<Verdict, string> = {
  ok: "renamed",
  gone: "source no longer exists — the view was stale and has been refreshed",
  "name-taken": "a different item now holds that name",
  root: "the store root cannot be renamed",
  "read-only": "permission denied by the store",
  "empty-name": "a name is required",
};

export function MutationsRegion({ vault, reduced }: { vault: Vault; reduced: boolean }) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState("d-memory");
  const [policy, setPolicy] = useState<ConflictPolicy>("skip");
  const focused = vault.focused;
  const aimed = vault.sel.resolve(vault.matching.map((e) => e.id)).length;
  const preflight = focused ? preflightRename(vault.store, focused.id, name) : null;
  const run = vault.run;
  const failed = run ? run.report.outcomes.filter(isFailure) : [];
  return (
    <Region technique="file-mutations" title="Every write is a race" note="Preflight narrows the window; the store's verdict closes it. Bulk work reports per item. One guard door for every move-shaped intent.">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <TextInput aria-label="New name" placeholder={focused ? `rename ${focused.name}` : "focus a row first"} value={name} onChange={(e) => setName(e.target.value)} disabled={!focused} />
          <div className="flex items-center gap-2">
            <button type="button" className={BTN} disabled={!focused} onClick={() => focused && vault.doRename(focused.id, name)}>
              rename
            </button>
            <span className="type-micro text-slate-500" data-preflight={preflight ?? "none"}>
              preflight (advisory): {preflight ?? "—"}
            </span>
          </div>
          <Readout label="verdict" value={<span data-verdict={vault.verdict ?? "none"}>{vault.verdict ? VERDICT_COPY[vault.verdict] : "—"}</span>} tone={vault.verdict && vault.verdict !== "ok" ? "text-warn" : "text-slate-200"} />
        </div>
        <div className="space-y-2">
          <SelectInput aria-label="Move to" value={target} onChange={(e) => setTarget(e.target.value)}>
            {vault.dirs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </SelectInput>
          <SelectInput aria-label="On conflict" value={policy} onChange={(e) => setPolicy(e.target.value as ConflictPolicy)}>
            <option value="skip">on conflict: skip</option>
            <option value="keep-both">on conflict: keep both (suffixed)</option>
            <option value="replace">on conflict: replace (states the loser)</option>
          </SelectInput>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={BTN} disabled={aimed === 0} onClick={() => vault.doMove(target, policy)} aria-label="Move selected">
              move {aimed.toLocaleString()}
            </button>
            <button type="button" className={BTN} disabled={aimed === 0} onClick={() => vault.doMove(TRASH, policy)} aria-label="Trash selected">
              trash {aimed.toLocaleString()}
            </button>
          </div>
        </div>
      </div>
      {run ? (
        <motion.div key={vault.store.tick} initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="mt-3 rounded-md border border-divider p-2" role="status" data-report={run.report.verb} data-report-failed={failed.length}>
          <p className={`type-caption ${failed.length > 0 ? "text-warn" : "text-slate-200"}`}>
            {run.report.verb}: {run.report.succeeded} of {run.report.attempted} — {failed.length} failed
            {run.report.refused.length > 0 ? ` · ${run.report.refused.length} refused by geometry` : ""}
            {run.report.reaped > 0 ? ` · reaper removed ${run.report.reaped} oldest from the trash` : ""}
          </p>
          <ul className="mt-1 max-h-24 space-y-0.5 overflow-auto">
            {run.report.refused.map((r) => (
              <li key={`r-${r.id}`} className="type-micro text-danger" data-refused={r.reason}>
                {r.name}: refused — {r.reason}
              </li>
            ))}
            {run.report.outcomes.map((o) => (
              <li key={o.id} className={`type-micro ${isFailure(o) ? "text-warn" : "text-slate-500"}`} data-outcome={o.outcome}>
                {o.name}: {o.outcome}
                {o.detail ? ` — ${o.detail}` : ""}
              </li>
            ))}
          </ul>
          {failed.length > 0 ? (
            <button type="button" className={`${BTN} mt-2`} onClick={vault.retryFailed}>
              retry {failed.length} failed
            </button>
          ) : null}
        </motion.div>
      ) : null}
      <div className="mt-3">
        <Readout label="trash" value={<span data-trash-count={vault.trash.length}>{`${vault.trash.length} / ${TRASH_CAP} · reaper: oldest past the cap`}</span>} />
        {vault.trash.length > 0 ? (
          <ul className="mt-1 max-h-20 space-y-0.5 overflow-auto">
            {vault.trash.slice(-5).map((t) => (
              <li key={t.id} className="flex items-center justify-between type-micro text-slate-500">
                <span>
                  {t.name} · from {vault.store.entries.get(t.origin ?? "")?.name ?? "a folder now gone"}
                </span>
                <button type="button" className={BTN} onClick={() => vault.doRestore(t.id)} aria-label={`Restore ${t.name}`}>
                  restore
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Region>
  );
}
