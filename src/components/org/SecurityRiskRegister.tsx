"use client";

// The Security tab's risk register — ONE dense table instead of three half-empty cards (weakest
// repos / gate failures / advisory list): every scanned repo with its D9 score, gate verdict,
// default-branch rule detail, and open advisories. Each score cell opens RepoDimensionModal (the
// same drill-in the Repositories heatmap uses), so the evaluation and next steps for the weak repo
// are one click away instead of a dead number. Rows arrive pre-sorted by risk (gate-failing first,
// weakest first) — that IS the default sort; headers re-sort client-side (PassportTable's pattern).

import { useMemo, useState } from "react";
import Link from "next/link";
import { OrgTable } from "@/components/org/ui";
import { heatCell } from "@/lib/ui";
import { RepoDimensionModal, type HeatTarget } from "@/components/org/RepoDimensionModal";
import type { SecurityRegisterRow } from "@/lib/org/security";

/** Per-repo open-advisory counts (only present when supply-chain scanning is enabled). */
export interface RegisterAdvisories {
  fullName: string;
  critical: number;
  high: number;
  total: number;
}

const VISIBLE_DEFAULT = 10;

const RULES = [
  { key: "protected", short: "prot", title: "Default branch protected" },
  { key: "review", short: "rev", title: "Requires an approving review" },
  { key: "checks", short: "ci", title: "Requires status checks to pass" },
  { key: "signed", short: "sig", title: "Requires signed commits" },
] as const;

type SortKey = "risk" | "name" | "score" | "rules" | "adv";

/** First-click direction per column — the reading a security review reaches for first. */
const DEFAULT_DIR: Record<SortKey, "asc" | "desc"> = {
  risk: "asc", // riskiest first (the server order)
  name: "asc",
  score: "asc", // weakest first
  rules: "asc", // fewest protections first
  adv: "desc", // most advisories first
};

/** Count of enabled branch rules; unreadable governance sorts as riskier than zero rules. */
function ruleCount(r: SecurityRegisterRow): number {
  if (!r.rules) return -1;
  return Number(r.rules.protected) + Number(r.rules.review) + Number(r.rules.checks) + Number(r.rules.signed);
}

export function SecurityRiskRegister({
  org,
  rows,
  advisories,
}: {
  org: string;
  rows: SecurityRegisterRow[];
  /** null = supply-chain scanning off (column hidden); [] = on but nothing found yet. */
  advisories: RegisterAdvisories[] | null;
}) {
  const [target, setTarget] = useState<HeatTarget | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("risk");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const advByRepo = useMemo(() => (advisories ? new Map(advisories.map((a) => [a.fullName, a])) : null), [advisories]);

  const sorted = useMemo(() => {
    if (sortKey === "risk" && dir === "asc") return rows;
    const riskRank = new Map(rows.map((r, i) => [r.fullName, i]));
    const valueOf = (r: SecurityRegisterRow): number | string => {
      switch (sortKey) {
        case "risk":
          return riskRank.get(r.fullName) ?? 0;
        case "name":
          return r.name.toLowerCase();
        case "score":
          return r.score;
        case "rules":
          return ruleCount(r);
        case "adv":
          return advByRepo?.get(r.fullName)?.total ?? -1;
      }
    };
    return [...rows].sort((a, b) => {
      const va = valueOf(a);
      const vb = valueOf(b);
      const cmp = typeof va === "string" ? va.localeCompare(vb as string) : va - (vb as number);
      return dir === "asc" ? cmp : -cmp;
    });
  }, [rows, sortKey, dir, advByRepo]);

  function toggle(k: SortKey) {
    if (sortKey === k) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setDir(DEFAULT_DIR[k]);
    }
  }

  const Th = ({ k, label, align = "left", title }: { k: SortKey; label: string; align?: "left" | "center" | "right"; title?: string }) => (
    <th className={`px-3 py-2 text-${align}`} aria-sort={sortKey === k ? (dir === "asc" ? "ascending" : "descending") : undefined}>
      <button
        type="button"
        onClick={() => toggle(k)}
        title={title}
        className="inline-flex items-center gap-1 uppercase tracking-[0.2em] transition hover:text-slate-200"
      >
        {label}
        <span aria-hidden className={sortKey === k ? "text-accent" : "text-slate-700"}>{sortKey === k ? (dir === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );

  const visible = showAll ? sorted : sorted.slice(0, VISIBLE_DEFAULT);

  return (
    <>
      <OrgTable
        className="mt-3"
        caption="Security risk register: Security (D9) score, gate verdict, branch rules and open advisories per repo"
        minWidth={advByRepo ? 720 : 620}
        head={
          <tr>
            <Th k="name" label="Repo" />
            <Th k="score" label="D9" align="center" title="Security (D9) score — click a cell for the evaluation and next steps" />
            <Th k="risk" label="Gate" title="Security gate verdict — 'Gate' sorts riskiest first" />
            <Th k="rules" label="Branch rules" title="Default-branch rules: protected · review · status checks · signed commits" />
            {advByRepo && <Th k="adv" label="Advisories" align="right" />}
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
                <span className="font-mono text-sm text-slate-300" title={r.fullName}>
                  {r.name}
                </span>
              </td>
              <td className="px-3 py-1.5 text-center">
                <button
                  type="button"
                  onClick={() => setTarget({ fullName: r.fullName, name: r.name, dimId: "D9" })}
                  className="focus-ring mx-auto flex h-7 w-10 items-center justify-center rounded font-mono text-sm transition hover:ring-2 hover:ring-accent/60"
                  style={{ backgroundColor: cell.fill, color: cell.text }}
                  title={`${r.name} · Security (D9): ${r.score} — click for evaluation and next steps`}
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
                {r.rules ? (
                  <span className="inline-flex gap-1">
                    {RULES.map((rule) => {
                      const on = r.rules![rule.key];
                      return (
                        <span
                          key={rule.key}
                          title={`${rule.title}: ${on ? "yes" : "no"}`}
                          className={`rounded border px-1.5 py-0.5 font-mono text-xs ${
                            on ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-slate-800 text-slate-600"
                          }`}
                        >
                          {rule.short}
                        </span>
                      );
                    })}
                  </span>
                ) : (
                  <span className="font-mono text-sm text-slate-600" title="Branch protection not readable — connect a GitHub token/App">
                    —
                  </span>
                )}
              </td>
              {advByRepo && (
                <td className="px-3 py-2 text-right">
                  {adv && adv.total > 0 ? (
                    <a
                      href={`https://github.com/${r.fullName}/security/dependabot`}
                      target="_blank"
                      rel="noreferrer"
                      className="focus-ring font-mono text-sm text-slate-300 hover:text-white"
                      title={`${adv.total} open Dependabot advisories — open on GitHub`}
                    >
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
                <Link
                  href={`/report/${r.fullName}`}
                  className="focus-ring font-mono text-sm text-slate-500 transition hover:text-accent"
                  title={`Open the full report for ${r.fullName}`}
                  aria-label={`Open the full report for ${r.name}`}
                >
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
