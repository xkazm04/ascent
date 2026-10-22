"use client";

// The Security risk register, Prism composition. Same props and the same useSecurityRegister as the
// Altimeter register: the D9 matrix first, then the auditable per-repo ledger as ruled rows (score as a
// figure you can open, gate verdict as a word and a glyph, gaps, advisories, the report link).
import Link from "next/link";
import { CELL, DataTable, Display, GhostAction, HEAD_CELL, VoidMark } from "@/components/kit";
import { RepoDimensionModal } from "@/components/org/shared/RepoDimensionModal";
import type { SecurityRegisterRow } from "@/lib/org/security";
import { VISIBLE_DEFAULT, type RegisterAdvisories } from "./securityRegisterShared";
import { SecurityCheckMatrix } from "./SecurityCheckMatrix";
import { AdvisoryCellV2, CoverageCellV2, DemoBadgeV2, GateCellV2, ThV2 } from "./SecurityRiskRegisterParts.v2";
import { useSecurityRegister } from "./useSecurityRegister";

export function SecurityRiskRegisterV2({
  org,
  rows,
  advisories,
  advisoriesDemo = false,
}: {
  org: string;
  rows: SecurityRegisterRow[];
  /** null = supply-chain scanning off (advisories column hidden); [] = on but nothing found yet. */
  advisories: RegisterAdvisories[] | null;
  /** True when `advisories` is deterministic MOCK data: the column is labeled and the deep links are suppressed. */
  advisoriesDemo?: boolean;
}) {
  const { target, setTarget, showAll, toggleShowAll, advByRepo, visible, sort } = useSecurityRegister(rows, advisories);
  return (
    <>
      <SecurityCheckMatrix rows={visible} className="mt-3" />
      <div className="mt-6">
        <DataTable
          variant="plain"
          size="sm"
          minWidth={advByRepo ? 860 : 760}
          caption="Security D9 register: one row per scanned repo — score, security-gate verdict, failing and unjudged control counts, and current advisory exposure"
          head={
            <tr>
              <ThV2 k="name" label="Repo" sort={sort} />
              <ThV2 k="score" label="D9" align="right" title="Security (D9) score: deterministic. Open it for the full per-check evidence" sort={sort} />
              <ThV2 k="risk" label="Gate" title="Security gate verdict. 'Gate' sorts riskiest first" sort={sort} />
              <ThV2 k="gaps" label="Gaps" title="Controls scoring below 4/10, and separately controls that produced no grade at all. Sorts by failing-control count." sort={sort} />
              {advByRepo && <ThV2 k="adv" label="Advisories" sort={sort} badge={advisoriesDemo ? DemoBadgeV2 : undefined} />}
              <th className={HEAD_CELL}>
                <span className="sr-only">Open report</span>
              </th>
            </tr>
          }
        >
          {visible.map((r) => (
            <tr key={r.fullName} className="border-b border-divider">
              <td className={CELL}>
                <span className="font-medium text-white" title={r.fullName}>
                  {r.name}
                </span>
              </td>
              <td className={`${CELL} text-right tabular-nums`}>
                {r.measured ? (
                  <button
                    type="button"
                    onClick={() => setTarget({ fullName: r.fullName, name: r.name, dimId: "D9" })}
                    className="focus-ring hover:text-accent"
                    title={`${r.name} · Security (D9): ${r.score}, open per-check evidence and next steps`}
                    aria-label={`${r.name} security score ${r.score}, open detail`}
                  >
                    <Display as="div" level="figure">{r.score}</Display>
                  </button>
                ) : (
                  // The scan carried no D9 row. `score` is the fail-closed substitute for banding: printing it would publish a 0 nobody measured.
                  <VoidMark subject={`${r.name} · Security (D9)`} />
                )}
              </td>
              <td className={CELL}>
                <GateCellV2 row={r} />
              </td>
              <td className={CELL}>
                <CoverageCellV2 row={r} />
              </td>
              {advByRepo && (
                <td className={CELL}>
                  <AdvisoryCellV2 row={r} adv={advByRepo.get(r.fullName)} demo={advisoriesDemo} />
                </td>
              )}
              <td className={`${CELL} text-right`}>
                <Link href={`/report/${r.fullName}`} className="focus-ring text-slate-400 transition hover:text-white" title={`Open the full report for ${r.fullName}`} aria-label={`Open the full report for ${r.name}`}>
                  →
                </Link>
              </td>
            </tr>
          ))}
        </DataTable>
      </div>
      {rows.length > VISIBLE_DEFAULT && (
        <div className="mt-4">
          <GhostAction onClick={toggleShowAll}>{showAll ? "Show fewer" : `Show all ${rows.length} repos`}</GhostAction>
        </div>
      )}
      <RepoDimensionModal org={org} target={target} onClose={() => setTarget(null)} />
    </>
  );
}
