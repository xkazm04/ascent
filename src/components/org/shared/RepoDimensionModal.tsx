"use client";

// Cell-click detail for the Repositories heatmap: a repo's ONE dimension — score provenance,
// evaluation (summary/evidence/gaps) and the open recommendations ("next steps") — lazily fetched
// from /api/org/repo-dimension when a cell is clicked, so the fleet grid itself stays lightweight.
// Reuses the report's DimensionDetail so a heatmap drill-in reads identically to the per-repo report.
//
// Built on the brand `Modal`, which PORTALS into the app's ModalRoot. It used to render a hand-rolled
// `fixed inset-0` overlay in place — inside the Overview's `.stagger-children` region, whose entrance
// animation (`animation-fill-mode: both`) leaves an identity `transform` on three ancestors. A
// transformed ancestor is the containing block for `position: fixed`, so "inset-0" meant the edges of
// the dashboard column, not the viewport: measured at left 308 / top −81 on a 1770px window, i.e. the
// dialog was off-centre and its top clipped. A portal escapes that subtree entirely.

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ScanReport } from "@/lib/types";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui";
import { DimensionDetail } from "@/components/report/DimensionDetail";
import { MarkdownLite } from "@/components/report/MarkdownLite";
import type { TrendPoint } from "@/components/report/TrendChart";
import { DIMENSION_SHORT, EFFORT_CLASS, IMPACT_CLASS } from "@/lib/ui";

export interface HeatTarget {
  fullName: string;
  name: string;
  dimId: string;
}

interface DimData {
  repo: string;
  scannedAt: string;
  overall: number;
  level: { id: string; name: string };
  dimension: ScanReport["dimensions"][number];
  nextSteps: ScanReport["roadmap"];
  /** This dimension's score over recent scans (oldest→newest) — the DimensionDetail sparkline. */
  series?: TrendPoint[];
  /** The dimension's score on the prior scan — drives DimensionDetail's "since last scan" delta. */
  prevScore?: number;
}

/** Below this the dimension is not yet "green" (L4 starts at 65) and a follow-up is owed. Mirrors
 *  the engine's guarantee (buildDimensionFollowUps); named here so the empty-state copy can be honest
 *  about WHY there is nothing to do rather than saying "not a gap" about a 60. */
const FOLLOW_UP_BELOW = 65;

export function RepoDimensionModal({
  org,
  target,
  onClose,
}: {
  org: string;
  target: HeatTarget | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<DimData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Fetch the clicked cell's dimension detail. Keyed on the target's identity so re-clicking a
  // different cell refetches; a per-run `cancelled` flag drops a stale response. The state resets +
  // fetch live inside an async IIFE (not the effect body) so no setState runs synchronously in the
  // effect — the same pattern useReportScan uses.
  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    const q = `org=${encodeURIComponent(org)}&repo=${encodeURIComponent(target.fullName)}&dim=${encodeURIComponent(target.dimId)}`;
    void (async () => {
      setData(null);
      setError(null);
      setLoading(true);
      try {
        const r = await fetch(`/api/org/repo-dimension?${q}`);
        const d = (await r.json().catch(() => null)) as (DimData & { error?: string }) | null;
        if (cancelled) return;
        if (!r.ok) setError(d?.error ?? `Failed (${r.status}).`);
        else setData(d as DimData);
      } catch {
        if (!cancelled) setError("Network error.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [org, target]);

  const short = target ? (DIMENSION_SHORT[target.dimId as keyof typeof DIMENSION_SHORT] ?? target.dimId) : "";

  return (
    <Modal open={target !== null} onClose={onClose} ariaLabel={target ? `${target.name} · ${short}` : "Dimension detail"} size="reading">
      {target && (
        <>
          <ModalHeader kicker={target.fullName} title={`${target.dimId} · ${short}`} />
          <ModalBody>
            {loading && <p className="font-mono text-sm text-slate-500">Loading…</p>}
            {error && <p className="text-sm text-danger">{error}</p>}
            {data && (
              <>
                {/* Reuses the report's DimensionDetail — with `series`/`prevScore` it also renders the
                    score-history sparkline + "since last scan" delta, so the drill-in shows trajectory. */}
                <DimensionDetail d={data.dimension} series={data.series} prevScore={data.prevScore} />
                <NextSteps steps={data.nextSteps} score={data.dimension.score} />
              </>
            )}
          </ModalBody>
          {data && (
            <ModalFooter>
              <span className="font-mono text-sm text-slate-500">
                Scanned {data.scannedAt.slice(0, 10)} · overall {data.overall} · {data.level.id}
              </span>
              <Link href={`/report/${data.repo}`} className="focus-ring font-mono text-sm text-accent hover:text-white">
                Full report →
              </Link>
            </ModalFooter>
          )}
        </>
      )}
    </Modal>
  );
}

function NextSteps({ steps, score }: { steps: ScanReport["roadmap"]; score: number }) {
  return (
    <div className="mt-5 border-t border-divider pt-4">
      <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">Next steps</div>
      {steps.length === 0 ? (
        // Two different silences. Above the line the dimension has genuinely earned "nothing owed";
        // below it a missing follow-up is a scan that predates the guarantee, and the honest copy
        // says so rather than certifying a 40 as "not a gap".
        <p className="mt-1 text-sm text-slate-500">
          {score >= FOLLOW_UP_BELOW
            ? "No open recommendations: this dimension is in the green band, so nothing is owed here yet."
            : "No follow-up on record for this dimension. Scans now carry one for every dimension below the green band; re-scan to get it."}
        </p>
      ) : (
        <ul className="mt-2 space-y-2.5">
          {steps.map((r, i) => (
            <li key={i} className="rounded-lg border border-divider bg-surface/40 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-white">{r.title}</span>
                <span className={`rounded border px-1.5 py-0.5 font-mono text-xs ${IMPACT_CLASS[r.impact] ?? "border-slate-700 text-slate-400"}`}>
                  impact {r.impact}
                </span>
                <span className={`rounded border px-1.5 py-0.5 font-mono text-xs ${EFFORT_CLASS[r.effort] ?? "border-slate-700 text-slate-400"}`}>
                  effort {r.effort}
                </span>
                {r.levelUnlock && (
                  <span className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-xs text-slate-400">{r.levelUnlock}</span>
                )}
              </div>
              {r.rationale && <MarkdownLite text={r.rationale} className="mt-1.5 text-sm text-slate-300" />}
              {r.explore && r.explore.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm text-slate-400">
                  {r.explore.map((q, j) => (
                    <li key={j} className="flex gap-2">
                      <span className="select-none text-slate-600">→</span>
                      <span>{q}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
