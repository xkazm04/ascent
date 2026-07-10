import Link from "next/link";
import { Card, SectionHeader, Meter, postureLabel, POSTURE_ORDER } from "@/components/org/shared/ui";
import { POSTURE_HEX } from "@/components/org/shared/liveWarRoomShared";
import { DIMENSION_SHORT, scoreHex } from "@/lib/ui";
import { PRACTICES } from "@/lib/practices";

// The Overview "Posture & dimensions" section as ONE panel instead of two side-by-side cards:
//  - posture as a single stacked composition bar (true shares of the scored fleet) + a legend of
//    count chips — replacing five meter rows that spent a card's height on four numbers;
//  - dimension averages as a multi-column grid of compact rows, each deep-linking to that
//    dimension's practice card (`#practice-<id>` — exemplar · gap repos · reusable shape · apply),
//    so a weak fleet average is one click from "how to lift it" instead of a dead-end bar.
// The 1:1 dimension→practice map is the same one the Plan tab uses to seed initiatives (PRACTICES);
// the posture palette is the canonical POSTURE_HEX the Live war room renders with.
const PRACTICE_BY_DIM = new Map(PRACTICES.map((p) => [p.dimId as string, p.id]));

export function PostureDimensionsPanel({
  slug,
  postureCounts,
  dims,
  dimDeltas,
  deltaLabel,
}: {
  slug: string;
  postureCounts: Record<string, number>;
  dims: { dimId: string; avg: number }[];
  /** Cohort-matched per-dimension movement over the active window (rollup.dimDeltas); null hides deltas. */
  dimDeltas?: { dimId: string; delta: number }[] | null;
  /** Comparison suffix for the delta tooltips, e.g. "vs 90d ago". */
  deltaLabel?: string;
}) {
  const total = Math.max(1, POSTURE_ORDER.reduce((sum, p) => sum + (postureCounts[p] ?? 0), 0));
  const pct = (n: number) => Math.round((n / total) * 100);
  const deltaByDim = new Map((dimDeltas ?? []).map((d) => [d.dimId, d.delta]));

  return (
    <Card>
      {/* Posture composition — one bar, true shares (not normalized to the leading bucket).
          GA: every non-empty segment and legend chip opens the Repositories tab filtered to that
          posture, so "who exactly is Fast & Ungoverned?" is one click, not a mental cross-reference. */}
      <SectionHeader size="sm" title="Posture distribution" right={<span className="font-mono text-sm text-slate-500">{total} scored</span>} />
      <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-slate-800">
        {POSTURE_ORDER.map((p) => {
          const n = postureCounts[p] ?? 0;
          if (n === 0) return null;
          return (
            <Link
              key={p}
              href={`/org/${slug}/repositories?posture=${p}`}
              className="h-full transition-all hover:opacity-80"
              style={{ width: `${(n / total) * 100}%`, backgroundColor: POSTURE_HEX[p] ?? "#64748b" }}
              title={`${postureLabel(p)} — ${n} repo${n === 1 ? "" : "s"} (${pct(n)}%) — view them`}
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
              href={`/org/${slug}/repositories?posture=${p}`}
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

      {/* Dimension averages — compact link rows in a responsive grid, each → its practice card */}
      <div className="mt-4 border-t border-divider pt-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-semibold uppercase tracking-wide text-slate-500">Dimension averages</span>
          <Link href={`/org/${slug}/practices`} className="font-mono text-sm text-slate-500 transition hover:text-accent">
            → practices
          </Link>
        </div>
        <div className="mt-2 grid gap-x-8 gap-y-1.5 sm:grid-cols-2 xl:grid-cols-3">
          {dims.map((d) => {
            const short = DIMENSION_SHORT[d.dimId as keyof typeof DIMENSION_SHORT] ?? d.dimId;
            const practiceId = PRACTICE_BY_DIM.get(d.dimId);
            // GC: cohort-matched movement per dimension (only when the window has a baseline) — the
            // grid answers "is it improving?" per row, not just "where is it now?".
            const delta = deltaByDim.get(d.dimId) ?? 0;
            const body = (
              <>
                <span className="w-20 shrink-0 text-slate-400 group-hover:text-accent">{short}</span>
                <Meter className="flex-1" value={d.avg} color={scoreHex(d.avg)} />
                <span className="w-7 text-right font-mono tabular-nums" style={{ color: scoreHex(d.avg) }}>
                  {d.avg}
                </span>
                {dimDeltas != null && (
                  <span
                    className={`w-8 shrink-0 text-right font-mono text-xs tabular-nums ${delta > 0 ? "text-emerald-400" : delta < 0 ? "text-red-400" : "text-slate-600"}`}
                    title={delta !== 0 && deltaLabel ? `${delta > 0 ? "+" : ""}${delta} ${deltaLabel}` : undefined}
                  >
                    {delta > 0 ? `▲${delta}` : delta < 0 ? `▼${Math.abs(delta)}` : "·"}
                  </span>
                )}
              </>
            );
            // Two side-by-side affordances per row (can't nest <a>): the label/meter → the practice
            // that lifts this dimension; a trailing "▦" → the Repositories heatmap pre-sorted on it.
            // Fall back to a non-link body when the catalog lacks a practice — never a dead href.
            return (
              <div key={d.dimId} className="-mx-1 flex items-center gap-2 px-1 py-0.5 text-sm">
                {practiceId ? (
                  <Link
                    href={`/org/${slug}/practices#practice-${practiceId}`}
                    title={`See the ${short} practice — exemplar, gap repos, and how to lift this dimension`}
                    className="focus-ring group flex flex-1 items-center gap-3 rounded-md transition hover:bg-slate-800/40"
                  >
                    {body}
                  </Link>
                ) : (
                  <div className="flex flex-1 items-center gap-3">{body}</div>
                )}
                <Link
                  href={`/org/${slug}/repositories?dim=${d.dimId}#heatmap`}
                  title={`See ${short} across every repo in the heatmap`}
                  aria-label={`See ${short} across every repo`}
                  className="focus-ring shrink-0 rounded px-1 font-mono text-xs text-slate-600 transition hover:text-accent"
                >
                  ▦
                </Link>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
