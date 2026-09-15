"use client";

// The Security tab's risk register — the D9 check battery as a MATRIX, with the auditable per-repo
// ledger underneath it.
//
// What changed, and why it is not cosmetic. The battery used to live inside a table column as ten
// grade-coloured chips per row, and a control that produced no grade wore the same pill in slate.
// Quiet, in a row of green, reads as fine — so "this check never ran" and "this check passed" were
// one glance apart on the surface where that confusion is most expensive. The matrix above the table
// paints those cells with the shared hatch instead, and `rendersValue()` will not let a hatched cell
// print a numeral. The table keeps everything a matrix cannot be (§7 of docs/ORG-UX-REDESIGN.md):
// sortable, linkable, row-level evidence — the D9 drill-in, the gate verdict, advisory counts, the
// report link. Both are driven by the SAME `visible` slice, so sorting the table re-orders the matrix.
//
// The D9 number is computed, not judged — see src/lib/security/checks.ts.

import { useMemo, useState } from "react";
import Link from "next/link";
import { OrgTable } from "@/components/org/shared/ui";
import { StateSwatch, stateTitle } from "@/components/org/viz";
import { heatCell } from "@/lib/ui";
import { RepoDimensionModal, type HeatTarget } from "@/components/org/shared/RepoDimensionModal";
import type { SecurityRegisterRow } from "@/lib/org/security";
import {
  DEFAULT_DIR,
  sortRows,
  VISIBLE_DEFAULT,
  type RegisterAdvisories,
  type SortKey,
} from "@/features/standing/security/securityRegisterShared";
import { SecurityCheckMatrix } from "./SecurityCheckMatrix";
import { CoverageCell, Th, type ThSort } from "./SecurityRiskRegisterParts";

export type { RegisterAdvisories };

