// Shared briefing UI blocks rendered identically by the authenticated executive page
// (/org/[slug]/executive) and the session-less public share page (/share/briefing/[token]). The share
// page was assembled by copy-pasting render blocks out of the executive page, so the dimension row and
// the "vs previous period" comparison grid lived inline in both — and the share grid had drifted,
// hand-rolling delta color/sign instead of the canonical deltaHex/fmtDelta. Extracting them here
// single-sources both and corrects the share view to the canonical delta presentation.

import Link from "next/link";
import { Meter, deltaHex, fmtDelta, DIRECTION_TONE } from "@/components/org/ui";
import { scoreHex } from "@/lib/ui";
import { PRACTICES } from "@/lib/practices";

// The 1:1 dimension→practice map (same source the Overview panel and Plan tab use), so briefing
// dimension rows can deep-link to the practice that lifts them.
const PRACTICE_BY_DIM = new Map(PRACTICES.map((p) => [p.dimId as string, p.id]));

/** Practices deep-link for a dimension, or undefined when the catalog lacks one (never a dead href). */
export function practiceHref(slug: string, dimId: string): string | undefined {
  const practiceId = PRACTICE_BY_DIM.get(dimId);
  return practiceId ? `/org/${slug}/practices#practice-${practiceId}` : undefined;
}

/** One dimension row: id · label, a score Meter, and the right-aligned numeric readout. With `href`
 *  the row becomes a link (the exec page points each dimension at its practice card); the share page
 *  passes none and keeps the static row — a read-only board link shouldn't lead into the app. */
export function DimRow({ dimId, label, avg, href }: { dimId: string; label: string; avg: number; href?: string }) {
  const body = (
    <>
      <span className="w-24 shrink-0 text-slate-400 group-hover:text-accent">{dimId} · {label}</span>
      <Meter className="flex-1" value={avg} color={scoreHex(avg)} />
      <span className="w-7 text-right font-mono tabular-nums" style={{ color: scoreHex(avg) }}>{avg}</span>
    </>
  );
  return href ? (
    <Link
      href={href}
      title={`See the ${label} practice — exemplar, gap repos, and how to lift this dimension`}
      className="focus-ring group -mx-1 flex items-center gap-3 rounded-md px-1 py-0.5 text-sm transition hover:bg-slate-800/40"
    >
      {body}
    </Link>
  ) : (
    <div className="flex items-center gap-3 text-sm">{body}</div>
  );
}

/** One "Movement this period" row: repo name (a report link when `fullName` is known), the level
 *  pair when it changed, and the signed score move. Exec-page block; the share page renders no
 *  movement list, so the link surface stays inside the authenticated app. */
export function MoveRow({
  tone,
  name,
  fullName,
  d,
  from,
  to,
}: {
  tone: "up" | "down";
  name: string;
  fullName?: string;
  d: number;
  from: string;
  to: string;
}) {
  const { arrow, color } = DIRECTION_TONE[tone === "up" ? "rising" : "falling"];
  return (
    <div className="flex items-center justify-between gap-3 text-base">
      {/* GA: a mover is a lead — open its stored report to see WHAT moved (older briefings without
          fullName keep the static row). */}
      {fullName ? (
        <Link
          href={`/report/${fullName}`}
          title={`Open ${fullName}'s report`}
          className="focus-ring min-w-0 truncate font-mono text-sm text-slate-200 transition hover:text-accent"
        >
          {name}
        </Link>
      ) : (
        <span className="min-w-0 truncate font-mono text-sm text-slate-200">{name}</span>
      )}
      <span className="flex shrink-0 items-center gap-2 font-mono text-sm">
        {from !== to && <span className="text-slate-500">{from}→{to}</span>}
        <span style={{ color }}>
          {arrow} {Math.abs(d)}
        </span>
      </span>
    </div>
  );
}

type PriorPeriod = {
  overall: number;
  adoption: number;
  rigor: number;
  dOverall: number;
  dAdoption: number;
  dRigor: number;
  dims: { dimId: string; label: string; now: number; prior: number; delta: number }[];
};

/**
 * The "vs previous period" comparison grid: a 3-cell headline (Overall/Adoption/Rigor) showing the
 * current score, its prior value, and the signed delta through the canonical deltaHex/fmtDelta helpers.
 * With `showDimensions`, appends the per-dimension now→prior breakdown the exec page wants (the share
 * page omits it).
 */
export function PriorPeriodGrid({
  prior,
  now,
  showDimensions = false,
}: {
  prior: PriorPeriod;
  now: { overall: number; adoption: number; rigor: number };
  showDimensions?: boolean;
}) {
  return (
    <>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {([
          ["Overall", prior.overall, now.overall, prior.dOverall],
          ["Adoption", prior.adoption, now.adoption, prior.dAdoption],
          ["Rigor", prior.rigor, now.rigor, prior.dRigor],
        ] as const).map(([label, priorVal, nowVal, delta]) => (
          <div key={label} className="rounded-xl border border-slate-800 bg-slate-950/30 p-3">
            <div className="font-mono text-sm uppercase tracking-widest text-slate-500">{label}</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-mono text-2xl font-bold tabular-nums" style={{ color: scoreHex(nowVal) }}>{nowVal}</span>
              <span className="font-mono text-sm text-slate-500">from {priorVal}</span>
              <span className="font-mono text-sm" style={{ color: deltaHex(delta) }}>{fmtDelta(delta)}</span>
            </div>
          </div>
        ))}
      </div>
      {showDimensions && prior.dims.some((d) => d.delta !== 0) && (
        <div className="mt-3 space-y-1.5 border-t border-slate-800/70 pt-3">
          {prior.dims
            .filter((d) => d.delta !== 0)
            .map((d) => (
              <div key={d.dimId} className="flex items-center justify-between gap-3 font-mono text-sm">
                <span className="text-slate-400">{d.dimId} · {d.label}</span>
                <span>
                  <span className="text-slate-500">{d.prior} → </span>
                  <span style={{ color: scoreHex(d.now) }}>{d.now}</span>{" "}
                  <span style={{ color: deltaHex(d.delta) }}>{fmtDelta(d.delta)}</span>
                </span>
              </div>
            ))}
        </div>
      )}
    </>
  );
}
