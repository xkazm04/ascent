// The scene masthead: where this subject sits in the registry, what it is called, whether the
// showcase was authored against the subject the org's index currently mirrors, and the toolbar.
// Shared by the 3-row variants (Console, Dossier) so the identity line reads identically in both
// and only the rows below it differ — the thing the round is actually comparing.

import { Kicker } from "@/components/ui";
import type { SurfaceRecord } from "@/lib/org/surface-catalog";
import type { ReactNode } from "react";
import { SurfaceFreshnessBadge, type FreshnessLabel } from "./SurfaceFreshnessBadge";

export function SurfaceHeader({
  record,
  freshness,
  right,
}: {
  record: SurfaceRecord;
  freshness: FreshnessLabel | null;
  /** The toolbar (volume chips, reduced-motion toggle, way back to the gallery). */
  right: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <Kicker tone="muted">
          UI surfaces / {record.subcategory} / {record.slug}
        </Kicker>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h2 className="type-lede font-semibold text-white">{record.title}</h2>
          <SurfaceFreshnessBadge label={freshness} />
          <span className="type-caption text-slate-500">
            authored {record.authoredAgainst.verifiedOn} against {record.authoredAgainst.digest}
          </span>
        </div>
      </div>
      {right}
    </div>
  );
}
