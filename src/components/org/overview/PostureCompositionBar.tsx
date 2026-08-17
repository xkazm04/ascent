// The posture composition — one stacked bar of true shares plus a legend of count chips, every
// non-empty segment a deep link to the Repositories tab filtered to that posture. Hoisted out of
// the pre-redesign PostureDimensionsPanel (deleted in the 2026-08-17 Ledger consolidation): it was
// the piece of that panel that was already right, so the redesign kept it and spent its difference
// on the dimension ledger below it (LedgerDimensionRows).

import Link from "next/link";
import { postureLabel, POSTURE_ORDER } from "@/components/org/shared/ui";
import { POSTURE_HEX } from "@/components/org/shared/liveWarRoomShared";
import { buildUrl, clearedTabScopedParams } from "@/lib/org/orgTabs";

export const postureHref = (slug: string, posture: string, search: string) =>
  buildUrl(slug, { tab: "repositories", ...clearedTabScopedParams(), posture }, search);

export function PostureCompositionBar({
  slug,
  postureCounts,
  search,
}: {
  slug: string;
  postureCounts: Record<string, number>;
  search: string;
}) {
  const total = Math.max(1, POSTURE_ORDER.reduce((sum, p) => sum + (postureCounts[p] ?? 0), 0));
  const pct = (n: number) => Math.round((n / total) * 100);
  return (
    <>
      <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-slate-800">
        {POSTURE_ORDER.map((p) => {
          const n = postureCounts[p] ?? 0;
          if (n === 0) return null;
          return (
            <Link
              key={p}
              href={postureHref(slug, p, search)}
              className="h-full transition-all hover:opacity-80"
              style={{ width: `${(n / total) * 100}%`, backgroundColor: POSTURE_HEX[p] ?? "#64748b" }}
              title={`View the ${n} ${postureLabel(p)} repo${n === 1 ? "" : "s"} (${pct(n)}%)`}
              aria-label={`View the ${n} ${postureLabel(p)} repositories`}
            />
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
        {POSTURE_ORDER.map((p) => {
          const n = postureCounts[p] ?? 0;
          const chip = (
            <>
              <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: POSTURE_HEX[p] ?? "#64748b", opacity: n === 0 ? 0.35 : 1 }} />
              {postureLabel(p)} <span className="tabular-nums text-slate-500">{n}</span>
            </>
          );
          return n > 0 ? (
            <Link
              key={p}
              href={postureHref(slug, p, search)}
              title={`View the ${n} ${postureLabel(p)} repo${n === 1 ? "" : "s"}`}
              className="focus-ring inline-flex items-center gap-1.5 rounded font-mono text-sm text-slate-400 transition hover:text-accent"
            >
              {chip}
            </Link>
          ) : (
            <span key={p} className="inline-flex items-center gap-1.5 font-mono text-sm text-slate-600">{chip}</span>
          );
        })}
      </div>
    </>
  );
}
