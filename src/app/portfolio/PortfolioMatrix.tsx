// The company x dimension matrix: nine cells per company over the rollup's dimAverages (no new query).
// Server-safe, no hooks. An unmeasured dimension renders as a void mark, never as a 0; each company's
// weakest present dimension is outlined, and one line names the book-wide gap with its denominator.

import { OrgTable } from "@/components/shared/dashboard/ui";
import { DIMENSION_SHORT, scoreHex } from "@/lib/ui";
import { dimName, portfolioMatrix } from "@/lib/org/portfolioBookModel";
import type { PortfolioCompany } from "@/lib/org/portfolio";

function short(id: string): string {
  return (DIMENSION_SHORT as Record<string, string>)[id] ?? id;
}

export function PortfolioMatrix({ companies }: { companies: PortfolioCompany[] }) {
  const m = portfolioMatrix(companies);
  if (!m.bookGap) return null;
  const gap = m.bookGap;
  const total = companies.length;
  return (
    <section className="mt-8" aria-labelledby="portfolio-matrix-heading">
      <h2 id="portfolio-matrix-heading" className="type-subheading font-semibold text-white" data-portfolio-copy>
        Where the book is weakest
      </h2>
      <p className="mt-1 max-w-3xl type-body-sm text-slate-400" data-portfolio-copy>
        <span className="font-mono text-white">{gap.dimId}</span> {dimName(gap.dimId)} averages{" "}
        <span className="font-mono tabular-nums" style={{ color: scoreHex(gap.mean) }}>
          {gap.mean}
        </span>{" "}
        across the {gap.n} of {total} {total === 1 ? "company" : "companies"} that measure it, and is the weakest
        dimension in {gap.weakestIn} of {total}.
      </p>
      <div className="mt-4">
        <OrgTable
          caption="Company by dimension maturity matrix"
          minWidth={820}
          head={
            <tr className="text-left">
              <th className="px-3 py-3">Company</th>
              {m.dimIds.map((id) => (
                <th key={id} className="px-2 py-3 text-center" title={dimName(id)}>
                  <span className="font-mono">{id}</span>
                  <span className="block type-caption font-normal text-slate-500">{short(id)}</span>
                </th>
              ))}
            </tr>
          }
        >
          {m.rows.map((r) => (
            <tr key={r.org}>
              <td className="px-3 py-2 font-mono text-slate-200">{r.org}</td>
              {m.dimIds.map((id) => {
                const v = r.dims[id];
                const weakest = r.weakest === id;
                return (
                  <td
                    key={id}
                    data-dim={id}
                    data-measured={v != null ? "true" : "false"}
                    data-weakest={weakest ? "true" : undefined}
                    className="px-2 py-2 text-center"
                  >
                    {v != null ? (
                      <span
                        className={`inline-block min-w-[2.25rem] rounded px-1 font-mono tabular-nums ${weakest ? "ring-1 ring-warn" : ""}`}
                        style={{ color: scoreHex(v) }}
                        title={weakest ? `${r.org}: weakest dimension` : undefined}
                      >
                        {v}
                        {weakest && <span className="sr-only"> (weakest)</span>}
                      </span>
                    ) : (
                      <span className="text-slate-600" title="not measured">
                        <span aria-hidden="true">·</span>
                        <span className="sr-only">not measured</span>
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </OrgTable>
      </div>
      <p className="mt-2 type-caption text-slate-500" data-portfolio-copy>
        Each cell is that company&apos;s fleet average over its live-scored repos. A dot is a dimension with no
        measurement, not a 0. Outlined: the company&apos;s weakest dimension.
      </p>
    </section>
  );
}
