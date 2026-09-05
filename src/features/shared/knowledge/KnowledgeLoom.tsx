"use client";

// Direction B — **Loom**. The domain matrix as the hero.
//
// Metaphor: a loom. Warp = every subject of the bundle, in the taxonomy's order, grouped under its
// category and subcategory; weft = every mapped repo, worst first. Each crossing is one cell with
// one of eleven states, and picking cells threads them straight into the dispatch composer docked
// beneath. Use case 3 is the surface; use cases 1 and 2 are its two margins — the row labels ARE the
// registry tree, the composer IS the hand-off.
//
// Why this direction: the operator's question is "which projects consume which topics of this
// domain", and that is a comparison across uniform attributes — a table's job, per the registry's
// own `table` golden path: chrome (headers, legend, sweep age) renders unconditionally; only the
// body is data.

import { useState } from "react";
import type { KnowledgeView } from "@/lib/org/knowledge-shape";
import { KnowledgeComposer } from "./KnowledgeComposer";
import { CellButton, DomainPicker, StageChip, StateLegend, SweepStrip } from "./KnowledgeShared";
import { KnowledgeSubjectDetail } from "./KnowledgeSubjectDetail";
import { STAGE_ACTION, buildTree, columnRepos, countStates, indexCells, subjectsOf, unmappedRepos } from "./knowledgeModel";
import { useKnowledgeSelection } from "./useKnowledgeSelection";

export function KnowledgeLoom({ view }: { view: KnowledgeView }) {
  const api = useKnowledgeSelection(view);
  const { sel, domain, subjectRow } = api;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  if (!domain) return null;
  const subjects = subjectsOf(view, domain.name);
  const tree = buildTree(domain.taxonomy, subjects);
  const cells = indexCells(view.cells);
  const cols = columnRepos(view.repos);
  const toggle = (id: string) =>
    setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const rowCells = (slug: string) => cols.map((r) => cells.get(slug, r.repositoryId)).filter((c): c is NonNullable<typeof c> => !!c);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DomainPicker domains={view.domains} active={domain.name} onPick={api.setDomain} />
        <span className="type-caption text-slate-500">
          {subjects.length} of {domain.subjects} golden paths mirrored · {cols.length} repos on the map
        </span>
      </div>
      <SweepStrip view={view} />

      {unmappedRepos(view.repos).length ? (
        <div className="flex flex-wrap items-center gap-2 type-caption text-slate-500">
          <span>Off the loom:</span>
          {unmappedRepos(view.repos).map((r) => (
            <button key={r.repositoryId} type="button" className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-divider px-2 py-1 hover:border-accent" onClick={() => api.focusRepo(r.repositoryId)}>
              <span className="type-mono-sm text-slate-300">{r.fullName.split("/").pop()}</span>
              <span className="text-accent">{STAGE_ACTION[r.stage]} →</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-divider bg-ink">
        <table className="w-full border-collapse" style={{ minWidth: `${260 + cols.length * 44}px` }}>
          <caption className="sr-only">Every subject of {domain.title} against every mapped repository</caption>
          <thead className="sticky top-0 z-10 bg-ink">
            <tr>
              <th scope="col" className="px-3 py-2 text-left type-label tracking-[0.16em] text-slate-500">
                knowledge/{domain.name}/
              </th>
              {cols.map((r) => (
                <th key={r.repositoryId} scope="col" className="px-1 pb-2 pt-3 align-bottom" title={`${r.fullName} · ${r.contexts} contexts · ${r.deviations} deviations`}>
                  <button type="button" className={`focus-ring flex flex-col items-center gap-1 ${sel.repo === r.repositoryId ? "text-accent" : "text-slate-400"}`} onClick={() => api.focusRepo(r.repositoryId)}>
                    <span className="type-micro font-mono [writing-mode:vertical-rl] rotate-180">{r.fullName.split("/").pop()}</span>
                    <StageChip stage={r.stage} className="scale-90" />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tree.map((g) => {
              const open = !collapsed.has(g.category.id);
              const gcounts = countStates([...g.subjects, ...g.subcategories.flatMap((sc) => sc.subjects)].flatMap((s) => rowCells(s.slug)));
              return [
                <tr key={`c-${g.category.id}`} className="border-t border-divider bg-surface/40">
                  <th scope="rowgroup" colSpan={cols.length + 1} className="px-3 py-1.5 text-left">
                    <button type="button" className="focus-ring flex w-full items-baseline gap-3" onClick={() => toggle(g.category.id)} aria-expanded={open}>
                      <span className="type-label tracking-[0.16em] text-slate-200">{open ? "▾" : "▸"} {g.category.title}</span>
                      <span className="type-caption font-mono tabular-nums text-slate-500">
                        {g.total} subjects · <span className="text-accent">{gcounts.deviation}▮</span> {gcounts.unknown}— {gcounts.candidate}+
                      </span>
                    </button>
                  </th>
                </tr>,
                ...(open
                  ? [{ id: "", title: "", subjects: g.subjects }, ...g.subcategories].flatMap((sc) => [
                      sc.title ? (
                        <tr key={`s-${g.category.id}-${sc.id}`}>
                          <th scope="rowgroup" colSpan={cols.length + 1} className="px-3 pb-0.5 pt-2 text-left type-micro uppercase tracking-[0.16em] text-slate-600">
                            {sc.title}
                          </th>
                        </tr>
                      ) : null,
                      ...sc.subjects.map((s) => (
                        <tr key={s.slug} className="hover:bg-surface/30">
                          <th scope="row" className="px-3 py-0.5 text-left font-normal">
                            <button type="button" className={`focus-ring type-mono-sm hover:text-white ${sel.subject === s.slug ? "text-accent" : "text-slate-300"}`} onClick={() => api.focusSubject(s.slug)}>
                              {s.slug}
                            </button>
                          </th>
                          {cols.map((r) => {
                            const cell = cells.get(s.slug, r.repositoryId);
                            return (
                              <td key={r.repositoryId} className="p-0.5">
                                {cell ? (
                                  <CellButton cell={cell} repo={r.fullName} picked={sel.repo === r.repositoryId && sel.picked.includes(s.slug)} onPick={() => api.toggleCell(r.repositoryId, s.slug)} />
                                ) : null}
                              </td>
                            );
                          })}
                        </tr>
                      )),
                    ])
                  : []),
              ];
            })}
          </tbody>
        </table>
      </div>
      <StateLegend />

      <KnowledgeComposer view={view} api={api} className="lg:sticky lg:bottom-3" />

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
