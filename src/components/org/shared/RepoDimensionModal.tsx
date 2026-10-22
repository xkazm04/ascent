"use client";

// Cell-click detail for the Repositories heatmap: a repo's ONE dimension (score provenance,
// evaluation, and the dimension's tracked "next steps" with their status and in-place verdicts,
// RepoDimensionNextSteps), lazily fetched from /api/org/repo-dimension when a cell is clicked, so the
// fleet grid itself stays lightweight.
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
import type { TrendPoint } from "@/components/report/TrendChart";
import { DIMENSION_SHORT } from "@/lib/ui";
import type { DimensionStep } from "@/lib/org/dimensionStepsModel";
import { RepoDimensionNextSteps } from "./RepoDimensionNextSteps";

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
  /** The dimension's steps with tracked status (or the bare roadmap, untracked). */
  steps: DimensionStep[];
  tracked: boolean;
  /** The tracking read FAILED (not "nothing tracked"): statuses are unknown. */
  trackingError?: boolean;
  /** The viewer may write a verdict through PATCH /api/recommendations/:id. */
  canAct: boolean;
  viewerLogin?: string | null;
  /** This dimension's score over recent scans (oldest→newest) — the DimensionDetail sparkline. */
  series?: TrendPoint[];
  /** The dimension's score on the prior scan — drives DimensionDetail's "since last scan" delta. */
  prevScore?: number;
  /** The scan's score-integrity record — the provenance track reads this dimension's REAL guardband
   *  (doubled when the model flagged the detector) and the realized blend weight from it. Absent on a
   *  row scored before the field. */
  scoreIntegrity?: ScanReport["scoreIntegrity"];
}

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
        // Silent by design: a non-JSON body leaves `d` null; the !r.ok branch below shows "Failed (status)".
        const d = (await r.json().catch(() => null)) as (DimData & { error?: string }) | null;
        if (cancelled) return;
        if (!r.ok) setError(d?.error ?? `Failed (${r.status}).`);
        else setData(d as DimData);
      } catch {
        // Silent by design: a network failure is shown to the reader as "Network error."
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
            {loading && <p className="type-mono-sm text-slate-500">Loading…</p>}
            {error && <p className="type-body-sm text-danger">{error}</p>}
            {data && (
              <>
                {/* Reuses the report's DimensionDetail — with `series`/`prevScore` it also renders the
                    score-history sparkline + "since last scan" delta, so the drill-in shows trajectory. */}
                <DimensionDetail
                  d={data.dimension}
                  series={data.series}
                  prevScore={data.prevScore}
                  integrity={data.scoreIntegrity}
                />
                <RepoDimensionNextSteps
                  key={`${data.repo}:${data.dimension.id}:${data.scannedAt}`}
                  org={org}
                  steps={data.steps ?? []}
                  score={data.dimension.score}
                  tracked={data.tracked}
                  trackingError={data.trackingError}
                  canAct={data.canAct}
                  viewerLogin={data.viewerLogin}
                />
              </>
            )}
          </ModalBody>
          {data && (
            <ModalFooter>
              <span className="type-mono-sm text-slate-500">
                Scanned {data.scannedAt.slice(0, 10)} · overall {data.overall} · {data.level.id}
              </span>
              <Link href={`/report/${data.repo}`} className="focus-ring type-mono-sm text-accent hover:text-white">
                Full report →
              </Link>
            </ModalFooter>
          )}
        </>
      )}
    </Modal>
  );
}
