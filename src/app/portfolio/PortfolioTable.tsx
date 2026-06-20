// The portfolio comparison table — N companies on one comparable yardstick (THEO). Server-safe (no
// hooks); reuses the org-dashboard primitives so it inherits the editorial identity. Each row links to
// that company's full dashboard. The trajectory cell carries the SAME honesty the single-org card does:
// a low-confidence (few-points) trend is flagged "noisy" so a quarterly-cadence book isn't over-read.

import Link from "next/link";
import { Tile, OrgTable, TILE_GRID, postureLabel } from "@/components/org/ui";
import { scoreHex } from "@/lib/ui";
import type { Portfolio, PortfolioCompany } from "@/lib/org/portfolio";

const TRAJ = {
  rising: { arrow: "▲", color: "#84cc16" },
  falling: { arrow: "▼", color: "#f97316" },
  flat: { arrow: "→", color: "#94a3b8" },
} as const;

function Trajectory({ c }: { c: PortfolioCompany }) {
  if (!c.trajectory || c.perWeek == null) return <span className="text-slate-600">—</span>;
  const t = TRAJ[c.trajectory];
  const noisy = c.confidence != null && c.confidence < 50;
  return (
    <span className="inline-flex flex-col">
      <span className="font-mono" style={{ color: t.color }}>
        {t.arrow} {c.perWeek > 0 ? "+" : ""}
        {c.perWeek}/wk
        {c.etaLabel ? <span className="text-slate-400"> · {c.etaLabel}</span> : null}
      </span>
      {c.confidence != null && (
        <span className="font-mono text-xs text-slate-500">
          conf {c.confidence}%{noisy ? " · noisy" : ""}
        </span>
      )}
    </span>
  );
}

export function PortfolioTable({ portfolio }: { portfolio: Portfolio }) {
  const { companies } = portfolio;
  return (
    <>
      <div className={TILE_GRID}>
        <Tile label="Companies" value={companies.length} sub="in this book" />
        <Tile label="Avg maturity" value={portfolio.avgOverall} color={scoreHex(portfolio.avgOverall)} sub="one vote each" />
        <Tile label="Rising / Falling" value={`${portfolio.rising} / ${portfolio.falling}`} sub={`${portfolio.flat} holding`} />
        <Tile label="Repos in scope" value={portfolio.totalRepos} sub="scanned across the book" />
      </div>

      <div className="mt-6">
        <OrgTable
          caption="Portfolio companies by engineering maturity"
          head={
            <tr className="text-left">
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Maturity</th>
              <th className="px-4 py-3">Adopt / Rigor</th>
              <th className="px-4 py-3">Posture</th>
              <th className="px-4 py-3">Trajectory</th>
              <th className="px-4 py-3">Pctile</th>
              <th className="px-4 py-3">Repos</th>
            </tr>
          }
        >
          {companies.map((c) => (
            <tr key={c.org}>
              <td className="px-4 py-3">
                <Link href={`/org/${encodeURIComponent(c.org)}`} className="font-mono text-accent hover:underline">
                  {c.org}
                </Link>
              </td>
              <td className="px-4 py-3">
                <span className="font-mono font-bold tabular-nums" style={{ color: scoreHex(c.avgOverall) }}>
                  {c.avgOverall}
                </span>{" "}
                <span className="font-mono text-sm text-slate-400">
                  {c.levelId} · {c.levelName}
                </span>
              </td>
              <td className="px-4 py-3 font-mono tabular-nums text-slate-300">
                {c.adoption} / {c.rigor}
              </td>
              <td className="px-4 py-3 text-slate-300">{postureLabel(c.posture)}</td>
              <td className="px-4 py-3">
                <Trajectory c={c} />
              </td>
              <td className="px-4 py-3 font-mono tabular-nums text-slate-300">
                {c.percentile != null ? `${c.percentile}th` : "—"}
              </td>
              <td className="px-4 py-3 font-mono tabular-nums text-slate-400">{c.scannedCount}</td>
            </tr>
          ))}
        </OrgTable>
      </div>
    </>
  );
}
