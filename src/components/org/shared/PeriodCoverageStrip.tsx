// The counted in-period strip (rollups-1). A period window splits the fleet: the average still
// counts a repo last scored before `start`, movers cannot see it. The old caveat said so in one
// fixed sentence that named no count and no repo, so the reader could not tell 0 from 30, nor
// which. This strip renders the split the rollup already holds (periodCoverageModel.ts): how many,
// the oldest, the list, and the one action that closes it (rescan the watched, unqueued ones).
//
// Server-safe: no hooks. The only client island is PeriodCoverageRescan.

import { periodCoverageCaption, type PeriodCoverage } from "@/lib/org/periodCoverageModel";
import { PeriodCoverageRescan } from "./PeriodCoverageRescan";

/** Carried repos named before the rest collapse into a count. */
const SHOWN = 12;

const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

function splitNote(c: PeriodCoverage): string | null {
  const parts: string[] = [];
  if (c.alreadyQueued > 0) parts.push(`${c.alreadyQueued} already queued`);
  if (c.notWatched > 0) parts.push(`${c.notWatched} not watched`);
  return parts.length ? `(${parts.join(", ")})` : null;
}

function Action({ slug, c }: { slug: string; c: PeriodCoverage }) {
  const a = c.action;
  const note = splitNote(c);
  if (a.state === "rescan") {
    return (
      <span className="flex flex-wrap items-start gap-2">
        <PeriodCoverageRescan slug={slug} repos={c.rescanSet} />
        {note && <span className="type-caption text-slate-500">{note}</span>}
      </span>
    );
  }
  if (a.state === "queued") {
    return (
      <span className="type-caption text-slate-400">
        {a.count} {a.count === 1 ? "rescan" : "rescans"} already queued
        {c.notWatched > 0 ? ` (${c.notWatched} not watched)` : ""}
      </span>
    );
  }
  if (a.state === "unwatched") {
    return (
      <span className="type-caption text-slate-400">
        {a.count} not watched: watch {a.count === 1 ? "it" : "them"} in Repositories to rescan
      </span>
    );
  }
  return null;
}

export function PeriodCoverageStrip({ slug, coverage }: { slug: string; coverage: PeriodCoverage | null }) {
  const caption = coverage ? periodCoverageCaption(coverage) : null;
  const oldest = coverage?.carried[0];
  if (!coverage || !caption || !oldest) return null;
  const rest = coverage.carried.length - SHOWN;
  return (
    <section
      aria-label="Period coverage"
      data-testid="period-coverage-strip"
      className="mb-4 flex flex-col gap-2 rounded-lg border border-slate-800 px-3 py-2"
    >
      <p className="type-body-sm text-slate-300" role="note">
        {caption}
      </p>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <details className="type-caption text-slate-500">
          <summary className="focus-ring cursor-pointer">
            Carried repos (oldest: {oldest.name}, {days(oldest.ageDays)})
          </summary>
          <ul className="mt-1 flex flex-col gap-0.5 font-mono">
            {coverage.carried.slice(0, SHOWN).map((r) => (
              <li key={r.fullName}>
                {r.fullName}: {days(r.ageDays)}
                {r.queued ? ", rescan queued" : ""}
                {r.watched ? "" : ", not watched"}
              </li>
            ))}
            {rest > 0 && <li>and {rest} more</li>}
          </ul>
        </details>
        <Action slug={slug} c={coverage} />
      </div>
    </section>
  );
}
