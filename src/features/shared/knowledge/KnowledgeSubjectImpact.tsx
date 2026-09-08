"use client";

// A subject's blast radius across the fleet: its revision line, how many contexts subscribe to it
// across how many repos and how many of those verdicts are stale, then the contexts BY NAME per
// repo — a count names nothing actionable; a context name is where the golden path is read next.

import { useState } from "react";
import { Kicker } from "@/components/ui";
import type { KnowledgeRepo, KnowledgeSubject, KnowledgeView } from "@/lib/org/knowledge-shape";
import { type CellIndex, STATE_CLASS, STATE_GLYPH, STATE_LABEL, columnRepos, readRevision } from "./knowledgeModel";

const FOLD_AT = 6;

export function KnowledgeSubjectImpact({ view, subject, cells }: { view: KnowledgeView; subject: KnowledgeSubject; cells: CellIndex }) {
  const rows = columnRepos(view.repos)
    .map((r) => ({ repo: r, cell: cells.get(subject.slug, r.repositoryId) }))
    .filter((x): x is { repo: KnowledgeRepo; cell: NonNullable<typeof x.cell> } => !!x.cell && x.cell.contextRows.length > 0);
  const contexts = rows.reduce((n, x) => n + x.cell.contextRows.length, 0);
  const stale = rows.reduce((n, x) => n + x.cell.contextRows.filter((c) => c.stale).length, 0);

  return (
    <section className="space-y-2">
      <Kicker tone="muted">Impact</Kicker>
      <p className="type-mono-sm text-slate-400">
        {readRevision(subject)} · {contexts} context{contexts === 1 ? "" : "s"} across {rows.length} repo{rows.length === 1 ? "" : "s"} · {stale} stale
      </p>
      {rows.length ? (
        <ul className="space-y-1.5">
          {rows.map((x) => (
            <ImpactRepo key={x.repo.repositoryId} name={x.repo.fullName} rows={x.cell.contextRows} />
          ))}
        </ul>
      ) : (
        <p className="type-caption text-slate-600">No swept repo has a context subscribed to this subject.</p>
      )}
    </section>
  );
}

function ImpactRepo({ name, rows }: { name: string; rows: { name: string; state: keyof typeof STATE_GLYPH; stale: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const shown = open ? rows : rows.slice(0, FOLD_AT);
  const hidden = rows.length - shown.length;
  return (
    <li className="space-y-0.5">
      <p className="type-caption font-mono text-slate-300">{name}</p>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 pl-3">
        {shown.map((c) => (
          <li key={c.name} className="inline-flex items-center gap-1.5 type-caption text-slate-400" title={`${STATE_LABEL[c.state]}${c.stale ? " (stale)" : ""}`}>
            <span className={`inline-flex h-4 w-4 items-center justify-center font-mono type-micro ${STATE_CLASS[c.state]}`} aria-hidden>
              {STATE_GLYPH[c.state]}
            </span>
            <span className={c.stale ? "underline decoration-dotted underline-offset-2" : ""}>{c.name}</span>
          </li>
        ))}
        {hidden > 0 || open ? (
          <li>
            <button type="button" className="focus-ring type-caption text-slate-500 hover:text-slate-300" onClick={() => setOpen((o) => !o)}>
              {open ? "show fewer" : `+${hidden} more`}
            </button>
          </li>
        ) : null}
      </ul>
    </li>
  );
}
