"use client";

// The register: a ranked table of the most AI-native public repositories, read from the same persisted
// scans the old landing deck showed (`getPublicScanGallery`). Only rendered when the page has a gallery.
//
// THERE IS NO EMPTY STATE HERE, and that is the decision, not an omission. `loadPublicGalleryCards`
// returns `null` the moment it has zero cards (scans-read.ts) and the landing then drops the whole
// section, so an empty corpus shows no register at all (UAT RC2-N3). `scans-gallery.test.ts` pins the
// null return and that this file carries no worded empty state.

import Link from "next/link";
import { useState } from "react";
import type { PublicScanGallery } from "@/lib/db";
import { dbModeLabel } from "@/lib/db/mode";
import type { DimensionId } from "@/lib/types";
import { SCORING_RUBRIC_VERSION } from "@/lib/maturity/model";
import { scoreHex, timeAgo, DIMENSION_SHORT } from "@/lib/ui";
import { RegisterChips } from "@/components/landing/RegisterChips";
import { PrismScanLink } from "./PrismScanLink";
import { registerLens, type RegisterLens } from "./registerLensModel";
import { LensNotes, MoveMarker, RegisterLensSwitch } from "./PrismRegisterLens";

// The five headline dimensions surfaced as columns (AI Tooling, Testing, CI/CD, Agentic, AI Process);
// the last column is the overall score.
const FEATURED_DIMS: DimensionId[] = ["D1", "D2", "D3", "D4", "D8"];

function Score({ score, big = false, hide = false }: { score?: number; big?: boolean; hide?: boolean }) {
  const cls = `rg-s${big ? " big" : ""}${hide ? " dim" : ""}`;
  if (score == null) return <span className={cls}>&mdash;</span>;
  return <span className={cls} style={{ color: scoreHex(score) }}>{score}</span>;
}

export function PrismRegister({ gallery, scanHref }: { gallery: PublicScanGallery; scanHref: string }) {
  const { recent, topAiNative, totalRepos, dbMode } = gallery;
  // RANKED (score order) only when the leaderboard query returned rows; otherwise recency order, and the
  // UI says so: rank badges become a neutral "·" and the eyebrow reads "Latest public scans". topAiNative
  // holds VERIFIED cards only, so a mock floor reaches this board only through the recency fallback,
  // un-numbered and chipped `demo`.
  const ranked = topAiNative.length > 0;
  const board = ranked ? topAiNative : recent;
  const [lensChoice, setLensChoice] = useState<RegisterLens>("as-scored");
  const view = registerLens(board, lensChoice, { ranked });
  const latestScannedAt = recent[0]?.scannedAt;
  // Counted over the board ACTUALLY RENDERED: the note says "on this page", so it is about these rows.
  const staleRubric = board.filter((c) => c.verified && !c.currentRubric).length;

  return (
    <section id="register" className="sec" aria-labelledby="registerTitle">
      <div className="frame">
        <div className="sec-head">
          <p className="eyebrow"><span className="sw"></span>{ranked ? "Live from the index" : "Latest public scans"}</p>
          <h2 id="registerTitle">The register</h2>
          {/* A count is a claim; zero is not one worth making (UAT TOMAS-L1-05). */}
          {totalRepos > 0 && <p className="note rg-count">{totalRepos} public {totalRepos === 1 ? "repo" : "repos"} rated</p>}
          <p className="note rg-prov" title={`This register is served live from ${dbModeLabel(dbMode)}.`}>
            Served live from {dbModeLabel(dbMode)}
            {latestScannedAt ? <> · as of {timeAgo(latestScannedAt)}</> : null}
          </p>
        </div>

        {view.offered && <RegisterLensSwitch lens={view.lens} onChange={setLensChoice} lensesOnBoard={view.lensesOnBoard} />}

        <div className="rg-head" aria-hidden="true">
          <span />
          <span>Repository</span>
          {FEATURED_DIMS.map((d) => <span key={d} className="rg-s dim" title={DIMENSION_SHORT[d]}>{DIMENSION_SHORT[d]}</span>)}
          <span className="rg-s">Avg</span>
        </div>

        <div className="rg-rows">
          {view.rows.map(({ card: c, score, levelName, rank, move }) => (
            <Link key={c.fullName} href={c.href} className="rg-row">
              <span className="rg-rank">{ranked ? String(rank).padStart(2, "0") : "·"}</span>
              <span className="rg-name">
                <b title={c.fullName}>{c.fullName}</b>
                <span>
                  {levelName} · {timeAgo(c.scannedAt)}
                  <MoveMarker move={move} />
                  <RegisterChips row={c} />
                </span>
              </span>
              {FEATURED_DIMS.map((d) => <Score key={d} score={c.dimensions[d]} hide />)}
              <Score score={score} big />
            </Link>
          ))}
        </div>

        <LensNotes lens={view.lens} withheld={view.withheld} />

        {/* A rank is a claim that the rows share a ruler. When they do not, the register says so under the
            board (the disclosure /leaderboard carries, MC-B18/MC-B42). Silent on a single-rubric board. */}
        {staleRubric > 0 && (
          <p className="note rg-note">
            <b>Mixed rubrics on this page.</b> {staleRubric} of these {board.length} rows {staleRubric === 1 ? "was" : "were"} scored
            under an earlier rubric than the current <span className="mono">{SCORING_RUBRIC_VERSION}</span>, and carry a rubric
            qualifier. A rubric change alters what some dimensions measure, so those numbers are not strictly comparable with
            freshly scored ones; a re-scan puts a repo back on the current ruler.
          </p>
        )}

        {/* Growth loop: /leaderboard is the crawlable ranking of the same corpus (the landing board is a capped slice). */}
        <div className="rg-foot">
          <Link className="btn ghost" href="/leaderboard">The full register</Link>
          <span>Want your repo on the register?</span>
          <PrismScanLink className="btn ghost" href={scanHref}>Scan your repo</PrismScanLink>
        </div>
      </div>
    </section>
  );
}
