"use client";

// The fleet passport portfolio table (P3) — one row per scanned repo, every column a sortable enum/score
// so "which apps are production-ready / share a stack / have no observability" sorts at a glance (design
// §6). Click a header to sort; click again to flip. Default: production score, descending. Every row
// expands (chevron / row click, or a scatter point click via `focus`) into PassportRowDetail — the
// blockers and observed facts behind the numbers, so the next step is always one click away. Reuses the
// OrgTable chrome; rows are plain serializable data passed from the server page.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { OrgTable } from "@/components/org/shared/ui";
import { bandColor, bandLabel } from "@/lib/org/passport-display";
import { PassportRowDetail, type PassportDetail } from "@/features/standing/passports/PassportRowDetail";
import { PassportTableHead } from "@/features/standing/passports/PassportTableHead";
import { PlaceholderMark } from "@/features/standing/passports/PlaceholderMark";
import { ordinalOf, type SortKey, type ThSort } from "@/features/standing/passports/passportTableSort";
import type { DecisionMap } from "@/lib/org/decision-map";
import { scoreHex } from "@/lib/ui";

export interface PassportRow {
  fullName: string;
  name: string;
  autoLevel: string;
  autoScore: number;
  band: string;
  prodScore: number;
  ci: string;
  tests: string;
  security: string;
  observability: string;
  /** The latest scan came from the deterministic MOCK engine — a placeholder floor, not a graded
   *  scan. Optional so a caller that has not plumbed the engine through contributes no claim either
   *  way (absent reads as "not a known placeholder", never as "confirmed live"). */
  placeholder?: boolean;
  detail: PassportDetail;
}

export function PassportTable({
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
  const [sortKey, setSortKey] = useState<SortKey>("prodScore");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [expanded, setExpanded] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  // A scatter point click focuses its repo here: expand the row and bring it into view. `focus` is a
  // fresh object per click, so re-clicking the same point re-scrolls.
  useEffect(() => {
    if (!focus) return;
    // Respond to an external scatter-point focus by expanding that row and scrolling it into view —
    // both are deliberate DOM-sync side-effects that belong in an effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpanded(focus.fullName);
    rowRefs.current[focus.fullName]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focus]);

  const sorted = useMemo(() => {
    const out = [...rows].sort((a, b) => {
      const av = ordinalOf(a, sortKey);
      const bv = ordinalOf(b, sortKey);
      const cmp = typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv) : Number(av) - Number(bv);
      return dir === "asc" ? cmp : -cmp;
    });
    return out;
  }, [rows, sortKey, dir]);

  function toggle(key: SortKey) {
    if (key === sortKey) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setDir(key === "name" ? "asc" : "desc");
    }
  }

  const sort: ThSort = { key: sortKey, dir, onSort: toggle };

  return (
    <OrgTable
      caption="Fleet passport portfolio: automation and production readiness per repo. Expand a row for blockers and facts"
      minWidth={760}
      head={<PassportTableHead sort={sort} />}
    >
      {sorted.map((r) => {
        const open = expanded === r.fullName;
        return [
          <tr
            key={r.fullName}
            ref={(el) => { rowRefs.current[r.fullName] = el; }}
            className="cursor-pointer text-slate-300"
            onClick={() => setExpanded(open ? null : r.fullName)}
          >
            <td className="px-3 py-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <Link
                  href={`/report?repo=${encodeURIComponent(r.fullName)}`}
                  onClick={(e) => e.stopPropagation()}
                  className="truncate type-mono-sm text-white hover:text-accent"
                >
                  {r.name}
                </Link>
                {/* Provenance, never exclusion: a placeholder row stays in the table, in the scatter
                    and in the Pareto counts — it is only LABELLED, so the reader can discount it. */}
                {r.placeholder && <PlaceholderMark />}
              </span>
            </td>
            <td className="px-3 py-2 text-right font-mono tabular-nums" style={{ color: scoreHex(r.autoScore) }}>
              {r.autoLevel} <span className="text-slate-500">·</span> {r.autoScore}
            </td>
            <td className="px-3 py-2 text-right font-mono tabular-nums" style={{ color: bandColor(r.band) }}>
              {bandLabel(r.band)} <span className="text-slate-500">·</span> {r.prodScore}
            </td>
            <td className="px-3 py-2 type-mono-sm" style={{ color: r.ci === "gated" || r.ci === "delivery" || r.ci === "progressive" ? "#84cc16" : "#94a3b8" }}>{r.ci}</td>
            <td className="px-3 py-2 type-mono-sm text-slate-400">{r.tests}</td>
            <td className="px-3 py-2 type-mono-sm" style={{ color: r.security === "gated" || r.security === "supply-chain" ? "#84cc16" : "#94a3b8" }}>{r.security}</td>
            <td className="px-3 py-2 type-mono-sm" style={{ color: r.observability === "none" ? "#f97316" : "#94a3b8" }}>{r.observability}</td>
            <td className="px-2 py-2 text-center">
              <button
                type="button"
                aria-expanded={open}
                aria-label={`${open ? "Collapse" : "Expand"} ${r.name} passport detail`}
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded(open ? null : r.fullName);
                }}
                className="focus-ring rounded px-1 type-mono-sm text-slate-500 transition hover:text-accent"
              >
                <span
                  aria-hidden
                  className={`inline-block transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
                >
                  ▸
                </span>
              </button>
            </td>
          </tr>,
          open ? (
            <tr key={`${r.fullName}-detail`}>
              <td colSpan={8} className="p-0">
                {/* Mount-only height reveal (collapse stays instant, per the brand's entrance-beat
                    rule); the min-h-0 overflow-hidden child is what the 0fr→1fr row clamps. */}
                <div className="animate-expand-down">
                  <div className="min-h-0 overflow-hidden">
                    <PassportRowDetail fullName={r.fullName} detail={r.detail} org={org} decisions={decisions} />
                  </div>
                </div>
              </td>
            </tr>
          ) : null,
        ];
      })}
    </OrgTable>
  );
}
