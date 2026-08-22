"use client";

// INSPECT mode — the right rail while nothing is running. It answers three questions about the
// current selection, in the order an operator asks them: what did I select, what do these repos have
// in COMMON, and what exactly would each lane work? Then one CTA.
//
// PAIRING RULE. A loop lane edits a real working copy, so a selected repo with no local pairing
// cannot run. Rather than disabling the whole CTA (which would punish a lasso for catching one
// unpaired repo), the unpaired rows are flagged and EXCLUDED, and the CTA counts only what will
// actually run — dropping to disabled when that count is zero.

import { useEffect, useMemo, useState } from "react";
import { Field, Kicker, SelectInput } from "@/components/ui";
import { InlineEmpty } from "@/components/org/shared/ui";
import { LOOP_CONCURRENCY_CAP, LOOP_MAX_CYCLES_CAP } from "@/lib/db/loop-runs-types";
import { ProposalList, SharedDimensionBars } from "./CockpitBatch";
import { proposalDimensions, sharedDimensions } from "./cockpitDimensions";
import type { StartLoopInput } from "./loopClient";
import type { LoopProposal } from "./loopTypes";

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_CYCLES = 3;
/** A lasso drags through dozens of intermediate selections; only the one it settles on is queried. */
const PROPOSE_DEBOUNCE_MS = 350;

export interface CockpitInspectorProps {
  selected: ReadonlySet<string>;
  /** Repos with a local pairing — the only ones a lane can be dispatched into. */
  paired: ReadonlySet<string>;
  propose: (repos: readonly string[]) => Promise<LoopProposal[] | null>;
  onRun: (input: StartLoopInput) => void;
  canRun: boolean;
  /** Why running is unavailable (hosted, not owner, autopilot off) — shown in place of the CTA. */
  blockedReason?: string | null;
  busy?: boolean;
}

export function CockpitInspector({ selected, paired, propose, onRun, canRun, blockedReason = null, busy = false }: CockpitInspectorProps) {
  // Keyed by the selection they were fetched FOR, so a stale response can never be read against a
  // selection it does not describe (and an emptied selection needs no state write at all).
  const [fetched, setFetched] = useState<{ key: string; proposals: LoopProposal[] }>({ key: "", proposals: [] });
  const [loading, setLoading] = useState(false);
  const [pruned, setPruned] = useState<ReadonlySet<string>>(() => new Set());
  const [dimFocus, setDimFocus] = useState<string | null>(null);
  const [concurrency, setConcurrency] = useState(DEFAULT_CONCURRENCY);
  const [cycles, setCycles] = useState(DEFAULT_CYCLES);

  const repos = useMemo(() => [...selected].sort(), [selected]);
  const key = repos.join(",");
  const proposals = useMemo(() => (fetched.key === key ? fetched.proposals : []), [fetched, key]);

  useEffect(() => {
    if (repos.length === 0) return;
    let alive = true;
    const t = setTimeout(() => {
      setLoading(true);
      void propose(repos).then((res) => {
        if (!alive) return;
        setFetched({ key, proposals: res ?? [] });
        setLoading(false);
      });
    }, PROPOSE_DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // `key` is the stable identity of the selection; `repos` is a fresh array every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, propose]);

  const unpaired = useMemo(() => new Set(repos.filter((r) => !paired.has(r))), [repos, paired]);
  const runnable = useMemo(() => repos.filter((r) => paired.has(r)), [repos, paired]);
  const shares = useMemo(() => sharedDimensions(proposals, selected), [proposals, selected]);
  const dims = useMemo(() => proposalDimensions(proposals), [proposals]);

  const togglePrune = (id: string) => {
    const next = new Set(pruned);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPruned(next);
  };

  const run = () => {
    const batches: Record<string, string[]> = {};
    for (const p of proposals) {
      if (!paired.has(p.repo)) continue;
      const ids = p.items.filter((i) => !pruned.has(i.id) && (!dimFocus || i.dimId === dimFocus)).map((i) => i.id);
      if (ids.length > 0) batches[p.repo] = ids;
    }
    const curated = Object.keys(batches).length > 0;
    onRun({ repos: runnable, batches: curated ? batches : undefined, concurrency, maxCycles: cycles });
  };

  if (repos.length === 0) {
    return (
      <div>
        <Kicker tone="accent">Inspector</Kicker>
        <InlineEmpty>Lasso or click bodies to select the repos this run should work.</InlineEmpty>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Kicker tone="accent">Inspector</Kicker>
        <span className="font-mono text-xs tabular-nums text-slate-500">{repos.length} selected</span>
      </div>
      <ul className="mt-2 flex flex-wrap gap-1">
        {repos.slice(0, 12).map((r) => (
          <li
            key={r}
            className={`rounded border px-1.5 py-px font-mono text-xs ${
              unpaired.has(r) ? "border-warn/50 text-warn" : "border-divider text-slate-400"
            }`}
            title={unpaired.has(r) ? `${r} — no local pairing` : r}
          >
            {r.split("/")[1] ?? r}
          </li>
        ))}
        {repos.length > 12 && <li className="font-mono text-xs text-slate-600">+{repos.length - 12} more</li>}
      </ul>

      <SharedDimensionBars shares={shares} />

      <div className="mt-4 grid grid-cols-3 gap-3">
        <Field label="Focus">
          <SelectInput value={dimFocus ?? ""} onChange={(e) => setDimFocus(e.target.value || null)}>
            <option value="">All dimensions</option>
            {dims.map((d) => (
              <option key={d.id} value={d.id}>
                {d.id} · {d.label}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Lanes at once">
          <SelectInput value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))}>
            {Array.from({ length: LOOP_CONCURRENCY_CAP }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Cycles">
          <SelectInput value={cycles} onChange={(e) => setCycles(Number(e.target.value))}>
            {Array.from({ length: LOOP_MAX_CYCLES_CAP }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>

      <ProposalList
        proposals={proposals}
        pruned={pruned}
        onTogglePrune={togglePrune}
        dimFocus={dimFocus}
        unpaired={unpaired}
        loading={loading}
      />

      {blockedReason || !canRun ? (
        <p className="mt-4 font-mono text-xs text-slate-500">{blockedReason ?? "Running the loop needs org-owner access."}</p>
      ) : (
        <button
          type="button"
          onClick={run}
          disabled={busy || runnable.length === 0}
          className="focus-ring mt-4 w-full rounded-md bg-accent px-3 py-2 font-mono text-xs uppercase tracking-[0.18em] text-on-accent transition hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-40"
        >
          {runnable.length === 0 ? "No paired repos selected" : `Run (${runnable.length} ${runnable.length === 1 ? "repo" : "repos"})`}
        </button>
      )}
    </div>
  );
}
