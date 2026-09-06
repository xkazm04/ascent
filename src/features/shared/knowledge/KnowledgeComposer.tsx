"use client";

// The dispatch composer — use case 2's hand. One repo, its next act, and (for conform) the subjects
// the operator picked off the matrix. It COMPOSES; it never judges: the server builds one
// deterministic brief per repo (`src/lib/registry/dispatch-brief.ts`) that tells an agent to run the
// registry's own skills in the repo and commit the map, and the sweep reads the result back.
//
// Two doors, one record. "Compose brief" records a `handed_off` dispatch and hands the text to the
// operator to paste into any agent session; "Run here" (self-hosted, autopilot on) spawns the local
// agent on the paired working copy, which proposes a PR. Both close through the sweep, never through
// a button that says "done".

import { Kicker, chipButtonClass } from "@/components/ui";
import type { KnowledgeView, RegistryDispatchRow, RegistryDispatchStage } from "@/lib/org/knowledge-shape";
import { KnowledgeComposerContexts } from "./KnowledgeComposerContexts";
import { StageChip } from "./KnowledgeShared";
import { STAGE_ACTION, fmtCost, indexCells, sweepAge } from "./knowledgeModel";
import type { KnowledgeActionsApi } from "./useKnowledgeActions";
import type { KnowledgeSelectionApi } from "./useKnowledgeSelection";

const STATUS_TONE: Record<RegistryDispatchRow["status"], string> = {
  handed_off: "text-slate-400",
  running: "text-accent",
  proposed: "text-accent-soft",
  done: "text-success-soft",
  failed: "text-danger",
  superseded: "text-slate-600",
};

