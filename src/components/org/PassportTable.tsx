"use client";

// The fleet passport portfolio table (P3) — one row per scanned repo, every column a sortable enum/score
// so "which apps are production-ready / share a stack / have no observability" sorts at a glance (design
// §6). Click a header to sort; click again to flip. Default: production score, descending. Every row
// expands (chevron / row click, or a scatter point click via `focus`) into PassportRowDetail — the
// blockers and observed facts behind the numbers, so the next step is always one click away. Reuses the
// OrgTable chrome; rows are plain serializable data passed from the server page.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { OrgTable } from "@/components/org/ui";
import { bandColor, bandLabel } from "@/lib/org/passport-display";
import { PassportRowDetail, type PassportDetail } from "@/components/org/PassportRowDetail";
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
  detail: PassportDetail;
}

type SortKey = "name" | "autoScore" | "prodScore" | "ci" | "tests" | "security" | "observability";

const CI_ORDER = ["none", "build", "checks", "gated", "delivery", "progressive"];
const TEST_ORDER = ["none", "smoke", "partial", "substantial", "comprehensive"];
const SEC_ORDER = ["none", "policy", "scanning", "gated", "supply-chain"];
const OBS_ORDER = ["none", "logs", "errors", "metrics", "tracing"];
const rank = (order: string[], v: string) => order.indexOf(v);

function ordinalOf(r: PassportRow, key: SortKey): number | string {
  switch (key) {
    case "name": return r.name.toLowerCase();
    case "autoScore": return r.autoScore;
    case "prodScore": return r.prodScore;
    case "ci": return rank(CI_ORDER, r.ci);
    case "tests": return rank(TEST_ORDER, r.tests);
    case "security": return rank(SEC_ORDER, r.security);
    case "observability": return rank(OBS_ORDER, r.observability);
  }
}

export function PassportTable({ rows, focus }: { rows: PassportRow[]; focus?: { fullName: string } | null }) {
  const [sortKey, setSortKey] = useState<SortKey>("prodScore");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [expanded, setExpanded] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  // A scatter point click focuses its repo here: expand the row and bring it into view. `focus` is a
  // fresh object per click, so re-clicking the same point re-scrolls.
  useEffect(() => {
    if (!focus) return;
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

  const Th = ({ k, label, align = "left" }: { k: SortKey; label: string; align?: "left" | "right" }) => (
    <th className={`px-3 py-2 text-${align}`}>
      <button type="button" onClick={() => toggle(k)} className="inline-flex items-center gap-1 uppercase tracking-[0.2em] transition hover:text-slate-200">
        {label}
        <span aria-hidden className={sortKey === k ? "text-accent" : "text-slate-700"}>{sortKey === k ? (dir === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );

  return (
    <OrgTable
      caption="Fleet passport portfolio: automation and production readiness per repo — expand a row for blockers and facts"
      minWidth={760}
      head={
        <tr>
          <Th k="name" label="Repo" />
          <Th k="autoScore" label="Automation" align="right" />
          <Th k="prodScore" label="Production" align="right" />
          <Th k="ci" label="CI" />
          <Th k="tests" label="Tests" />
          <Th k="security" label="Security" />
          <Th k="observability" label="Observability" />
          <th className="w-10 px-2 py-2" aria-label="Expand row" />
        </tr>
      }
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
              <Link
                href={`/report?repo=${encodeURIComponent(r.fullName)}`}
                onClick={(e) => e.stopPropagation()}
                className="font-mono text-sm text-white hover:text-accent"
              >
                {r.name}
              </Link>
            </td>
            <td className="px-3 py-2 text-right font-mono tabular-nums" style={{ color: scoreHex(r.autoScore) }}>
              {r.autoLevel} <span className="text-slate-500">·</span> {r.autoScore}
            </td>
            <td className="px-3 py-2 text-right font-mono tabular-nums" style={{ color: bandColor(r.band) }}>
              {bandLabel(r.band)} <span className="text-slate-500">·</span> {r.prodScore}
            </td>
            <td className="px-3 py-2 font-mono text-sm" style={{ color: r.ci === "gated" || r.ci === "delivery" || r.ci === "progressive" ? "#84cc16" : "#94a3b8" }}>{r.ci}</td>
            <td className="px-3 py-2 font-mono text-sm text-slate-400">{r.tests}</td>
            <td className="px-3 py-2 font-mono text-sm" style={{ color: r.security === "gated" || r.security === "supply-chain" ? "#84cc16" : "#94a3b8" }}>{r.security}</td>
            <td className="px-3 py-2 font-mono text-sm" style={{ color: r.observability === "none" ? "#f97316" : "#94a3b8" }}>{r.observability}</td>
            <td className="px-2 py-2 text-center">
              <button
                type="button"
                aria-expanded={open}
                aria-label={`${open ? "Collapse" : "Expand"} ${r.name} passport detail`}
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded(open ? null : r.fullName);
                }}
                className="focus-ring rounded px-1 font-mono text-sm text-slate-500 transition hover:text-accent"
              >
                {open ? "▾" : "▸"}
              </button>
            </td>
          </tr>,
          open ? (
            <tr key={`${r.fullName}-detail`}>
              <td colSpan={8} className="p-0">
                <PassportRowDetail fullName={r.fullName} detail={r.detail} />
              </td>
            </tr>
          ) : null,
        ];
      })}
    </OrgTable>
  );
}
