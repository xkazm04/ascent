"use client";

// ranking-and-excerpts: the argument. A page of results in a total order (score, then recency, then
// id), each with a band instead of a number and an excerpt windowed on the densest match with marks
// from the engine's own matched tokens — including the prefix-expanded form a naive re-find of the raw
// input would miss. The signals table is the combination rule, written down.

import { daysAgo } from "./fixtures";
import { band, excerpt, naiveMarks, SIGNALS } from "./rank";
import type { FleetSearch } from "./useFleetSearch";
import { BTN, Readout, Region, toggleClass } from "./sceneParts";

export function ResultsPanel({ s }: { s: FleetSearch }) {
  const top = s.ranked[0]?.score ?? 0;
  const rawWords = s.text.replace(/"/g, " ").split(/\s+/).filter((w) => w.length >= 2 && !w.includes(":") && !w.startsWith("-"));
  const engineMarks = s.pageRows.reduce((n, r) => n + excerpt(r.repo.description, s.engine.docs.get(r.repo.id)!.folded.description, r.hit.matched, 10_000).segments.filter((x) => x.mark).length, 0);
  const naive = s.pageRows.reduce((n, r) => n + naiveMarks(r.repo.description, rawWords), 0);
  const ties = s.ranked.filter((r) => r.score === top && top > 0).length;

  return (
    <Region technique="ranking-and-excerpts" title="These, in this order, for these reasons" note="Scores stay internal; bands render. Marks come from what the engine matched, not a re-find of what you typed.">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button type="button" className={toggleClass(s.sort === "relevance")} onClick={() => s.setSort("relevance")} aria-pressed={s.sort === "relevance"}>
          relevance
        </button>
        <button type="button" className={toggleClass(s.sort === "recent")} onClick={() => s.setSort("recent")} aria-pressed={s.sort === "recent"}>
          recent
        </button>
        <span className="type-caption text-slate-500">
          {s.ranked.length.toLocaleString()} results under the full predicate · page {s.page} of {s.pages}
        </span>
      </div>
      <ol className="space-y-1" data-results>
        {s.pageRows.map((r, i) => {
          const doc = s.engine.docs.get(r.repo.id)!;
          const ex = excerpt(r.repo.description, doc.folded.description, r.hit.matched);
          const name = excerpt(r.repo.name, doc.folded.name, r.hit.matched, 10_000);
          const b = band((s.page - 1) * 8 + i, r.score, top);
          return (
            <li key={r.repo.id} className="rounded-md border border-divider px-2 py-1.5" data-result={r.repo.id} data-band={b}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="type-mono-sm text-white">
                  <span className="text-slate-500">{r.repo.owner}/</span>
                  {name.segments.map((seg, k) => (seg.mark ? <mark key={k} className="rounded-sm bg-accent/20 text-accent-soft">{seg.text}</mark> : <span key={k}>{seg.text}</span>))}
                </span>
                <span className={`type-caption ${b === "best match" ? "text-accent-soft" : "text-slate-500"}`}>
                  {b} · {daysAgo(r.repo.updatedAt)}d
                </span>
              </div>
              <p className="type-caption text-slate-400">
                {ex.leading ? "…" : ""}
                {ex.segments.map((seg, k) => (seg.mark ? <mark key={k} className="rounded-sm bg-accent/20 text-accent-soft">{seg.text}</mark> : <span key={k}>{seg.text}</span>))}
                {ex.trailing ? "…" : ""}
              </p>
            </li>
          );
        })}
        {s.pageRows.length === 0 ? <li className="type-caption text-slate-500">Nothing on this page.</li> : null}
      </ol>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" className={BTN} disabled={s.page <= 1} onClick={() => s.setPage(s.page - 1)}>
          ← prev
        </button>
        <button type="button" className={BTN} disabled={s.page >= s.pages} onClick={() => s.setPage(s.page + 1)}>
          next →
        </button>
      </div>
      <div className="mt-3 space-y-1">
        <Readout label="marks on this page · engine / whole-word re-find of the typed text" value={<span data-marks-engine={engineMarks} data-marks-naive={naive}>{`${engineMarks} / ${naive}`}</span>} tone={engineMarks !== naive ? "text-warn" : "text-slate-200"} />
        <Readout label="ties at the top score" value={<span data-ties={ties}>{ties > 1 ? `${ties} — broken by recency, then id` : ties === 1 ? "none" : "—"}</span>} />
      </div>
      <table className="mt-3 w-full type-caption">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="font-normal">signal</th>
            <th className="font-normal">weight</th>
            <th className="font-normal">why</th>
          </tr>
        </thead>
        <tbody>
          {SIGNALS.map((row) => (
            <tr key={row.signal} className="border-t border-divider align-top text-slate-300">
              <td className="py-1 pr-2">{row.signal}</td>
              <td className="py-1 pr-2 font-mono text-slate-400">{row.value}</td>
              <td className="py-1 text-slate-500">{row.why}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Region>
  );
}
