"use client";

// The Security tab's risk register — one row per scanned repo, framed as a DETERMINISTIC security-
// control coverage grid. The centre is the OpenSSF-Scorecard-style check battery: one grade-colored
// chip per control (branch protection · dangerous-workflow · token perms · pinned deps · dep updates ·
// SAST · SBOM · signing · policy), then a divider and the EXPOSURE check (current open vulns). Green
// ≥7, amber 4–6, red <4, slate = not applicable. Reading down a column exposes a fleet-wide gap; across
// a row shows a repo's missing controls. The D9 score cell opens RepoDimensionModal for the full
// per-check evidence + remediation. The number is computed, not judged — see src/lib/security/checks.ts.

import { useMemo, useState } from "react";
import Link from "next/link";
import { OrgTable } from "@/components/org/shared/ui";
import { heatCell } from "@/lib/ui";
import { RepoDimensionModal, type HeatTarget } from "@/components/org/shared/RepoDimensionModal";
import type { SecurityRegisterRow, SecurityRowCheck } from "@/lib/org/security";
import {
  CHECK_ORDER,
  checksById,
  DEFAULT_DIR,
  gradeTone,
  sortRows,
  VISIBLE_DEFAULT,
  type RegisterAdvisories,
  type SortKey,
} from "@/components/org/security/securityRegisterShared";

export type { RegisterAdvisories };

const TONE: Record<string, string> = {
  ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  bad: "border-red-500/40 bg-red-500/10 text-red-300",
  na: "border-slate-800 text-slate-600",
};

function CheckChip({ short, check }: { short: string; check?: SecurityRowCheck }) {
  const tone = gradeTone(check?.score ?? null);
  const grade = !check || check.score === null ? "n/a" : `${check.score}/10`;
  const title = check ? `${check.name} (${check.risk}) — ${grade}: ${check.detail}` : `${short}: not evaluated in this scan`;
  return (
    <span title={title} className={`rounded border px-1.5 py-0.5 font-mono text-xs ${TONE[tone]}`}>
      {short}
    </span>
  );
}

type ThSort = { key: SortKey; dir: "asc" | "desc"; onSort: (k: SortKey) => void };

/** Sortable table-header cell. Declared at module scope (not inside the component) so it isn't
 *  recreated on every render; the sort state it needs is passed in via `sort`. */