export function DispatchLedger({ rows, limit = 6 }: { rows: RegistryDispatchRow[]; limit?: number }) {
  if (!rows.length) return <p className="type-caption text-slate-600">No hand-offs yet.</p>;
  return (
    <ul className="divide-y divide-divider rounded-xl border border-divider">
      {rows.slice(0, limit).map((d) => (
        <li key={d.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 type-caption">
          <span className="type-mono-sm text-slate-200">{d.repoFullName.split("/").pop()}</span>
          <span className="text-slate-500">{STAGE_ACTION[d.stage]}</span>
          <span className="text-slate-600">{d.mode === "local" ? "ran here" : "brief"}</span>
          <span className={`font-mono ${STATUS_TONE[d.status]}`}>{d.status.replace("_", " ")}</span>
          {d.subjects.length ? <span className="text-slate-600">{d.subjects.length} subjects</span> : null}
          {d.prUrl ? (
            <a className="focus-ring text-accent hover:text-accent-soft" href={d.prUrl} target="_blank" rel="noreferrer">
              PR ↗
            </a>
          ) : null}
          {d.error ? <span className="text-danger" title={d.error}>failed</span> : null}
          {d.costMicros != null ? <span className="font-mono text-slate-500">{fmtCost(d.costMicros)}</span> : null}
          <span className="ml-auto text-slate-600">{sweepAge(d.createdAt)}</span>
        </li>
      ))}
    </ul>
  );
}

export function KnowledgeComposer({
  view,
  api,
  actions,
  className = "",
}: {
  view: KnowledgeView;
  api: KnowledgeSelectionApi;
  actions: KnowledgeActionsApi;
  className?: string;
}) {
  const { sel, repoRow } = api;
  const { state } = actions;
  const conform = repoRow?.stage === "conform" || repoRow?.stage === "current";
  // The next ACT for the repo: a current repo can still be asked to conform (a picked cell is the
  // reason), so `current` folds into `conform`; populate and map are themselves.
  const stage: RegistryDispatchStage | null = !repoRow ? null : conform ? "conform" : repoRow.stage === "populate" || repoRow.stage === "map" ? repoRow.stage : null;
  const ready = !!repoRow && stage !== null && (conform ? sel.picked.length > 0 : true) && !state.pending;
  const busy = (a: string) => state.pending === a;
  const cells = indexCells(view.cells);
  const picks = repoRow
    ? sel.picked.flatMap((slug) => {
        const subject = view.subjects.find((s) => s.slug === slug);
        return subject ? [{ subject, cell: cells.get(slug, repoRow.repositoryId) }] : [];
      })
    : [];

  return (
    <section className={`space-y-3 rounded-2xl border border-divider bg-surface/40 p-4 ${className}`} aria-label="Dispatch composer">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Kicker>Dispatch</Kicker>
        {repoRow ? (
          <span className="flex items-center gap-2 type-mono-sm text-slate-200">
            {repoRow.fullName}
            <StageChip stage={repoRow.stage} />
          </span>
        ) : (
          <span className="type-caption text-slate-500">pick a repo column, or cells on the matrix</span>
        )}
      </div>

      {repoRow && stage ? (
        <>
          <p className="type-body-sm text-slate-400">
            Next act: <span className="text-slate-200">{STAGE_ACTION[repoRow.stage]}</span>
            {conform ? (
              <>
                {" "}
                · <span className="font-mono tabular-nums text-slate-200">{sel.picked.length}</span> subject{sel.picked.length === 1 ? "" : "s"} picked
              </>
            ) : null}
          </p>
          {conform && sel.picked.length ? (
            <div className="flex flex-wrap gap-1.5">
              {sel.picked.map((s) => (
                <button key={s} type="button" className={chipButtonClass("idle", "py-0.5 type-caption")} onClick={() => api.toggleCell(repoRow.repositoryId, s)} title="Remove from the brief">
                  {s} <span className="text-slate-600">×</span>
                </button>
              ))}
              <button type="button" className="focus-ring type-caption text-slate-500 hover:text-slate-300" onClick={api.clearPicks}>
                clear
              </button>
            </div>
          ) : null}
          {conform && !sel.picked.length ? (
            <p className="type-caption text-slate-500">Pick the cells to judge — unjudged, stale, deviation or candidate — in this repo&rsquo;s column.</p>
          ) : null}
          {conform && (picks.length || repoRow.mapBehind) ? (
            <KnowledgeComposerContexts
              repo={repoRow}
              picks={picks}
              canBrief={view.capabilities.canBrief}
              pending={!!state.pending}
              onMapBrief={() => actions.composeBrief(repoRow.repositoryId, "map", [])}
            />
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {view.capabilities.canBrief ? (
              <button type="button" className={chipButtonClass("idle")} disabled={!ready} onClick={() => actions.composeBrief(repoRow.repositoryId, stage, sel.picked)}>
                {busy("brief") ? "Composing…" : "Compose brief"}
              </button>
            ) : (
              <span className="type-caption text-slate-600">Briefs need the admin role.</span>
            )}
            {view.capabilities.canRunLocal ? (
              <button type="button" className={chipButtonClass("success")} disabled={!ready} onClick={() => actions.runLocal(repoRow.repositoryId, stage, sel.picked)}>
                {busy("local") ? "Dispatching…" : "Run here"}
              </button>
            ) : (
              <span className="type-caption text-slate-600">Run here needs a self-hosted deployment with ASCENT_AUTOPILOT and a paired repo.</span>
            )}
          </div>
          {state.brief ? (
            <div className="space-y-1.5">
              <pre className="max-h-48 overflow-auto rounded-lg border border-divider bg-ink p-3 type-caption text-slate-400 whitespace-pre-wrap">{state.brief}</pre>
              <div className="flex gap-2">
                <button type="button" className={chipButtonClass("idle", "py-0.5 type-caption")} onClick={actions.copyBrief}>
                  Copy brief
                </button>
                <button type="button" className="focus-ring type-caption text-slate-500 hover:text-slate-300" onClick={actions.clearBrief}>
                  dismiss
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {state.error ? <p className="type-caption text-danger">{state.error}</p> : null}
      {state.notice ? <p className="type-caption text-slate-400">{state.notice}</p> : null}

      <div className="space-y-1.5 border-t border-divider pt-3">
        <Kicker tone="muted">Recent hand-offs</Kicker>
        <DispatchLedger rows={view.dispatches} />
      </div>
    </section>
  );
}
