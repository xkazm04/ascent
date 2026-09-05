"use client";

// The dispatch composer — use case 2's hand. One repo, its next act, and (for conform) the subjects
// the operator picked off the matrix. It COMPOSES; it never judges: the brief tells an agent to run
// the registry's own skills in the repo and commit the map, and the sweep reads the result back.
//
// PROTOTYPE NOTE: the real brief is built server-side (WP2, deterministic, one artifact per repo).
// This preview mirrors its shape so the operator can judge the flow; "Copy" copies the preview and
// "Run here" is inert and says so.

import { useState } from "react";
import { Kicker, chipButtonClass } from "@/components/ui";
import type { KnowledgeRepo, KnowledgeView, RegistryDispatchRow } from "@/lib/org/knowledge-shape";
import { StageChip } from "./KnowledgeShared";
import { STAGE_ACTION, fmtCost, sweepAge } from "./knowledgeModel";
import type { KnowledgeSelectionApi } from "./useKnowledgeSelection";

export function briefPreview(repo: KnowledgeRepo, subjects: string[], registry: string | null): string {
  const reg = registry ?? "<registry>";
  const head = `# Ascent · registry hand-off for ${repo.fullName}\n\nRead AGENTS.md / CLAUDE.md first. Branch first. Smallest real change. The standard does not bend to the code.\n`;
  if (repo.stage === "populate") return `${head}\n1. /project-populate contexts  → commit context-map.json\n2. node ${reg}/scripts/build-registry-map.mjs --project ${repo.fullName.split("/").pop()}\n3. commit .ai/registry-map.json — Ascent sweeps it.\n`;
  if (repo.stage === "map") return `${head}\n1. node ${reg}/scripts/build-registry-map.mjs --project ${repo.fullName.split("/").pop()}\n2. commit .ai/registry-map.json — Ascent sweeps it.\n`;
  const list = subjects.length ? subjects.map((s) => `   - /conform --subject ${s}`).join("\n") : "   (pick subjects on the matrix)";
  return `${head}\n1. For each subject, budget ${subjects.length || "n"}:\n${list}\n2. Write verdicts into .ai/registry-map.json in place (state, evidence file:line, evaluatedAgainst).\n3. Commit the map — Ascent sweeps it and closes this hand-off.\n`;
}

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
          {d.costMicros != null ? <span className="font-mono text-slate-500">{fmtCost(d.costMicros)}</span> : null}
          <span className="ml-auto text-slate-600">{sweepAge(d.createdAt)}</span>
        </li>
      ))}
    </ul>
  );
}

export function KnowledgeComposer({ view, api, className = "" }: { view: KnowledgeView; api: KnowledgeSelectionApi; className?: string }) {
  const { sel, repoRow } = api;
  const [note, setNote] = useState<string | null>(null);
  const registry = view.registry?.fullName ? `../${view.registry.fullName.split("/").pop()}` : null;
  const conform = repoRow?.stage === "conform" || repoRow?.stage === "current";
  const ready = !!repoRow && (conform ? sel.picked.length > 0 : repoRow.stage !== "current");
  const preview = repoRow ? briefPreview(repoRow, sel.picked, registry) : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(preview);
      setNote("Brief copied — paste it into a local agent session. Ascent closes the hand-off when the map lands.");
    } catch {
      setNote("Clipboard unavailable — select the preview and copy it by hand.");
    }
  };

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
          <span className="type-caption text-slate-500">pick a repo, or cells on the matrix</span>
        )}
      </div>

      {repoRow ? (
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
          <pre className="max-h-40 overflow-auto rounded-lg border border-divider bg-ink p-3 type-caption text-slate-400 whitespace-pre-wrap">{preview}</pre>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={chipButtonClass("idle")} disabled={!ready || !view.capabilities.canBrief} onClick={copy}>
              Copy brief
            </button>
            {view.capabilities.canRunLocal ? (
              <button type="button" className={chipButtonClass("success")} disabled={!ready} onClick={() => setNote("Preview: nothing was dispatched. In the real tab this spawns a headless agent in the paired worktree and opens a PR.")}>
                Run here
              </button>
            ) : (
              <span className="type-caption text-slate-600">Run here needs a self-hosted deployment with ASCENT_AUTOPILOT.</span>
            )}
            {!view.capabilities.canBrief ? <span className="type-caption text-slate-600">Briefs need the admin role.</span> : null}
          </div>
          {note ? <p className="type-caption text-slate-400">{note}</p> : null}
        </>
      ) : null}

      <div className="space-y-1.5 border-t border-divider pt-3">
        <Kicker tone="muted">Recent hand-offs</Kicker>
        <DispatchLedger rows={view.dispatches} />
      </div>
    </section>
  );
}
