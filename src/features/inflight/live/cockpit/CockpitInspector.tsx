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
import { Kicker } from "@/components/ui";
import { BriefStrip, InspectorEmpty } from "./BriefStrip";
import { ProposalList, SharedDimensionBars } from "./CockpitBatch";
import { CockpitRunControls } from "./CockpitRunControls";
import { proposalDimensions, sharedDimensions } from "./cockpitDimensions";
import { useRunDials } from "./useRunDials";
import type { StartDriveInput } from "./driveClient";
import type { StartLoopInput } from "./loopClient";
import type { LoopProposal } from "./loopTypes";

/** A lasso drags through dozens of intermediate selections; only the one it settles on is queried. */
const PROPOSE_DEBOUNCE_MS = 350;

export interface CockpitInspectorProps {
  selected: ReadonlySet<string>;
  /** Repos with a local pairing — the only ones a lane can be dispatched into. */
  paired: ReadonlySet<string>;
  propose: (repos: readonly string[]) => Promise<LoopProposal[] | null>;
  onRun: (input: StartLoopInput) => void;
  /** Start a DRIVE over the same scope: runs until green, dry, or the run budget is spent. */
  onDrive: (input: StartDriveInput) => void;
  canRun: boolean;
  /** Drive shares the loop's gate; false only when the deployment cannot start one at all. */
  canDrive?: boolean;
  /** A failed start (the server's own 409 copy) — shown next to the buttons that produced it. */
  error?: string | null;
  /** Why running is unavailable (hosted, not owner, autopilot off) — shown in place of the CTA. */
  blockedReason?: string | null;
  busy?: boolean;
}

export function CockpitInspector(props: CockpitInspectorProps) {
  const { selected, paired, propose, onRun, onDrive, canRun, canDrive = true, blockedReason = null, busy = false, error = null } = props;
  // Keyed by the selection they were fetched FOR, so a stale response can never be read against a
  // selection it does not describe (and an emptied selection needs no state write at all).
  const [fetched, setFetched] = useState<{ key: string; proposals: LoopProposal[] }>({ key: "", proposals: [] });
  const [loading, setLoading] = useState(false);
  const [pruned, setPruned] = useState<ReadonlySet<string>>(() => new Set());
  // Six dials in one piece of state (useRunDials) — the run and the drive read the SAME values, which
  // is what makes them two ways of arming one experiment rather than two configurations.
  const { dials, set } = useRunDials();

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
      const ids = p.items.filter((i) => !pruned.has(i.id) && (!dials.dimFocus || i.dimId === dials.dimFocus)).map((i) => i.id);
      if (ids.length > 0) batches[p.repo] = ids;
    }
    const curated = Object.keys(batches).length > 0;
    onRun({
      repos: runnable,
      batches: curated ? batches : undefined,
      concurrency: dials.concurrency,
      maxCycles: dials.cycles,
      model: dials.model,
      effort: dials.effort,
    });
  };

  // A drive picks its OWN batch before every run (the fleet is re-scored between them), so the
  // inspector's pruning and dimension focus deliberately do not travel with it — only the scope and
  // the three bounds do.
  const drive = () =>
    onDrive({
      repos: runnable,
      maxRuns: dials.maxRuns,
      maxCycles: dials.cycles,
      concurrency: dials.concurrency,
      // The agent configuration DOES travel with a drive, unlike the pruning above: it is a property
      // of how the work is done, not of which work was picked, so it survives the re-batching.
      model: dials.model,
      effort: dials.effort,
    });

  if (repos.length === 0) return <InspectorEmpty />;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Kicker tone="accent">Inspector</Kicker>
        <span className="type-caption tabular-nums text-slate-500">{repos.length} selected</span>
      </div>
      <ul className="mt-2 flex flex-wrap gap-1">
        {repos.slice(0, 12).map((r) => (
          <li
            key={r}
            className={`rounded border px-1.5 py-px type-caption ${
              unpaired.has(r) ? "border-warn/50 text-warn" : "border-divider text-slate-400"
            }`}
            title={unpaired.has(r) ? `${r} — no local pairing` : r}
          >
            {r.split("/")[1] ?? r}
          </li>
        ))}
        {repos.length > 12 && <li className="type-caption text-slate-600">+{repos.length - 12} more</li>}
      </ul>

      <SharedDimensionBars shares={shares} />

      <BriefStrip proposals={proposals} />

      <CockpitRunControls dims={dims} dials={dials} onChange={set} />

      <ProposalList
        proposals={proposals}
        pruned={pruned}
        onTogglePrune={togglePrune}
        dimFocus={dials.dimFocus}
        unpaired={unpaired}
        loading={loading}
      />

      {blockedReason || !canRun ? (
        <p className="mt-4 type-caption text-slate-500">{blockedReason ?? "Running the loop needs org-owner access."}</p>
      ) : (
        <>
          <button
            type="button"
            onClick={run}
            disabled={busy || runnable.length === 0}
            className="focus-ring mt-4 w-full rounded-md bg-accent px-3 py-2 type-label tracking-[0.18em] text-on-accent transition hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-40"
          >
            {runnable.length === 0 ? "No paired repos selected" : `Run (${runnable.length} ${runnable.length === 1 ? "repo" : "repos"})`}
          </button>
          {canDrive && (
            <>
              <button
                type="button"
                onClick={drive}
                disabled={busy || runnable.length === 0}
                className="focus-ring mt-2 w-full rounded-md border border-accent/60 px-3 py-2 type-label tracking-[0.18em] text-accent transition hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Drive to green
              </button>
              <p className="mt-1.5 type-note leading-relaxed text-slate-500">
                Runs again and again until every selected repo clears the band, a whole run moves nothing, or the{" "}
                {dials.maxRuns}-run budget is spent.
              </p>
            </>
          )}
        </>
      )}
      {error && <p className="mt-3 type-caption text-danger">{error}</p>}
    </div>
  );
}
