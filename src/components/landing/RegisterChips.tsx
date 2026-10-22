// The provenance qualifier chips both public rankings draw: the landing register (IndexGallery) and
// /leaderboard (LeaderboardTable). Two surfaces ranking the same corpus must say the same thing in the
// same words (MC-B42), so the chips live here once instead of as two hand copies (card portfolio-0).
//
//  - `demo`: the score came from the deterministic mock rubric. Not a rating, never ranked.
//  - `rubric rNN` / `rubric unknown`: a real rating taken on an earlier (or unrecorded) ruler. Qualified,
//    never de-ranked.
//
// Presentational only (no hooks, no handlers), so it carries no "use client" and renders in either a
// server table or the client landing deck.

import { SCORING_RUBRIC_VERSION } from "@/lib/maturity/model";

const CHIP = "ml-2 rounded border px-1.5 py-0.5 type-micro";

export const DEMO_CHIP_TITLE = "Scored by the deterministic preview rubric. No model contributed. Not ranked.";

/** The provenance chip for a mock-engine score. */
export function DemoChip({ className = "" }: { className?: string }) {
  return (
    <span className={`${CHIP} border-amber-500/40 text-amber-300/90 ${className}`} title={DEMO_CHIP_TITLE}>
      demo
    </span>
  );
}

/** The provenance chip for a score taken on an earlier or unrecorded rubric. */
export function RubricChip({ rubricVersion, className = "" }: { rubricVersion: string | null; className?: string }) {
  return (
    <span
      className={`${CHIP} border-violet-500/40 text-violet-300/90 ${className}`}
      title={
        rubricVersion
          ? `Scored under rubric ${rubricVersion}; the current rubric is ${SCORING_RUBRIC_VERSION}. The rubric changed what some dimensions measure, so this row's number is not strictly comparable with a freshly scored one. Re-scanning the repo puts it on the current ruler.`
          : `This scan predates the rubric stamp, so which ruler produced it is unknown, and unknown is not the current one (${SCORING_RUBRIC_VERSION}). Re-scanning the repo puts it on the current ruler.`
      }
    >
      {rubricVersion ? `rubric ${rubricVersion}` : "rubric unknown"}
    </span>
  );
}

/** The register row's provenance: `demo` for a mock score (which outranks every other qualifier), else
 *  the rubric chip when the row is off the current ruler, else nothing. */
export function RegisterChips({
  row,
  className = "",
}: {
  row: { verified: boolean; currentRubric: boolean; rubricVersion: string | null };
  className?: string;
}) {
  if (!row.verified) return <DemoChip className={className} />;
  if (!row.currentRubric) return <RubricChip rubricVersion={row.rubricVersion} className={className} />;
  return null;
}
