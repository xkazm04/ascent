"use client";

// The per-dimension small-multiples grid of DimensionTrends, relocated from DimensionTrends.tsx to
// keep that file within the 300-LOC limit: the loaded cards, the load-failure retry, and the
// shimmer placeholders. Hook-free; the retry handler arrives as a prop. Marked "use client" because
// it binds that handler, and its only importer is the client DimensionTrends.

import { DIMENSIONS } from "@/lib/maturity/model";
import { scoreGlyph, scoreHex } from "@/lib/ui";
import { EmptyState } from "@/components/EmptyState";
import { Surface } from "@/components/ui";
import type { TrendAnnotation } from "@/app/trends/annotations";
import { DeltaTag } from "@/components/report/deltas";
import { DimLine, type ScanMeta } from "@/components/report/DimLine";

export interface DimensionRow {
  id: string;
  name: string;
  weight: number;
  current: number | undefined;
  series: (number | null)[];
  delta: number | null;
}

export function DimensionTrendsGrid({
  dimState,
  rows,
  meta,
  annotations,
  onRetry,
}: {
  dimState: "idle" | "loading" | "error" | "done";
  rows: DimensionRow[];
  meta: ScanMeta[];
  annotations: TrendAnnotation[];
  onRetry: () => void;
}) {
  return dimState === "done" ? (
    <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((r) => (
        <Surface key={r.id} radius="xl" className="p-4">
          <div className="flex items-start justify-between">
            <div>
              <span className="type-mono-sm text-slate-500">{r.id}</span>
              <h3 className="type-body font-semibold text-white">{r.name}</h3>
            </div>
            <div className="text-right">
              <div
                className="font-mono type-title font-bold tabular-nums"
                style={{ color: r.current !== undefined ? scoreHex(r.current) : "#475569" }}
              >
                {/* Redundant (non-color) cue so the score's level reads without relying on
                    hue alone (CVD), mirroring the report's treatment. */}
                {r.current !== undefined && (
                  <span aria-hidden className="mr-1 align-middle type-body-sm">
                    {scoreGlyph(r.current)}
                  </span>
                )}
                {r.current ?? "—"}
              </div>
              {r.delta !== null && <DeltaTag delta={r.delta} hideZero />}
            </div>
          </div>
          <DimLine values={r.series} meta={meta} name={r.name} current={r.current} annotations={annotations} />
        </Surface>
      ))}
    </div>
  ) : dimState === "error" ? (
    <div className="mt-4">
      <EmptyState variant="section" title="Couldn't load the per-dimension breakdown">
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg border border-slate-700 px-3 py-1.5 type-body-sm text-slate-300 transition hover:border-accent hover:text-white"
        >
          Retry
        </button>
      </EmptyState>
    </div>
  ) : (
    // idle / loading: shimmer placeholder cards while the dimension rows load. One card per
    // DIMENSION (not a hardcoded 6) so the placeholder grid is exactly the height the loaded
    // grid resolves to, with no extra row popping in after load (CLS).
    <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
      {Array.from({ length: DIMENSIONS.length }).map((_, i) => (
        <Surface key={i} radius="xl" className="p-4">
          <div className="h-4 w-24 animate-pulse rounded bg-slate-800" />
          <div className="mt-3 h-[90px] w-full animate-pulse rounded bg-slate-800/60" />
        </Surface>
      ))}
    </div>
  );
}
