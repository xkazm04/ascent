"use client";

// Direction A — **Atlas**. The registry's own folder tree, annotated with the fleet.
//
// Metaphor: an atlas. The left rail IS `knowledge/<domain>/` — category → subcategory → subject,
// in the taxonomy's declared order — and every leaf carries a thin spectrum of how the fleet stands
// on it. The right page is the category ledger: one row per category with its fleet standing, so
// "where is the corpus, and where are we thin" reads top-down before any cell is opened. A subject
// click opens the reader (use_when, laws, golden path, per-repo standing) where cells become picks.
//
// Why this direction: use case 1 first. An operator who has just mapped a registry wants to SEE it
// as the registry lays itself out; the matrix and the dispatch are one click deeper, not the hero.

import { Stat } from "@/components/ui";
import { TILE_LEDGER } from "@/components/org/shared/ui";
import type { KnowledgeView } from "@/lib/org/knowledge-shape";
import { KnowledgeComposer } from "./KnowledgeComposer";
import { DomainPicker, Spectrum, StageChip, StateLegend, SweepStrip } from "./KnowledgeShared";
import { KnowledgeSubjectDetail } from "./KnowledgeSubjectDetail";
import { STAGE_ACTION, buildTree, columnRepos, countStates, flattenTree, indexCells, subjectsOf, unmappedRepos } from "./knowledgeModel";
import { useKnowledgeSelection } from "./useKnowledgeSelection";

export function KnowledgeAtlas({ view }: { view: KnowledgeView }) {
  const api = useKnowledgeSelection(view);
  const { sel, domain, subjectRow } = api;
  if (!domain) return null;
  const subjects = subjectsOf(view, domain.name);
  const tree = buildTree(domain.taxonomy, subjects);
  const cells = indexCells(view.cells);
  const cols = columnRepos(view.repos);
  const cellsOf = (slugs: string[]) => slugs.flatMap((s) => cols.map((r) => cells.get(s, r.repositoryId))).filter((c): c is NonNullable<typeof c> => !!c);
  const fleet = countStates(cellsOf(flattenTree(tree).map((s) => s.slug)));
  const owed = fleet.unknown + fleet.candidate;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DomainPicker domains={view.domains} active={domain.name} onPick={api.setDomain} />
        <span className="type-caption text-slate-500">
          {domain.subjects} golden paths · {domain.techniques} techniques · {subjects.length} mirrored
        </span>
      </div>
      <SweepStrip view={view} />

      <div className="grid gap-5 lg:grid-cols-[19rem_1fr]">
        <nav className="space-y-4 rounded-2xl border border-divider bg-surface/40 p-3" aria-label="Registry tree">
          <p className="px-1 type-caption text-slate-600">knowledge/{domain.name}/</p>
          {tree.map((g) => (
            <div key={g.category.id} className="space-y-1">
              <div className="flex items-baseline justify-between px-1">
                <span className="type-label tracking-[0.16em] text-slate-300">{g.category.title}</span>
                <span className="type-micro font-mono text-slate-600">{g.total}</span>
              </div>
              {[{ id: "", title: "", subjects: g.subjects }, ...g.subcategories].map((sc) =>
                sc.subjects.length ? (
                  <div key={sc.id || "_"} className="space-y-0.5">
                    {sc.title ? <p className="px-1 pt-1 type-micro uppercase tracking-[0.16em] text-slate-600">{sc.title}</p> : null}
                    {sc.subjects.map((s) => {
                      const mine = cellsOf([s.slug]);
                      const counts = countStates(mine);
                      const active = sel.subject === s.slug;
                      return (
                        <button
                          key={s.slug}
                          type="button"
                          className={`focus-ring flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-surface/60 ${active ? "bg-surface/80" : ""}`}
                          onClick={() => api.focusSubject(s.slug)}
                        >
                          <span className="min-w-0 flex-1 truncate type-mono-sm text-slate-200">{s.slug}</span>
                          {counts.deviation ? <span className="type-micro font-mono text-accent">{counts.deviation}▮</span> : null}
                          <Spectrum counts={counts} className="w-14" />
                        </button>
                      );
                    })}
                  </div>
                ) : null,
              )}
            </div>
          ))}
        </nav>

        <div className="space-y-5">
          <div className={`${TILE_LEDGER} sm:grid-cols-2 lg:grid-cols-4`}>
            <div className="bg-ink px-5 py-3.5"><Stat label="Repos mapped" value={cols.length} sub={`${unmappedRepos(view.repos).length} not yet`} /></div>
            <div className="bg-ink px-5 py-3.5"><Stat label="Deviations" value={fleet.deviation} sub="recorded by the repos" /></div>
            <div className="bg-ink px-5 py-3.5"><Stat label="Verdicts owed" value={owed} sub={`${fleet.unknown} unjudged · ${fleet.candidate} candidates`} /></div>
            <div className="bg-ink px-5 py-3.5"><Stat label="Conformant" value={fleet.conformant} sub={`of ${fleet.conformant + fleet.deviation + fleet["not-applicable"]} judged`} /></div>
          </div>

          <div className="space-y-2">
            <div className={`${TILE_LEDGER}`}>
              {tree.map((g) => {
                const counts = countStates(cellsOf(flattenTree([g]).map((s) => s.slug)));
                return (
                  <div key={g.category.id} className="grid items-center gap-3 bg-ink px-4 py-2.5 sm:grid-cols-[14rem_1fr_auto]">
                    <span className="type-body-sm text-slate-200">{g.category.title}</span>
                    <Spectrum counts={counts} />
                    <span className="type-caption font-mono tabular-nums text-slate-500">
                      <span className="text-accent">{counts.deviation}▮</span> {counts.unknown}— {counts.candidate}+ · {g.total} subjects
                    </span>
                  </div>
                );
              })}
            </div>
            <StateLegend />
          </div>

          {unmappedRepos(view.repos).length ? (
            <div className="space-y-1.5 rounded-2xl border border-divider bg-surface/40 p-4">
              <p className="type-caption text-slate-500">Not on the map yet — nothing about these repos can be known until they are.</p>
              <ul className="flex flex-wrap gap-2">
                {unmappedRepos(view.repos).map((r) => (
                  <li key={r.repositoryId}>
                    <button type="button" className="focus-ring flex items-center gap-2 rounded-md border border-divider px-2.5 py-1.5 hover:border-accent" onClick={() => api.focusRepo(r.repositoryId)}>
                      <span className="type-mono-sm text-slate-200">{r.fullName.split("/").pop()}</span>
                      <StageChip stage={r.stage} />
                      <span className="type-caption text-accent">{STAGE_ACTION[r.stage]} →</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <KnowledgeComposer view={view} api={api} />
        </div>
      </div>

      {/* The reader: a subject in depth, where each repo's cell can be picked into the composer. */}
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
