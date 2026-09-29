// v2 posture composition: one hairline-scale bar of true shares (each non-empty segment a deep link to the
// Repositories tab filtered to that posture) and a legend of counts. Posture colours are status-like and keep
// their meaning; the only change from the Altimeter bar is the shape (a 2px-radius rule, not a pill).
import Link from "next/link";
import { Eyebrow, Frame } from "@/components/kit";
import { postureLabel } from "@/components/org/shared/ui";
import { POSTURE_HEX } from "@/components/org/shared/liveWarRoomShared";
import { postureHref } from "./PostureCompositionBar";
import { postureShares } from "./postureModel";

export function PostureLine({ slug, postureCounts, search }: { slug: string; postureCounts: Record<string, number>; search: string }) {
  const { shares, scored } = postureShares(postureCounts);
  return (
    <Frame pad="sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <Eyebrow>Posture</Eyebrow>
        <span className="type-caption text-slate-400">{scored} scored</span>
      </div>
      <div className="mt-3 flex h-2 gap-px overflow-hidden rounded-[2px] bg-white/10" data-role="posture-bar">
        {shares.map(({ posture: p, n, share, pct }) =>
          n === 0 ? null : (
            <Link
              key={p}
              href={postureHref(slug, p, search)}
              className="h-full transition-opacity hover:opacity-80"
              style={{ width: `${share * 100}%`, backgroundColor: POSTURE_HEX[p] ?? "var(--color-slate-500)" }}
              title={`View the ${n} ${postureLabel(p)} repo${n === 1 ? "" : "s"} (${pct}%)`}
              aria-label={`View the ${n} ${postureLabel(p)} repositories`}
            />
          ),
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1">
        {shares.map(({ posture: p, n }) => {
          const chip = (
            <>
              <span aria-hidden className="h-2 w-2 rounded-[1px]" style={{ backgroundColor: POSTURE_HEX[p] ?? "var(--color-slate-500)", opacity: n === 0 ? 0.35 : 1 }} />
              {postureLabel(p)} <span className="tabular-nums text-slate-400">{n}</span>
            </>
          );
          return n > 0 ? (
            <Link key={p} href={postureHref(slug, p, search)} title={`View the ${n} ${postureLabel(p)} repo${n === 1 ? "" : "s"}`} className="focus-ring inline-flex items-center gap-2 rounded type-body-sm text-slate-200 transition hover:text-white">
              {chip}
            </Link>
          ) : (
            <span key={p} className="inline-flex items-center gap-2 type-body-sm text-slate-500">
              {chip}
            </span>
          );
        })}
      </div>
    </Frame>
  );
}