export function SecurityRiskRegister({
  org,
  rows,
  advisories,
  advisoriesDemo = false,
}: {
  org: string;
  rows: SecurityRegisterRow[];
  /** null = supply-chain scanning off (advisories column hidden); [] = on but nothing found yet. */
  advisories: RegisterAdvisories[] | null;
  /** security-posture-audit-log #3: true when `advisories` is deterministic MOCK data
   *  (SUPPLY_CHAIN_PROVIDER=mock). The column is labeled "demo data" and the GitHub deep-links are
   *  suppressed — the fabricated counts otherwise rendered identically to real fleet fact, and the
   *  links landed on a Dependabot page showing something entirely different. */
  advisoriesDemo?: boolean;
}) {
  const [target, setTarget] = useState<HeatTarget | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("risk");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const advByRepo = useMemo(() => (advisories ? new Map(advisories.map((a) => [a.fullName, a])) : null), [advisories]);
  const sorted = useMemo(() => sortRows(rows, sortKey, dir, advByRepo), [rows, sortKey, dir, advByRepo]);
  const visible = showAll ? sorted : sorted.slice(0, VISIBLE_DEFAULT);

  function toggle(k: SortKey) {
    if (sortKey === k) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setDir(DEFAULT_DIR[k]);
    }
  }

  const sort: ThSort = { key: sortKey, dir, onSort: toggle };

  return (
    <>
      {/* First sight is the grid, not the header row of a table (§2.2). */}
      <SecurityCheckMatrix rows={visible} className="mt-3" />
      <OrgTable
        className="mt-5"
        caption="Security D9 register: one row per scanned repo — score, security-gate verdict, failing and unjudged control counts, and current advisory exposure"
        minWidth={advByRepo ? 860 : 760}
        head={
          <tr>
            <Th k="name" label="Repo" sort={sort} />
            <Th k="score" label="D9" align="center" title="Security (D9) score: deterministic. Click for the full per-check evidence" sort={sort} />
            <Th k="risk" label="Gate" title="Security gate verdict. 'Gate' sorts riskiest first" sort={sort} />
            <Th k="gaps" label="Gaps" title="Controls scoring below 4/10, and — separately — controls that produced no grade at all. Sorts by failing-control count." sort={sort} />
            {advByRepo && (
              <Th
                k="adv"
                label="Advisories"
                align="right"
                sort={sort}
                badge={
                  advisoriesDemo ? (
                    <span
                      className="ml-1.5 rounded border border-amber-500/40 bg-amber-500/10 px-1 py-0.5 type-caption normal-case tracking-normal text-amber-300"
                      title="SUPPLY_CHAIN_PROVIDER=mock: these counts are deterministic demo data, not this fleet's real advisories"
                    >
                      demo data
                    </span>
                  ) : undefined
                }
              />
            )}
            <th className="w-10 px-2 py-2" aria-label="Open report" />
          </tr>
        }
      >
        {visible.map((r) => {
          const cell = heatCell(r.score, 0.25 + (r.score / 100) * 0.75);
          const adv = advByRepo?.get(r.fullName);
          return (
            <tr key={r.fullName}>
              <td className="px-3 py-2">
                <span className="type-mono-sm text-slate-300" title={r.fullName}>{r.name}</span>
              </td>
              <td className="px-3 py-1.5 text-center">
                {r.measured ? (
                  <button
                    type="button"
                    onClick={() => setTarget({ fullName: r.fullName, name: r.name, dimId: "D9" })}
                    className="focus-ring mx-auto flex h-7 w-10 items-center justify-center rounded type-mono-sm transition hover:ring-2 hover:ring-accent/60"
                    style={{ backgroundColor: cell.fill, color: cell.text }}
                    title={`${r.name} · Security (D9): ${r.score}, click for per-check evidence and next steps`}
                    aria-label={`${r.name} security score ${r.score}, open detail`}
                  >
                    {r.score}
                  </button>
                ) : (
                  // The scan carried no D9 row. `score` is the fail-closed substitute the builder
                  // supplies for banding — printing it here would publish a 0 nobody measured.
                  <span className="mx-auto flex h-7 w-10 items-center justify-center" title={stateTitle("missing", `${r.name} · Security (D9)`)}>
                    <StateSwatch state="missing" size={14} />
                  </span>
                )}
              </td>
              <td className="px-3 py-2">
                {r.gateReason ? (
                  <span className="type-mono-sm text-red-300">✗ {r.gateReason}</span>
                ) : (
                  <span className="type-mono-sm text-emerald-300/80">✓ pass</span>
                )}
              </td>
              <td className="px-3 py-2">
                <CoverageCell row={r} />
              </td>
              {advByRepo && (
                <td className="px-3 py-2 text-right">
                  {adv && adv.total > 0 ? (
                    advisoriesDemo ? (
                      // Demo counts don't exist on GitHub — a deep-link would land on a Dependabot page
                      // showing something entirely different and erode trust in the real numbers too.
                      <span className="type-mono-sm text-slate-400" title="Demo data, no matching advisories exist on GitHub">
                        {adv.critical > 0 && <span className="text-red-300">{adv.critical}C </span>}
                        {adv.high > 0 && <span className="text-orange-300">{adv.high}H </span>}
                        {adv.total}
                      </span>
                    ) : (
                      <a href={`https://github.com/${r.fullName}/security/dependabot`} target="_blank" rel="noreferrer" className="focus-ring type-mono-sm text-slate-300 hover:text-white" title={`${adv.total} open Dependabot advisories, open on GitHub`}>
                        {adv.critical > 0 && <span className="text-red-300">{adv.critical}C </span>}
                        {adv.high > 0 && <span className="text-orange-300">{adv.high}H </span>}
                        {adv.total} ↗
                      </a>
                    )
                  ) : adv ? (
                    <span className="type-mono-sm text-slate-600" title={`${r.name}: advisories were fetched and none are open`}>0</span>
                  ) : (
                    // No advisory row for this repo — the fetch never covered it. Not a clean bill.
                    <span className="inline-flex justify-end" title={stateTitle("missing", `${r.name} · advisories`)}>
                      <StateSwatch state="missing" size={12} />
                    </span>
                  )}
                </td>
              )}
              <td className="px-2 py-2 text-right">
                <Link href={`/report/${r.fullName}`} className="focus-ring type-mono-sm text-slate-500 transition hover:text-accent" title={`Open the full report for ${r.fullName}`} aria-label={`Open the full report for ${r.name}`}>
                  →
                </Link>
              </td>
            </tr>
          );
        })}
      </OrgTable>
      {rows.length > VISIBLE_DEFAULT && (
        <button
          type="button"
          onClick={() => setShowAll((s) => !s)}
          className="focus-ring mt-3 rounded-md border border-slate-700 px-3 py-1.5 type-mono-sm text-slate-300 transition hover:border-accent hover:text-white"
        >
          {showAll ? "Show fewer" : `Show all ${rows.length} repos`}
        </button>
      )}
      <RepoDimensionModal org={org} target={target} onClose={() => setTarget(null)} />
    </>
  );
}
