"use client";

// Prism parts of the Security register: the sortable head cell (sentence case sans, a glyph for direction),
// the Gaps cell (failing and not-judged as words), and the advisories cell. Same inputs as the v1 parts in
// SecurityRiskRegisterParts.tsx and securityRegisterShared.ts; status travels by glyph and word, not hue.
import type { ReactNode } from "react";
import { Chip, VoidMark } from "@/components/kit";
import type { SecurityRegisterRow } from "@/lib/org/security";
import { checkTally, type SecurityMatrixInput } from "./securityMatrixModel";
import type { RegisterAdvisories } from "./securityRegisterShared";
import type { ThSort } from "./SecurityRiskRegisterParts";
import type { SortKey } from "./securityRegisterShared";

export function ThV2({ k, label, align = "left", title, sort, badge }: { k: SortKey; label: string; align?: "left" | "center" | "right"; title?: string; sort: ThSort; badge?: ReactNode }) {
  const on = sort.key === k;
  return (
    <th className={`px-4 py-3 font-normal text-${align}`} aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
      <button type="button" onClick={() => sort.onSort(k)} title={title} className="focus-ring inline-flex items-center gap-1.5 transition hover:text-white">
        {label}
        <span aria-hidden className={on ? "text-white" : "text-slate-500"}>
          {on ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
      {badge}
    </th>
  );
}

export function CoverageCellV2({ row }: { row: SecurityMatrixInput }) {
  if (!row.measured) return <VoidMark subject={`${row.name} · D9 battery`} label="no battery" />;
  const { failing, notJudged, graded } = checkTally(row);
  if (graded === 0 && notJudged === 0) {
    return (
      <span className="type-caption text-slate-400" title="No deterministic checks on this scan. Re-scan to populate the control battery.">
        Re-scan for checks
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1 type-caption text-slate-200">
      <span title={`${failing} of ${graded} graded controls score below 4/10`}>
        <span aria-hidden>{failing > 0 ? "✕ " : "✓ "}</span>
        {failing} failing
      </span>
      {notJudged > 0 && (
        <span className="inline-flex items-center gap-1.5 text-slate-400" title={`${notJudged} of ${notJudged + graded} controls produced no grade`}>
          <VoidMark size={12} subject={`${row.name} · ${notJudged} controls`} />
          {notJudged} not judged
        </span>
      )}
    </span>
  );
}

export function GateCellV2({ row }: { row: SecurityRegisterRow }) {
  return row.gateReason ? (
    <span className="type-body-sm text-white">
      <span aria-hidden>✕ </span>
      {row.gateReason}
    </span>
  ) : (
    <span className="type-body-sm text-slate-300">
      <span aria-hidden>✓ </span>pass
    </span>
  );
}

const SEVERITIES = ["critical", "high", "medium", "low"] as const;

/** Advisory counts as words ("2 critical, 1 high"), measured severities only. */
function severityWords(adv: RegisterAdvisories): string {
  return SEVERITIES.flatMap((k) => (typeof adv[k] === "number" && (adv[k] as number) > 0 ? [`${adv[k]} ${k}`] : [])).join(", ");
}

export function AdvisoryCellV2({ row, adv, demo }: { row: SecurityRegisterRow; adv: RegisterAdvisories | undefined; demo: boolean }) {
  if (!adv) return <VoidMark subject={`${row.name} · advisories`} />;
  if (adv.total === 0) {
    return (
      <span className="type-caption text-slate-400" title={`${row.name}: advisories were fetched and none are open`}>
        0
      </span>
    );
  }
  const body = (
    <>
      <span className="tabular-nums text-white">{adv.total}</span> <span className="type-caption text-slate-400">{severityWords(adv)}</span>
    </>
  );
  // Demo counts do not exist on GitHub: a deep link would land on a Dependabot page showing something else.
  return demo ? (
    <span title="Demo data, no matching advisories exist on GitHub">{body}</span>
  ) : (
    <a href={`https://github.com/${row.fullName}/security/dependabot`} target="_blank" rel="noreferrer" className="focus-ring hover:text-white" title={`${adv.total} open Dependabot advisories, open on GitHub`}>
      {body} ↗
    </a>
  );
}

export const DemoBadgeV2 = (
  <span className="ml-2 align-middle">
    <Chip tone="warn" title="SUPPLY_CHAIN_PROVIDER=mock: these counts are deterministic demo data, not this fleet's real advisories">
      demo data
    </Chip>
  </span>
);
