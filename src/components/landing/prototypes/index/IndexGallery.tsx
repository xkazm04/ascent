"use client";

// Live discovery for The Index — a ranked editorial register of the most AI-native repos. Each row
// breaks the score into five headline dimensions plus the overall average, so the register reads as a
// rating table rather than a single number. Only rendered when persisted public scans exist.

import Link from "next/link";
import type { PublicScanGallery } from "@/lib/db";
import { dbModeLabel } from "@/lib/db/mode";
import type { DimensionId } from "@/lib/types";
import { scoreHex, timeAgo, DIMENSION_SHORT } from "@/lib/ui";
import { Kicker } from "@/components/ui";

// The five headline dimensions surfaced as register columns — the highest-weighted signals in the
// rubric (AI Tooling, Testing, CI/CD, Agentic, AI Process). The sixth column is the overall average.
const FEATURED_DIMS: DimensionId[] = ["D1", "D2", "D3", "D4", "D8"];

// Shared 8-column track: rank · repo · 5 dimensions · average. The dimension columns collapse away
// below md (where they wouldn't fit) so the row falls back to rank · repo · average.
const GRID = "grid grid-cols-[1.75rem_minmax(0,1fr)_3.25rem] gap-x-3 md:grid-cols-[1.75rem_minmax(0,1fr)_repeat(5,2.75rem)_3.25rem]";

/** A single 0..100 score cell, colored by the rubric ramp; an em dash when the scan lacks it. */
function ScoreCell({ score, big = false, className = "" }: { score?: number; big?: boolean; className?: string }) {
  if (score == null) return <span className={`text-center font-mono text-sm text-slate-700 ${className}`}>—</span>;
  return (
    <span
      className={`text-center font-mono font-bold tabular-nums ${big ? "text-xl" : "text-sm"} ${className}`}
      style={{ color: scoreHex(score) }}
    >
      {score}
    </span>
  );
}

export function IndexGallery({ gallery }: { gallery: PublicScanGallery }) {
  const { recent, topAiNative, totalRepos, dbMode } = gallery;
  const board = topAiNative.length > 0 ? topAiNative : recent;
  const latestScannedAt = recent[0]?.scannedAt;
  return (
    <section id="gallery" className="flex min-h-screen snap-start flex-col justify-start pb-10 pt-14 lg:justify-center">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <Kicker>Live from the index</Kicker>
          <h2 className="mt-2 text-2xl font-bold text-white sm:text-3xl">The register</h2>
        </div>
        <div className="text-right">
          <span className="block font-mono text-xs uppercase tracking-[0.2em] text-slate-500">
            {totalRepos} public {totalRepos === 1 ? "repo" : "repos"} rated
          </span>
          {/* DB-backed provenance: surfaces the live persistence backend (Aurora DSQL in prod) so the
              AWS database in use is visible on the page, with the corpus freshness next to it. */}
          <span
            className="mt-1 block font-mono text-[10px] uppercase tracking-[0.2em] text-slate-600"
            title={`This register is served live from ${dbModeLabel(dbMode)}.`}
          >
            Served live from {dbModeLabel(dbMode)}
            {latestScannedAt ? <> · as of {timeAgo(latestScannedAt)}</> : null}
          </span>
        </div>
      </div>

      {/* Column header — aligned to the row track; dimension labels only show where their columns do. */}
      <div className={`${GRID} border-b border-slate-800/70 pb-2 pt-3 font-mono text-[10px] uppercase tracking-wider text-slate-500`}>
        <span aria-hidden />
        <span>Repository</span>
        {FEATURED_DIMS.map((d) => (
          <span key={d} className="hidden text-center leading-tight md:block" title={DIMENSION_SHORT[d]}>
            {DIMENSION_SHORT[d]}
          </span>
        ))}
        <span className="text-center text-slate-400">Avg</span>
      </div>

      <div className="divide-y divide-slate-800">
        {board.map((c, i) => (
          <Link
            key={c.fullName}
            href={c.href}
            className={`focus-ring group items-center py-4 transition ${GRID}`}
          >
            <span className="font-mono text-sm tabular-nums text-slate-600">{String(i + 1).padStart(2, "0")}</span>
            <span className="min-w-0">
              <span className="block truncate text-base font-semibold text-white group-hover:text-accent" title={c.fullName}>
                {c.fullName}
              </span>
              <span className="font-mono text-xs uppercase tracking-widest text-slate-500">
                {c.levelName} · {timeAgo(c.scannedAt)}
              </span>
            </span>
            {FEATURED_DIMS.map((d) => (
              <ScoreCell key={d} score={c.dimensions[d]} className="hidden md:block" />
            ))}
            <ScoreCell score={c.overall} big />
          </Link>
        ))}
      </div>

      {/* Growth loop: convert a register viewer into a scanned repo + a README badge embed (every embed
          links back with ?ref=badge, so a published badge feeds the funnel). */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4">
        <span className="text-sm text-slate-500">Want your repo on the register?</span>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/#hero"
            className="focus-ring inline-flex items-center gap-2 rounded-md border border-slate-700 px-3 py-1.5 font-mono text-xs uppercase tracking-widest text-slate-300 transition hover:border-accent hover:text-white"
          >
            <span aria-hidden>▸</span> Scan your repo
          </Link>
          <Link
            href="/badge"
            className="focus-ring inline-flex items-center gap-2 rounded-md border border-slate-700 px-3 py-1.5 font-mono text-xs uppercase tracking-widest text-slate-300 transition hover:border-accent hover:text-white"
          >
            <span aria-hidden>◆</span> Add a README badge
          </Link>
        </div>
      </div>
    </section>
  );
}
