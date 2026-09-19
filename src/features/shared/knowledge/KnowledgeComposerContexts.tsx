"use client";

// What a conform brief will actually ask for, unfolded: under each picked subject, the contexts of
// the picked repo that subscribe to it — one row per pair, worst first — and how each was judged
// against the subject's current revision. The composer's chips name subjects; this names the work.
//
// A repo whose registry map is behind its context map gets one line above the rows, with the
// existing compose-brief action pointed at the `map` stage: subscriptions are owed before verdicts.

import { chipButtonClass } from "@/components/ui";
import type { KnowledgeCell, KnowledgeRepo, KnowledgeSubject } from "@/lib/org/knowledge-shape";
import { STATE_CLASS, STATE_GLYPH, STATE_LABEL, readJudged, readRevision } from "./knowledgeModel";

export function KnowledgeComposerContexts({
  repo,
  picks,
  canBrief,
  pending,
  onMapBrief,
}: {
  repo: KnowledgeRepo;
  /** The picked subjects in pick order, each with its cell in this repo's column. */
  picks: { subject: KnowledgeSubject; cell: KnowledgeCell | undefined }[];
  canBrief: boolean;
  pending: boolean;
  onMapBrief: () => void;
}) {
  return (
    <div className="space-y-2">
      {repo.mapBehind ? (
        <p className="flex flex-wrap items-center gap-2 type-caption text-danger">
          <span>
            map behind the context map ({repo.contextMapRevision ?? "?"} → {repo.repoContextMapRevision ?? "?"})
          </span>
          {canBrief ? (
            <button type="button" className={chipButtonClass("danger", "py-0 type-caption")} disabled={pending} onClick={onMapBrief}>
              Compose map brief
            </button>
          ) : null}
        </p>
      ) : null}
      {picks.map(({ subject, cell }) => (
        <div key={subject.slug} className="space-y-0.5">
          <p className="type-caption font-mono text-slate-300">
            {subject.slug} <span className="text-slate-600">· {readRevision(subject)}</span>
          </p>
          {cell?.contextRows.length ? (
            <ul className="space-y-0.5 pl-3">
              {cell.contextRows.map((row) => (
                <li key={row.name} className="flex items-baseline gap-2 type-caption text-slate-400">
                  <span className={`inline-flex h-4 w-4 shrink-0 items-center justify-center font-mono type-micro ${STATE_CLASS[row.state]}`} aria-hidden>
                    {STATE_GLYPH[row.state]}
                  </span>
                  <span className="text-slate-200">{row.name}</span>
                  <span className="text-slate-500">
                    — {STATE_LABEL[row.state].toLowerCase()} · {readJudged(row, subject.revision)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="pl-3 type-caption text-slate-600">no context subscribes to it yet — the brief asks for a direction</p>
          )}
        </div>
      ))}
    </div>
  );
}
