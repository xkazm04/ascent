"use client";

// Cell-click detail for the Repositories heatmap: a repo's ONE dimension — score provenance,
// evaluation (summary/evidence/gaps) and the open recommendations ("next steps") — lazily fetched
// from /api/org/repo-dimension when a cell is clicked, so the fleet grid itself stays lightweight.
// Reuses the report's DimensionDetail so a heatmap drill-in reads identically to the per-repo report.

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ScanReport } from "@/lib/types";
import { DimensionDetail } from "@/components/report/DimensionDetail";
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

  // Escape closes — only wired while a target is open.
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [target, onClose]);

  if (!target) return null;
  const short = DIMENSION_SHORT[target.dimId as keyof typeof DIMENSION_SHORT] ?? target.dimId;

  return (
    // Backdrop click closes; the panel stops propagation so an inner click doesn't.
    <div
      className="fixed inset-0 z-50 flex overflow-y-auto bg-black/70 p-4 sm:p-8"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${target.name} · ${short}`}
    >
      <div
        className="m-auto w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="truncate font-mono text-sm text-slate-500">{target.fullName}</div>
            <h2 className="mt-0.5 text-lg font-semibold text-white">
              {target.dimId} · {short}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="focus-ring shrink-0 rounded-md border border-slate-700 px-2 py-1 text-slate-400 transition hover:border-accent hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="mt-4">
          {loading && <p className="font-mono text-sm text-slate-500">Loading…</p>}
          {error && <p className="text-sm text-danger">{error}</p>}
          {data && (
            <>
              <DimensionDetail d={data.dimension} />

              <div className="mt-5 border-t border-divider pt-4">
                <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">Next steps</div>
                {data.nextSteps.length === 0 ? (
                  <p className="mt-1 text-sm text-slate-500">
                    No open recommendations for this dimension — it isn&apos;t a current gap.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2.5">
                    {data.nextSteps.map((r, i) => (
                      <li key={i} className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
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
                        {r.rationale && <p className="mt-1 text-sm text-slate-400">{r.rationale}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-divider pt-4">
                <span className="font-mono text-sm text-slate-500">
                  Scanned {data.scannedAt.slice(0, 10)} · overall {data.overall} · {data.level.id}
                </span>
                <Link href={`/report/${data.repo}`} className="focus-ring font-mono text-sm text-accent hover:text-white">
                  Full report →
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
