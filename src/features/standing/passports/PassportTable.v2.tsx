"use client";

// Prism passport table. DataTable, compact, sticky head and first column. Scores stay paper.
// A rung's status is a glyph plus the words rungDisplayValue already prints, never a status hue.
import { Fragment } from "react";
import Link from "next/link";
import { DataTable } from "@/components/kit";
import {
  bandLabel,
  rungDisplayValue,
  rungHonesty,
  RUNG_HONESTY_HINT,
  type ProductionRung,
  type RungHonesty,
} from "@/lib/org/passport-display";
import type { DecisionMap } from "@/lib/org/decision-map";
import type { SortKey, ThSort } from "./passportTableSort";
import { PassportFactsV2 } from "./PassportFacts.v2";
import { PlaceholderMark } from "./PlaceholderMark";
import type { PassportRow } from "./PassportTable";
import { usePassportTable } from "./usePassportTable";

const GLYPH: Record<RungHonesty, string> = { enforced: "✓", present: "·", absent: "×", unassessable: "" };

function Th({ k, label, align = "left", sort }: { k: SortKey; label: string; align?: "left" | "right"; sort: ThSort }) {
  const on = sort.key === k;
  return (
    <th className={`px-3 py-2 text-${align}`}>
      <button type="button" onClick={() => sort.onSort(k)} className="inline-flex items-center gap-1">
        {label}
        <span aria-hidden>{on ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );
}

function Rung({ rung, level, findings }: { rung: ProductionRung; level: string; findings: PassportRow["detail"]["prodFindings"] }) {
  const honesty = rungHonesty(rung, level, findings);
  return (
    <td className="whitespace-nowrap px-3 py-2 text-slate-200" data-honesty={honesty} title={RUNG_HONESTY_HINT[honesty]}>
      {GLYPH[honesty] && <span aria-hidden className="mr-1 text-slate-400">{GLYPH[honesty]}</span>}
      {rungDisplayValue(rung, level, honesty)}
    </td>
  );
}

export function PassportTableV2({
  rows,
  focus,
  org,
  decisions,
}: {
  rows: PassportRow[];
  focus?: { fullName: string } | null;
  org: string;
  decisions: DecisionMap;
}) {
  const { sorted, sort, expanded, setExpanded, rowRefs } = usePassportTable(rows, focus);
  return (
    <DataTable
      density="compact"
      stickyHead="page"
      stickyFirstCol
      minWidth={980}
      caption="Fleet passport portfolio: automation and production readiness per repo. Expand a row for blockers and facts"
      labelledBy="passport-table-heading"
      head={
        <tr>
          <Th k="name" label="Repo" sort={sort} />
          <Th k="autoScore" label="Automation" align="right" sort={sort} />
          <Th k="prodScore" label="Production" align="right" sort={sort} />
          <Th k="ci" label="CI" sort={sort} />
          <Th k="tests" label="Tests" sort={sort} />
          <Th k="security" label="Security" sort={sort} />
          <Th k="observability" label="Observability" sort={sort} />
          <th className="w-10 px-2 py-2" aria-label="Expand row" />
        </tr>
      }
    >
      {sorted.map((r) => {
        const open = expanded === r.fullName;
        return (
          <Fragment key={r.fullName}>
            <tr ref={(el) => { rowRefs.current[r.fullName] = el; }} className="cursor-pointer" onClick={() => setExpanded(open ? null : r.fullName)}>
              <td className="whitespace-nowrap px-3 py-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <Link href={`/report?repo=${encodeURIComponent(r.fullName)}`} onClick={(e) => e.stopPropagation()} className="truncate font-semibold text-white hover:text-accent">
                    {r.name}
                  </Link>
                  {r.placeholder && <PlaceholderMark />}
                </span>
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                <span className="text-slate-400">{r.autoLevel}</span> <span className="text-white">{r.autoScore}</span>
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                <span className="text-slate-400">{bandLabel(r.band)}</span> <span className="text-white">{r.prodScore}</span>
              </td>
              <Rung rung="ci" level={r.ci} findings={r.detail.prodFindings} />
              <Rung rung="tests" level={r.tests} findings={r.detail.prodFindings} />
              <Rung rung="security" level={r.security} findings={r.detail.prodFindings} />
              <Rung rung="observability" level={r.observability} findings={r.detail.prodFindings} />
              <td className="px-2 py-2 text-center">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-label={`${open ? "Collapse" : "Expand"} ${r.name} passport detail`}
                  onClick={(e) => { e.stopPropagation(); setExpanded(open ? null : r.fullName); }}
                  className="focus-ring rounded px-1 text-slate-400"
                >
                  <span aria-hidden className={`inline-block ${open ? "rotate-90" : ""}`}>▸</span>
                </button>
              </td>
            </tr>
            {open ? (
              <tr>
                <td colSpan={8} className="p-0">
                  <PassportFactsV2 fullName={r.fullName} detail={r.detail} org={org} decisions={decisions} />
                </td>
              </tr>
            ) : null}
          </Fragment>
        );
      })}
    </DataTable>
  );
}
