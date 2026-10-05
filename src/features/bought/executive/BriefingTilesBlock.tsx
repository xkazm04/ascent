// The briefing's four headline tiles, extracted from briefingCards.tsx (200-LOC cap under
// src/features/**) when the delta gained its basis caption. Pure relocation of the component plus the
// new `movement` prop; briefingCards.tsx re-exports it, so no call site moved.
//
// Rendered by BOTH the authenticated executive page and the session-less public share page: every
// optional prop defaults to OFF so rendering with none gives exactly the anonymous board view (see
// briefingCards.tsx's header for the full prop contract).

import { Tile, TILE_GRID } from "@/components/org/shared/ui";
import { scoreHex } from "@/lib/ui";
import { benchmarkCaption, type ExecBriefing } from "@/lib/org/briefing";
import { BriefingDeltaCaption } from "./BriefingDeltaCaption";

/**
 * The four headline tiles (maturity, adoption, rigor, corpus percentile).
 *
 * `orgSlug` is the link switch: pass it and each tile becomes a deep link to the tab that explains it
 * (the exec page's behavior); leave it null and the tiles are static cells — the public share page must
 * not lead a board member into the authenticated app. `deltaLabel` is likewise exec-only (the share
 * page renders the delta badge with no "vs …" suffix, matching its frozen-window framing).
 */
export function BriefingTiles({
  maturity,
  benchmark,
  delta,
  deltaLabel,
  movement = null,
  realScoredCount,
  orgSlug = null,
  className = "",
}: {
  maturity: ExecBriefing["maturity"];
  benchmark: ExecBriefing["benchmark"];
  delta?: number | null;
  /** Exec-only suffix next to the delta badge, e.g. "vs 90d ago". */
  deltaLabel?: string;
  /**
   * The delta's cohort (`ExecBriefing.periodMovement`): the matched denominator it was measured over
   * and the composition change the matching excluded. Rendered as the caption under the grid, by the
   * same composer the PDF, the markdown and the share page read.
   *
   * Optional and public-safe (it carries counts, never identifiers), but a delta WITHOUT it renders
   * uncaptioned — which is the state this prop exists to end, so both real call sites pass it.
   */
  movement?: ExecBriefing["periodMovement"];
  /**
   * The LIVE-SCORED denominator behind the three maturity averages (`ExecBriefing.realScoredCount`).
   *
   * 0 ⇒ those averages are a division guard, not a grade (`getOrgRollup` states the contract on
   * `avgOverall`), so the three tiles render "—" and the level caption is suppressed rather than
   * printing "0 · L1 Ad hoc" for a fleet that has never been measured. Optional for
   * fixture-compatibility (the `BriefingMove.fullName` precedent); both real call sites pass it, and
   * absent is read as "scored", which is what every briefing did before the field existed.
   */
  realScoredCount?: number;
  /** Non-null ⇒ tiles deep-link into the org dashboard. Null (the default) ⇒ static, public-safe. */
  orgSlug?: string | null;
  className?: string;
}) {
  const scored = realScoredCount == null || realScoredCount > 0;
  /** The figure, or an em dash when there is no denominator to have averaged it over. */
  const score = (n: number) => (scored ? n : "—");
  return (
    <div className={className}>
      <div className={TILE_GRID}>
        <Tile
          label="Org maturity"
          value={score(maturity.overall)}
          sub={scored ? `${maturity.levelId} · ${maturity.levelName}` : "no live-scored repositories"}
          color={scored ? scoreHex(maturity.overall) : undefined}
          delta={scored ? (delta ?? undefined) : undefined}
          deltaLabel={scored ? deltaLabel : undefined}
          href={orgSlug ? `/org/${orgSlug}` : undefined}
        />
        <Tile
          label="AI Adoption"
          value={score(maturity.adoption)}
          color={scored ? scoreHex(maturity.adoption) : undefined}
          href={orgSlug ? `/org/${orgSlug}/adoption` : undefined}
        />
        <Tile
          label="Engineering Rigor"
          value={score(maturity.rigor)}
          color={scored ? scoreHex(maturity.rigor) : undefined}
          href={orgSlug ? `/org/${orgSlug}/delivery` : undefined}
        />
        {/* Direction 2 — the caption comes from the ONE composer (G12). This slot hand-rolled
            "vs {corpusRepos} repos", so a SUPPRESSED percentile over a 1-repo corpus rendered
            "— / vs 1 repos" in a headline slot with the org's name above it: the exact copy UAT
            DANA-L1-011 rejected. That finding was marked resolved after the PDF was fixed and
            inspected; the HTML tile it also described was never looked at. */}
        <Tile
          label="Corpus percentile"
          value={benchmark?.percentile != null ? `${benchmark.percentile}` : "—"}
          sub={benchmarkCaption(benchmark)}
          color={benchmark?.percentile != null ? scoreHex(benchmark.percentile) : undefined}
          href={orgSlug ? "/leaderboard" : undefined}
        />
      </div>
      {/* The delta's basis, under the grid rather than inside the tile: it qualifies ONE of the four
          figures and is a sentence, not a cell. Absent (no cohort) exactly when the badge is. */}
      {scored && <BriefingDeltaCaption delta={delta} movement={movement} className="mt-2" />}
    </div>
  );
}
