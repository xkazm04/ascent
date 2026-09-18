// The chronicle's arithmetic — pure. Stable run labels, the runner / drive / manual badge, the page
// cursor, and a lane's proposed → armed → delivered flow.

import type { FlowStage } from "@/components/org/viz/FlowRibbon";
import type { LoopLaneRecord } from "../cockpit/loopTypes";
import { fmtDay } from "./ledgerFormat";
import type { LoopRunChronicleEntry } from "./ledgerTypes";

/** Runs per chronicle page — the load reads the first, "Older runs" the rest. */
export const CHRONICLE_PAGE = 20;
export const LANE_LOG_TAIL = 40;

/** "#12" — the run's stable number; a run the backfill never numbered is labelled by its date. */
export const runLabel = (r: Pick<LoopRunChronicleEntry, "seq" | "startedAt">): string => (r.seq != null ? `#${r.seq}` : fmtDay(r.startedAt));

export type RunBadge = "runner" | "drive" | "manual";

/** Who dispatched the run: the standing runner, a bounded drive, or a person from the Cockpit. A drive
 *  id this load does not know (an old, pruned drive row) is still a drive — never guessed as manual. */
export function runBadge(r: Pick<LoopRunChronicleEntry, "driveId">, modes: Record<string, "bounded" | "continuous">): RunBadge {
  if (!r.driveId) return "manual";
  return modes[r.driveId] === "continuous" ? "runner" : "drive";
}

/** The cursor for "Older runs": the smallest stable number on screen. Null = nothing to page below. */
export function oldestSeq(runs: readonly Pick<LoopRunChronicleEntry, "seq">[]): number | null {
  const seqs = runs.map((r) => r.seq).filter((s): s is number => s != null);
  return seqs.length ? Math.min(...seqs) : null;
}

/** Merge a page into what is shown, keeping each run once, newest number first. */
export function appendPage(shown: readonly LoopRunChronicleEntry[], page: readonly LoopRunChronicleEntry[]): LoopRunChronicleEntry[] {
  const ids = new Set(shown.map((r) => r.id));
  return [...shown, ...page.filter((r) => !ids.has(r.id))];
}

export interface LaneFlow {
  stages: FlowStage[];
  /** The proposed stage's predicate — what `openBatch` passed over, by reason. */
  proposedTitle: string;
  landed: boolean;
}

/**
 * PROPOSED → ARMED → DELIVERED for one lane. Proposed = the batch as offered (`lane.proposed`), armed =
 * what was dispatched (`batchIds`), delivered = what the rescan VERIFIED closed (`closedIds`). A lane
 * written before `proposed` existed has no first stage — it draws as a break, never as zero.
 */
export function laneFlow(lane: Pick<LoopLaneRecord, "proposed" | "batchIds" | "closedIds" | "landedAt">): LaneFlow {
  const p = lane.proposed;
  const x = p?.excluded;
  const proposedTitle = p
    ? `Offered ${p.items.length}${p.curated ? " (hand-picked)" : ""}. Passed over: ${x?.deferred ?? 0} deferred, ${x?.heldByPlan ?? 0} held by a plan, ${x?.unmeasurable ?? 0} not measurable here, ${x?.heldByOtherWorker ?? 0} held by another worker.`
    : "This lane predates the record of what was offered — the proposed count is unknown, not zero.";
  const landed = lane.landedAt != null;
  return {
    stages: [
      { id: "proposed", label: "Proposed", value: p ? p.items.length : null },
      { id: "armed", label: "Armed", value: lane.batchIds.length },
      { id: "delivered", label: landed ? "Landed" : "Delivered", value: lane.closedIds.length },
    ],
    proposedTitle,
    landed,
  };
}

/** The lane log's last `n` lines — the bottom of the story is where the verdict is. */
export const logTail = (lane: Pick<LoopLaneRecord, "log">, n = LANE_LOG_TAIL): string[] => lane.log.slice(-n);
