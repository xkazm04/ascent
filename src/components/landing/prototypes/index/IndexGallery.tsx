"use client";

// Live discovery for The Index — a ranked editorial register of the most AI-native repos. Each row
// breaks the score into five headline dimensions plus the overall average, so the register reads as a
// rating table rather than a single number. Only rendered when persisted public scans exist.
//
// THERE IS NO EMPTY STATE HERE, and that is the decision, not an omission. `loadPublicGalleryCards`
// returns `null` the moment it has zero cards (`scans-read.ts`), and `IndexVariant` then drops the
// whole section — so an empty corpus shows no register at all, which is what a truly empty deployment
// was observed to do (UAT `RC2-N3`). This file used to ALSO carry a worded `board.length === 0` state
// inviting the reader to be the first on the register; non-null implies at least one card implies a
// non-empty board, so that branch was dead in the exact case it was written for, and two
// behaviours were declared for one
// state. The absent section won: a heading and column labels wrapped around a sentence is the
// "broken table" the worded state was itself trying to avoid. If the null return ever goes, the
// register needs the worded state back — `scans-gallery.test.ts` pins that contract.

import Link from "next/link";
import type { PublicRepoCard, PublicScanGallery } from "@/lib/db";
import { dbModeLabel } from "@/lib/db/mode";
import type { DimensionId } from "@/lib/types";
import { SCORING_RUBRIC_VERSION } from "@/lib/maturity/model";
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

/** The provenance chip for a row scored on an earlier ruler. Same derivation, same vocabulary and same
 *  tone as the one MC-B18 put on the /leaderboard register (`LeaderboardTable.tsx`) — this is the
 *  SECOND public ranking over the same corpus, and two surfaces disagreeing about what a stale rubric
 *  is called would be worse than neither saying it (MC-B42). Qualified, never de-ranked. */
function RubricChip({ card }: { card: PublicRepoCard }) {
  if (card.currentRubric) return null;
  return (
    <span
      className="ml-2 rounded border border-violet-500/40 px-1.5 py-0.5 type-micro normal-case tracking-normal text-violet-300/90"
      title={
        card.rubricVersion
          ? `Scored under rubric ${card.rubricVersion}; the current rubric is ${SCORING_RUBRIC_VERSION}. The rubric changed what some dimensions measure, so this row's number is not strictly comparable with a freshly scored one. Re-scanning the repo puts it on the current ruler.`
          : `This scan predates the rubric stamp, so which ruler produced it is unknown — and unknown is not the current one (${SCORING_RUBRIC_VERSION}). Re-scanning the repo puts it on the current ruler.`
      }
    >
      {card.rubricVersion ? `rubric ${card.rubricVersion}` : "rubric unknown"}
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
  // Counted over the board ACTUALLY RENDERED (ranked or recency), never over the whole corpus: the note
  // says "on this page", so it has to be about the rows on this page.
  const staleRubric = board.filter((c) => !c.currentRubric).length;
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
                <RubricChip card={c} />
              </span>
            </span>
            {FEATURED_DIMS.map((d) => (
              <ScoreCell key={d} score={c.dimensions[d]} className="hidden md:block" />
            ))}
            <ScoreCell score={c.overall} big />
          </Link>
        ))}
      </div>

      {/* A rank is a claim that the rows share a ruler. When they do not, the register says so under the
          board rather than leaving it to a per-row chip — the same disclosure /leaderboard carries
          (MC-B18), on the surface a landing visitor actually reaches first (MC-B42). Silent when the
          board is single-rubric: a disclosure with nothing to disclose is noise. */}
      {staleRubric > 0 && (
        <p className="mt-4 max-w-3xl type-body-sm leading-relaxed text-slate-500">
          <span className="text-slate-300">Mixed rubrics on this page.</span> {staleRubric} of these{" "}
          {board.length} rows {staleRubric === 1 ? "was" : "were"} scored under an earlier rubric than the
          current <span className="font-mono text-slate-400">{SCORING_RUBRIC_VERSION}</span>, and carry a{" "}
          <span className="text-violet-300/90">rubric</span> qualifier. A rubric change alters what some
          dimensions measure, so those numbers are not strictly comparable with freshly scored ones; a
          re-scan puts a repo back on the current ruler.
        </p>
      )}

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
