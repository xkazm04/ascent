// THE DESK'S DATA CONTRACT — what the server load hands the client view, in one plain prop (contest
// live-fleet-rounds, the owner's fused winner, 2026-09-25).
//
// The desk is a fourth view of the Live tab (`?view=desk`), behind the view switch as a beta until it
// is battle proven. It reuses the Ledger's load whole (`ledger`), and adds the two reads the ledger does
// not make: every round at LANE grain (the flight log's verdict marks and the arm league) and the lessons
// waiting for review. Dependency-free types only, so client files may import this module.

import type { LedgerData, LoopRunChronicleEntry } from "../ledger/ledgerTypes";
import type { RoundLane } from "@/lib/db/loop-rounds";
import type { LoopLessonRow } from "@/lib/db/loop-lessons";

export type { LedgerData, LoopRunChronicleEntry, RoundLane, LoopLessonRow };

/** How many rounds the desk reads. The flight log draws all of them; the table pages them. */
export const DESK_ROUNDS = 100;

/** A desk read that could not complete — each section says "could not read" instead of drawing empty. */
export type DeskRead = "rounds" | "lanes" | "lessons";

export interface DeskData {
  /** The ledger's whole load: runner, active run, pending plans, directions, lessons kept, ahead counts. */
  ledger: LedgerData;
  /** Every round up to DESK_ROUNDS, newest first. Null = the read failed. */
  rounds: LoopRunChronicleEntry[] | null;
  /** The read was full: older rounds exist or may exist, and totals over it are lower bounds. */
  roundsHasMore: boolean;
  /** The lanes of `rounds`, lean. Null = the read failed. */
  lanes: RoundLane[] | null;
  /** Lessons a lane proposed that nobody has kept or discarded yet. Null = the read failed. */
  pendingLessons: LoopLessonRow[] | null;
  /** Repos with a local checkout — what a next round could dispatch into. */
  pairedRepos: string[];
  failed: DeskRead[];
}
