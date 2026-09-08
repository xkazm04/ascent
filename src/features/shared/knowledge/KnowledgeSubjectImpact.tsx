"use client";

// A subject's blast radius across the fleet: its revision line, the magnitude DRAWN as one bar per
// mapped repo, then the contexts BY NAME per repo — a count names nothing actionable; a context name
// is where the golden path is read next.
//
// THE FIX THIS PANEL EXISTS TO CARRY. It used to print "0 contexts across 0 repos · 0 stale" in two
// completely different situations: a subject genuinely nothing subscribes to, and a fleet that was
// never swept or carries no registry map at all. The second is not a zero, it is the absence of a
// measurement — so `subjectImpact` types it, and a `missing` / `not-judged` reading renders the kit's
// void or hatch with no numeral anywhere near it. `rendersValue()` is the rule; this is the shape of
// obeying it.

import { useState } from "react";
import { Kicker } from "@/components/ui";
import { STATE_HINT, StateSwatch, WhyChip } from "@/components/org/viz";
import type { KnowledgeSubject, KnowledgeView } from "@/lib/org/knowledge-shape";
import { type CellIndex, STATE_CLASS, STATE_GLYPH, STATE_LABEL, readRevision } from "./knowledgeModel";
import { KnowledgeImpactBars } from "./KnowledgeImpactBars";
import { subjectImpact } from "./knowledgeViz";

const FOLD_AT = 6;

/** Why the impact figure is unavailable — appended to the kit's sentence about the encoding itself. */
const WHY = {
  missing: "The fleet has never been swept, so no repository's registry map has been read; there is no impact figure yet, which is not the same as an impact of none.",
  "not-judged": "No repository carries an .ai/registry-map.json, so nothing can be known about which contexts this subject governs.",
} as const;

export function KnowledgeSubjectImpact({ view, subject, cells }: { view: KnowledgeView; subject: KnowledgeSubject; cells: CellIndex }) {
  const impact = subjectImpact(view, subject, cells);
  const named = impact.rows.filter((r) => r.contexts > 0);

  return (
    <section className="space-y-2">
      <Kicker tone="muted">Impact</Kicker>

      {impact.state === "measured" ? (
        <p className="type-mono-sm text-slate-400">
          {readRevision(subject)} · {impact.contexts} context{impact.contexts === 1 ? "" : "s"} across {impact.repos} repo
          {impact.repos === 1 ? "" : "s"} · {impact.stale} stale
        </p>
      ) : (
        // No numeral, by construction: the mark IS the reading, and the sentence is disclosed.
        <p className="flex flex-wrap items-center gap-2 type-mono-sm text-slate-500">
          <span aria-hidden className="inline-flex">
            <StateSwatch state={impact.state} size={10} />
          </span>
          <span>{readRevision(subject)} · impact not measured</span>
          <WhyChip hint={`${STATE_HINT[impact.state]} ${impact.state === "missing" ? WHY.missing : WHY["not-judged"]}`} label="impact not measured" />
        </p>
      )}

      {impact.rows.length ? <KnowledgeImpactBars rows={impact.rows} subject={subject.slug} /> : null}

      {named.length ? (
        <ul className="space-y-1.5">
          {named.map((x) => (
            <ImpactRepo key={x.repo.repositoryId} name={x.repo.fullName} rows={cells.get(subject.slug, x.repo.repositoryId)?.contextRows ?? []} />
          ))}
        </ul>
      ) : impact.state === "measured" ? (
        <p className="type-caption text-slate-600">No swept repo has a context subscribed to this subject.</p>
      ) : null}
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
