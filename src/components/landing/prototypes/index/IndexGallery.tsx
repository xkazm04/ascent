"use client";

// Live discovery for The Index — a ranked editorial register of the most AI-native repos. Each row
// breaks the score into five headline dimensions plus the overall average, so the register reads as a
// rating table rather than a single number. Only rendered when persisted public scans exist.

import Link from "next/link";
import type { PublicScanGallery } from "@/lib/db";
import { dbModeLabel } from "@/lib/db/mode";
import type { DimensionId } from "@/lib/types";
import { scoreHex, timeAgo, DIMENSION_SHORT } from "@/lib/ui";
import { DeckSection } from "@/components/deck/DeckSection";
import { Kicker } from "@/components/ui";

// The five headline dimensions surfaced as register columns — the highest-weighted signals in the
// rubric (AI Tooling, Testing, CI/CD, Agentic, AI Process). The sixth column is the overall average.
const FEATURED_DIMS: DimensionId[] = ["D1", "D2", "D3", "D4", "D8"];

// Shared 8-column track: rank · repo · 5 dimensions · average. The dimension columns collapse away
// below md (where they wouldn't fit) so the row falls back to rank · repo · average.
const GRID = "grid grid-cols-[1.75rem_minmax(0,1fr)_3.25rem] gap-x-3 md:grid-cols-[1.75rem_minmax(0,1fr)_repeat(5,2.75rem)_3.25rem]";

/** A single 0..100 score cell, colored by the rubric ramp; an em dash when the scan lacks it. */
function ScoreCell({ score, big = false, className = "" }: { score?: number; big?: boolean; className?: string }) {
  if (score == null) return <span className={`text-center type-mono-sm text-slate-500 ${className}`}>—</span>;
  return (
    <span
      className={`text-center font-mono font-bold tabular-nums ${big ? "type-title" : "type-body-sm"} ${className}`}
      style={{ color: scoreHex(score) }}
    >
      {score}
    </span>
  );
}

export function IndexGallery({ gallery }: { gallery: PublicScanGallery }) {
  const { recent, topAiNative, totalRepos, dbMode } = gallery;
  // The board is RANKED (score order) only when the leaderboard query returned rows; otherwise it
  // falls back to recency order — and the UI must say so: rank badges become a neutral "·" and the
  // kicker swaps to "Latest public scans", so a recency list is never numbered 01… as if it were
  // the "most AI-native" ranking the surrounding copy promises.
  const ranked = topAiNative.length > 0;
  const board = ranked ? topAiNative : recent;
  const latestScannedAt = recent[0]?.scannedAt;
  return (
    <DeckSection id="gallery" justify="startLgCenter">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-divider pb-4">
        <div>
          <Kicker>{ranked ? "Live from the index" : "Latest public scans"}</Kicker>
          <h2 className="deck-h2 mt-2 type-heading font-bold text-white sm:type-display">The register</h2>
        </div>
        <div className="text-right">
          {/* A count is a claim; zero is not one worth making. UAT `TOMAS-L1-05`: on a configured-but-
              empty database this read "0 public repos rated" directly above the (good) explicit empty
              state, so a page whose proposition is "now it has an index" opened by counting nothing.
              The empty state below says it once, in words. */}
          {totalRepos > 0 && (
            <span className="block type-label tracking-[0.2em] text-slate-500">
              {totalRepos} public {totalRepos === 1 ? "repo" : "repos"} rated
            </span>
          )}
          {/* DB-backed provenance: surfaces the live persistence backend (Aurora DSQL in prod) so the
              AWS database in use is visible on the page, with the corpus freshness next to it. */}
          <span
            className={`${totalRepos > 0 ? "mt-1 " : ""}block font-mono type-micro uppercase tracking-[0.2em] text-slate-600`}
            title={`This register is served live from ${dbModeLabel(dbMode)}.`}
          >
            Served live from {dbModeLabel(dbMode)}
            {latestScannedAt ? <> · as of {timeAgo(latestScannedAt)}</> : null}
          </span>
        </div>
      </div>

      {/* Column header — aligned to the row track; dimension labels only show where their columns do. */}
      <div className={`${GRID} border-b border-divider/70 pb-2 pt-3 font-mono type-micro uppercase tracking-wider text-slate-500`}>
        <span aria-hidden />
        <span>Repository</span>
        {FEATURED_DIMS.map((d) => (
          <span key={d} className="hidden text-center leading-tight md:block" title={DIMENSION_SHORT[d]}>
            {DIMENSION_SHORT[d]}
          </span>
        ))}
        <span className="text-center text-slate-400">Avg</span>
      </div>

      {/* Explicit empty state: a persisted gallery with zero public scans previously rendered the
          full header + column labels around a bare zero-row list, which read as a broken table. */}
      {board.length === 0 && (
        <p className="py-10 text-center type-body-sm text-slate-500">
          No public scans yet. Scan a repository below to be the first on the register.
        </p>
      )}

      <div className="divide-y divide-divider">
        {board.map((c, i) => (
          <Link
            key={c.fullName}
            href={c.href}
            className={`focus-ring group items-center py-4 transition hover:bg-white/[0.02] ${GRID}`}
          >
            <span className="type-mono-sm tabular-nums text-slate-600">{ranked ? String(i + 1).padStart(2, "0") : "·"}</span>
            <span className="min-w-0">
              <span className="block truncate type-body font-semibold text-white group-hover:text-accent" title={c.fullName}>
                {c.fullName}
              </span>
              <span className="type-label tracking-widest text-slate-500">
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

      {/* Growth loop: convert a register viewer into a scanned repo. */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-divider pt-4">
        <span className="type-body-sm text-slate-500">Want your repo on the register?</span>
        <Link
          href="/?scan=1"
          className="focus-ring inline-flex items-center gap-2 rounded-md border border-slate-700 px-3 py-1.5 type-label tracking-widest text-slate-300 transition hover:border-accent hover:text-white"
        >
          <span aria-hidden>▸</span> Scan your repo
        </Link>
      </div>
    </DeckSection>
  );
}
