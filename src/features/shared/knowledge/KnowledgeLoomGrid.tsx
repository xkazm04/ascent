"use client";

// The loom itself: warp = every subject of the bundle in the taxonomy's order, grouped under its
// category and subcategory; weft = every mapped repo, worst first. Each crossing is one cell with one
// of eleven states. Chrome (headers, group rows) renders from the taxonomy unconditionally; only the
// cells are data — the `table` golden path's chrome/body split.

import type { KnowledgeDomain, KnowledgeRepo } from "@/lib/org/knowledge-shape";
import { CellButton, StageChip } from "./KnowledgeShared";
import { type CellIndex, type TreeGroup, countStates } from "./knowledgeModel";
import type { KnowledgeSelectionApi } from "./useKnowledgeSelection";

export function KnowledgeLoomGrid({
  domain,
  tree,
  cols,
  cells,
  api,
  collapsed,
  onToggle,
}: {
  domain: KnowledgeDomain;
  tree: TreeGroup[];
  cols: KnowledgeRepo[];
  cells: CellIndex;
  api: KnowledgeSelectionApi;
  collapsed: ReadonlySet<string>;
  onToggle: (categoryId: string) => void;
}) {
  const { sel } = api;
  const rowCells = (slug: string) => cols.map((r) => cells.get(slug, r.repositoryId)).filter((c): c is NonNullable<typeof c> => !!c);
  const span = cols.length + 1;

  return (
    <div className="overflow-x-auto rounded-2xl border border-divider bg-ink">
      <table className="w-full border-collapse" style={{ minWidth: `${260 + cols.length * 44}px` }}>
        <caption className="sr-only">Every subject of {domain.title} against every mapped repository</caption>
        <thead className="sticky top-0 z-10 bg-ink">
          <tr>
            <th scope="col" className="px-3 py-2 text-left type-label tracking-[0.16em] text-slate-500">
              knowledge/{domain.name}/
            </th>
            {cols.map((r) => (
              <th key={r.repositoryId} scope="col" className="px-1 pb-2 pt-3 align-bottom" title={`${r.fullName} · ${r.contexts} contexts · ${r.deviations} deviations${r.weaklyGoverned.length ? ` · weakly governed: ${r.weaklyGoverned.join(", ")}` : ""}`}>
                <button type="button" className={`focus-ring flex flex-col items-center gap-1 ${sel.repo === r.repositoryId ? "text-accent" : "text-slate-400"}`} onClick={() => api.focusRepo(sel.repo === r.repositoryId ? null : r.repositoryId)} aria-pressed={sel.repo === r.repositoryId}>
                  <span className="type-micro font-mono [writing-mode:vertical-rl] rotate-180">{r.fullName.split("/").pop()}</span>
                  <StageChip stage={r.stage} className="scale-90" />
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cols.length === 0 ? (
            <tr>
              <td className="px-3 py-6 type-body-sm text-slate-500">
                No repository has a registry map yet, so the loom has no weft. Hand the unmapped repos their next act below — the first map turns this into a matrix.
              </td>
            </tr>
          ) : null}
          {tree.map((g) => {
            const open = !collapsed.has(g.category.id);
            const gcounts = countStates([...g.subjects, ...g.subcategories.flatMap((sc) => sc.subjects)].flatMap((s) => rowCells(s.slug)));
            return [
              <tr key={`c-${g.category.id}`} className="border-t border-divider bg-surface/40">
                <th scope="rowgroup" colSpan={span} className="px-3 py-1.5 text-left">
                  <button type="button" className="focus-ring flex w-full items-baseline gap-3" onClick={() => onToggle(g.category.id)} aria-expanded={open}>
                    <span className="type-label tracking-[0.16em] text-slate-200">
                      {open ? "▾" : "▸"} {g.category.title}
                    </span>
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
                        <th scope="rowgroup" colSpan={span} className="px-3 pb-0.5 pt-2 text-left type-micro uppercase tracking-[0.16em] text-slate-600">
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
  );
}
