// LOOP RUNS — durable persistence for the local-mode improvement loop (src/lib/local/loop-engine.ts).
//
// WHY THE DB IS THE SOURCE OF TRUTH. The autopilot this generalizes kept its whole state in a process
// Map, on the reasoning that the durable OUTPUT (commits, scans, closed rows) survives a restart even
// when the ticker does not. That holds for ONE repo and one operator watching one band. It stops
// holding for a fleet-wide run: with N lanes there is real per-lane bookkeeping — which batch went to
// which branch, which lane failed and why, which scan pair brackets its work — and none of it is
// reconstructible from the git history afterwards. So every phase transition and every log line is
// written HERE, and the in-memory registry in the engine holds only what genuinely cannot be
// serialized: live child-process handles and the cooperative stop flag.
//
// The corollary is markStaleRunsStopped: a `running` row whose live handles died with the process is
// a LIE, not a resumable job. Boot (or the first read after it) reconciles it to `stopped`.
//
// This file is the BARREL. The implementation is split three ways so no half outgrows a screenful:
// `-types` (shapes, constants, row→record parsing), `-write`, `-read`. Callers import from here.

export {
  LANE_LOG_LINES,
  LOOP_CONCURRENCY_CAP,
  LOOP_DEFAULT_CONCURRENCY,
  LOOP_MAX_CYCLES_CAP,
  boundLog,
  toLaneRecord,
  toRunRecord,
  type LoopLaneOutcome,
  type LoopLanePhase,
  type LoopLaneRecord,
  type LoopRunDetail,
  type LoopRunPhase,
  type LoopRunRecord,
  type LoopRunSummary,
} from "@/lib/db/loop-runs-types";

export {
  appendLaneLog,
  createLoopRun,
  markStaleRunsStopped,
  updateLane,
  updateLoopRun,
  upsertLane,
  type CreateLoopRunInput,
  type LoopLanePatch,
  type LoopRunPatch,
} from "@/lib/db/loop-runs-write";

export {
  getActiveLoopRun,
  getLane,
  getLatestScanIdForRepo,
  getLoopRun,
  getLoopRunDetail,
  listLanes,
  listLoopRuns,
} from "@/lib/db/loop-runs-read";
