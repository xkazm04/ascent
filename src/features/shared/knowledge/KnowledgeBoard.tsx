"use client";

// Direction C — **Board**. The fleet moving through the registry's pipeline.
//
// Metaphor: a departures board. Four columns are the registry's own stages for a repo — populate →
// map → conform → current — and every repo is a card in exactly one of them, carrying its spectrum,
// its worst subjects and the single next act the registry asks of it. Selecting a card opens the
// repo's sheet: its subjects by category with pickable cells, the composer beside them. Use case 2
// is the hero; the matrix is read one repo at a time, the tree is the sheet's grouping.
//
// Why this direction: an operator running the fleet asks "what do I dispatch next", and a stage
// column answers it before any subject is read. Absences are still eleven states — a card's
// spectrum shows them — but the unit of attention is the repo, not the crossing.

import { Kicker, Stat, chipButtonClass } from "@/components/ui";
import { TILE_LEDGER } from "@/components/org/shared/ui";
import type { KnowledgeRepo, KnowledgeView } from "@/lib/org/knowledge-shape";
import { KnowledgeComposer } from "./KnowledgeComposer";
import { CellButton, DomainPicker, Spectrum, StateLegend, SweepStrip } from "./KnowledgeShared";
import { KnowledgeSubjectDetail } from "./KnowledgeSubjectDetail";
import { STAGE_ACTION, STAGE_LABEL, STAGE_ORDER, buildTree, countStates, flattenTree, indexCells, subjectsOf } from "./knowledgeModel";
import { useKnowledgeSelection } from "./useKnowledgeSelection";

export function KnowledgeBoard({ view }: { view: KnowledgeView }) {
  const api = useKnowledgeSelection(view);
  const { sel, domain, repoRow, subjectRow } = api;
  if (!domain) return null;
  const subjects = subjectsOf(view, domain.name);
  const tree = buildTree(domain.taxonomy, subjects);
  const ordered = flattenTree(tree);
  const cells = indexCells(view.cells);
  const repoCells = (r: KnowledgeRepo) => ordered.map((s) => cells.get(s.slug, r.repositoryId)).filter((c): c is NonNullable<typeof c> => !!c);
  const byStage = STAGE_ORDER.map((stage) => ({ stage, repos: view.repos.filter((r) => r.stage === stage).sort((a, b) => b.deviations - a.deviations) }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DomainPicker domains={view.domains} active={domain.name} onPick={api.setDomain} />
        <span className="type-caption text-slate-500">{view.repos.length} repos swept · {subjects.length} subjects of {domain.title}</span>
      </div>
      <SweepStrip view={view} />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {byStage.map(({ stage, repos }) => (
          <section key={stage} className="space-y-2 rounded-2xl border border-divider bg-surface/40 p-3" aria-label={STAGE_LABEL[stage]}>
            <div className="flex items-baseline justify-between px-1">
              <Kicker tone={stage === "current" ? "muted" : "accent"}>{STAGE_LABEL[stage]}</Kicker>
              <span className="type-micro font-mono text-slate-500">{repos.length}</span>
            </div>
            {repos.length ? (
              repos.map((r) => {
                const mine = repoCells(r);
                const counts = countStates(mine);
                const worst = mine.filter((c) => c.state === "deviation").slice(0, 3);
                const active = sel.repo === r.repositoryId;
                return (
                  <button
                    key={r.repositoryId}
                    type="button"
                    className={`focus-ring block w-full space-y-2 rounded-xl border p-3 text-left transition-colors ${active ? "border-accent bg-ink" : "border-divider bg-ink/60 hover:border-slate-500"}`}
                    onClick={() => api.focusRepo(active ? null : r.repositoryId)}
                    aria-pressed={active}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate type-body-sm text-slate-100">{r.fullName.split("/").pop()}</span>
                      <span className="type-micro font-mono text-slate-500">{r.contexts} ctx</span>
                    </div>
                    <Spectrum counts={counts} />
                    <p className="type-caption font-mono tabular-nums text-slate-500">
                      <span className="text-accent">{counts.deviation}▮</span> {counts.unknown}— {counts.candidate}+ {counts.conformant}•
                    </p>
                    {worst.length ? <p className="truncate type-caption text-slate-400">{worst.map((c) => c.subject).join(" · ")}</p> : null}
                    {r.weaklyGoverned.length ? <p className="type-caption text-slate-600">{r.weaklyGoverned.length} weakly governed</p> : null}
                    <span className={`inline-block type-caption ${stage === "current" ? "text-slate-600" : "text-accent"}`}>{STAGE_ACTION[stage]} →</span>
                  </button>
                );
              })
            ) : (
              <p className="px-1 type-caption text-slate-600">none</p>
            )}
          </section>
        ))}
      </div>

      {repoRow ? (
        <div className="grid gap-5 lg:grid-cols-[1fr_24rem]">
          <section className="space-y-3" aria-label={`${repoRow.fullName} sheet`}>
            <div className={`${TILE_LEDGER} sm:grid-cols-3`}>
              <div className="bg-ink px-5 py-3.5"><Stat label="Contexts" value={repoRow.contexts} sub={`${repoRow.weaklyGoverned.length} weakly governed`} /></div>
              <div className="bg-ink px-5 py-3.5"><Stat label="Pairs judged" value={repoRow.judged} sub={`of ${repoRow.pairs}`} /></div>
              <div className="bg-ink px-5 py-3.5"><Stat label="Deviations" value={repoRow.deviations} sub={repoRow.sweptAt ? "as of the last sweep" : "never swept"} /></div>
            </div>
            {repoRow.hasMap ? (
              <div className={`${TILE_LEDGER}`}>
                {tree.map((g) => (
                  <div key={g.category.id} className="bg-ink px-4 py-2.5">
                    <p className="type-label tracking-[0.16em] text-slate-400">{g.category.title}</p>
                    <ul className="mt-1.5 flex flex-wrap gap-1.5">
                      {flattenTree([g]).map((s) => {
                        const cell = cells.get(s.slug, repoRow.repositoryId);
                        if (!cell) return null;
                        return (
                          <li key={s.slug} className="flex items-center gap-1 rounded-md border border-divider pr-1.5">
                            <CellButton cell={cell} repo={repoRow.fullName} size="sm" picked={sel.picked.includes(s.slug)} onPick={() => api.toggleCell(repoRow.repositoryId, s.slug)} />
                            <button type="button" className="focus-ring type-caption text-slate-300 hover:text-white" onClick={() => api.focusSubject(s.slug)}>
                              {s.slug}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-xl border border-divider px-4 py-3 type-body-sm text-slate-400">
                {repoRow.fullName} is not on the map yet, so nothing about its standing can be known. The next act is{" "}
                <span className="text-slate-200">{STAGE_ACTION[repoRow.stage]}</span> — the brief on the right hands it to an agent.
              </p>
            )}
            <StateLegend compact />
            <button type="button" className={chipButtonClass("idle", "py-0.5 type-caption")} onClick={() => api.focusRepo(null)}>
              close sheet
            </button>
          </section>
          <KnowledgeComposer view={view} api={api} className="lg:sticky lg:top-3 self-start" />
        </div>
      ) : (
        <KnowledgeComposer view={view} api={api} />
      )}

      <KnowledgeSubjectDetail
        view={view}
        subject={subjectRow}
        registryUrl={view.registry?.url ?? null}
        pickedRepo={sel.repo}
        picked={sel.picked}
        onClose={() => api.focusSubject(null)}
        onPick={api.toggleCell}
      />
    </div>
  );
}