function Th({ k, label, align = "left", title, sort }: { k: SortKey; label: string; align?: "left" | "center" | "right"; title?: string; sort: ThSort }) {
  return (
    <th className={`px-3 py-2 text-${align}`} aria-sort={sort.key === k ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
      <button type="button" onClick={() => sort.onSort(k)} title={title} className="inline-flex items-center gap-1 uppercase tracking-[0.2em] transition hover:text-slate-200">
        {label}
        <span aria-hidden className={sort.key === k ? "text-accent" : "text-slate-700"}>{sort.key === k ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );
}

export function SecurityRiskRegister({
  org,
  rows,
  advisories,
}: {
  org: string;
  rows: SecurityRegisterRow[];
  /** null = supply-chain scanning off (advisories column hidden); [] = on but nothing found yet. */
  advisories: RegisterAdvisories[] | null;
}) {
  const [target, setTarget] = useState<HeatTarget | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("risk");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const advByRepo = useMemo(() => (advisories ? new Map(advisories.map((a) => [a.fullName, a])) : null), [advisories]);
  const sorted = useMemo(() => sortRows(rows, sortKey, dir, advByRepo), [rows, sortKey, dir, advByRepo]);
  const visible = showAll ? sorted : sorted.slice(0, VISIBLE_DEFAULT);
  const posture = CHECK_ORDER.filter((c) => c.group === "posture");
  const exposure = CHECK_ORDER.filter((c) => c.group === "exposure");

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
      <OrgTable
        className="mt-3"
        caption="Security control matrix: deterministic Scorecard-style checks (branch protection, workflow safety, pinned deps, SAST, SBOM, signing, policy) + current vuln exposure, graded 0–10 per repo"
        minWidth={advByRepo ? 940 : 840}
        head={
          <tr>
            <Th k="name" label="Repo" sort={sort} />
            <Th k="score" label="D9" align="center" title="Security (D9) score — deterministic; click for the full per-check evidence" sort={sort} />
            <Th k="risk" label="Gate" title="Security gate verdict — 'Gate' sorts riskiest first" sort={sort} />
            <Th k="gaps" label="Control coverage" title="Deterministic control checks (green ≥7 · amber 4–6 · red <4 · slate n/a) — posture, then the ┃ divider and current vuln exposure. Sorts by failing-control count." sort={sort} />
            {advByRepo && <Th k="adv" label="Advisories" align="right" sort={sort} />}
            <th className="w-10 px-2 py-2" aria-label="Open report" />
          </tr>
        }
      >
        {visible.map((r) => {
          const cell = heatCell(r.score, 0.25 + (r.score / 100) * 0.75);
          const adv = advByRepo?.get(r.fullName);
          const byId = checksById(r.checks);
          const graded = r.checks.length > 0;
          return (
            <tr key={r.fullName}>
              <td className="px-3 py-2">
                <span className="font-mono text-sm text-slate-300" title={r.fullName}>{r.name}</span>
              </td>
              <td className="px-3 py-1.5 text-center">
                <button
                  type="button"
                  onClick={() => setTarget({ fullName: r.fullName, name: r.name, dimId: "D9" })}
                  className="focus-ring mx-auto flex h-7 w-10 items-center justify-center rounded font-mono text-sm transition hover:ring-2 hover:ring-accent/60"
                  style={{ backgroundColor: cell.fill, color: cell.text }}
                  title={`${r.name} · Security (D9): ${r.score} — click for per-check evidence and next steps`}
                  aria-label={`${r.name} security score ${r.score} — open detail`}
                >
                  {r.score}
                </button>
              </td>
              <td className="px-3 py-2">
                {r.gateReason ? (
                  <span className="font-mono text-sm text-red-300">✗ {r.gateReason}</span>
                ) : (
                  <span className="font-mono text-sm text-emerald-300/80">✓ pass</span>
                )}
              </td>
              <td className="px-3 py-2">
                {graded ? (
                  <div className="flex items-center gap-1">
                    {posture.map((c) => <CheckChip key={c.id} short={c.short} check={byId.get(c.id)} />)}
                    <span aria-hidden className="mx-1 h-4 w-px bg-divider" />
                    {exposure.map((c) => <CheckChip key={c.id} short={c.short} check={byId.get(c.id)} />)}
                  </div>
                ) : (
                  <span className="font-mono text-sm text-slate-600" title="No deterministic checks on this scan — re-scan to populate the control grid.">— re-scan for checks</span>
                )}
              </td>
              {advByRepo && (
                <td className="px-3 py-2 text-right">
                  {adv && adv.total > 0 ? (
                    <a href={`https://github.com/${r.fullName}/security/dependabot`} target="_blank" rel="noreferrer" className="focus-ring font-mono text-sm text-slate-300 hover:text-white" title={`${adv.total} open Dependabot advisories — open on GitHub`}>
                      {adv.critical > 0 && <span className="text-red-300">{adv.critical}C </span>}
                      {adv.high > 0 && <span className="text-orange-300">{adv.high}H </span>}
                      {adv.total} ↗
                    </a>
                  ) : (
                    <span className="font-mono text-sm text-slate-600">{adv ? "0" : "—"}</span>
                  )}
                </td>
              )}
              <td className="px-2 py-2 text-right">
                <Link href={`/report/${r.fullName}`} className="focus-ring font-mono text-sm text-slate-500 transition hover:text-accent" title={`Open the full report for ${r.fullName}`} aria-label={`Open the full report for ${r.name}`}>
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
          className="focus-ring mt-3 rounded-md border border-slate-700 px-3 py-1.5 font-mono text-sm text-slate-300 transition hover:border-accent hover:text-white"
        >
          {showAll ? "Show fewer" : `Show all ${rows.length} repos`}
        </button>
      )}
      <RepoDimensionModal org={org} target={target} onClose={() => setTarget(null)} />
    </>
  );
}
