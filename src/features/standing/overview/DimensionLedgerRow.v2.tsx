// One dimension as a spectral line: hue names the dimension (D-number), bar width is the fleet average, the tick
// is the green floor. Under it, the reading and the two named affordances (where a click goes is stated before
// the click). A dimension no repository scored is NOT JUDGED: an empty track and the words, never a bar.
import Link from "next/link";
import { DimensionLine, type DimensionId } from "@/components/kit";
import { StateSwatch, stateTitle } from "@/components/org/viz";
import { deltaHex } from "@/components/ui/format";
import { buildUrl, clearedTabScopedParams, orgTabHref } from "@/lib/org/orgTabs";
import type { DimensionReading } from "./dimensionReading";
import { GREEN_FLOOR } from "./phaseStanding";

const LINK = "focus-ring rounded text-slate-400 transition hover:text-white";
const shortLabel = (label: string) => label.replace(/\s*\(.*\)\s*$/, "");

export function DimensionLedgerRow({ r, slug, search }: { r: DimensionReading; slug: string; search: string }) {
  const judged = r.belowGreen.of > 0; // a dimension no scored repo carries is NOT JUDGED (the v1 ledger inferred this from an empty note, which misses a "strongest of N" reading)
  const heatHref = `${buildUrl(slug, { ...clearedTabScopedParams(), dim: r.dimId }, search)}#heatmap`;
  return (
    <DimensionLine
      dimension={Number(r.dimId.slice(1)) as DimensionId}
      label={r.short}
      value={judged ? r.avg / 100 : null}
      display={judged ? String(r.avg) : "not judged"}
      floor={GREEN_FLOOR / 100}
      wide
      detail={
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {judged ? (
            <>
              <span>{r.status}</span>
              <span className="min-w-0" title={r.note}>
                {r.note}
              </span>
            </>
          ) : (
            <span className="flex items-center gap-1.5" title={stateTitle("not-judged", r.short)}>
              <StateSwatch state="not-judged" size={11} />
              No repo scored this dimension
            </span>
          )}
          {r.delta === null ? (
            <span role="img" aria-label={`${r.short}: no movement measurement in this window`} title={stateTitle("missing", `${r.short} movement`)}>
              <StateSwatch state="missing" size={11} />
            </span>
          ) : (
            r.delta !== 0 && (
              <span className="tabular-nums" style={{ color: deltaHex(r.delta) }}>
                {r.delta > 0 ? "▲" : "▼"}
                {Math.abs(r.delta)}
              </span>
            )
          )}
          <span className="ml-auto flex flex-wrap items-center gap-x-4">
            {r.practice ? (
              <Link href={`${orgTabHref(slug, "practices")}#practice-${r.practice.id}`} className={LINK} title={`Open the practice that lifts ${r.short}: ${r.practice.label}`}>
                Practice: {shortLabel(r.practice.label)}
              </Link>
            ) : (
              <span>No practice yet</span>
            )}
            <Link href={heatHref} className={`${LINK} whitespace-nowrap`} title={`Jump to the matrix sorted weakest-first on ${r.short}`}>
              {r.belowGreen.of} repo{r.belowGreen.of === 1 ? "" : "s"} by score
            </Link>
          </span>
        </span>
      }
    />
  );
}
