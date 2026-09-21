// THE LEDGER'S SHAPES — what the server loader (`ledgerLoad.ts`) hands the client view, and the one
// route response that exists nowhere else.
//
// TYPES ONLY, for the reason `cockpit/loopTypes.ts` gives: every record is re-exported from the module
// that PRODUCES it (a second client copy is how a field silently stops arriving), and because every
// import below is `import type`, nothing server-side reaches the browser bundle. Client files import
// these shapes from HERE and never from `@/lib/db` or `@/lib/local` themselves.

import type { DriveEventRecord, DriveStatus } from "@/lib/local/drive-types";
import type {
  LoopDirectionRecord,
  LoopPlanRecord,
  RepoRunnerState,
  RunnerPauseReason,
} from "@/lib/local/runner-types";
import type { LoopRunChronicleEntry } from "@/lib/db/loop-runs-read";
import type { RunnerKeptLessonRow } from "@/lib/db/loop-lessons";

export type {
  DriveEventRecord,
  DriveStatus,
  LoopDirectionRecord,
  LoopPlanRecord,
  LoopRunChronicleEntry,
  RepoRunnerState,
  RunnerKeptLessonRow,
  RunnerPauseReason,
};

/** The run the runner is in right now — the header's "run #12, cycle 2/3". */
export interface LedgerActiveRun {
  id: string;
  seq: number | null;
  cycle: number;
  maxCycles: number;
  startedAt: string;
}

/** A read the loader could not complete. The briefing names these instead of rendering silence. */
export type LedgerRead = "drives" | "anchor" | "runs" | "plans" | "directions" | "lessons";

/** Everything the ledger renders, read once on the server. */
export interface LedgerData {
  slug: string;
  /** Server time when this was read — every relative time on the page is measured against it, so the
   *  server render and the hydrated one print the same words. */
  now: string;
  isOwner: boolean;
  selfHosted: boolean;
  /** The viewer's `Membership.liveSeenAt`, SNAPSHOTTED at render. Null = never looked, or no per-user
   *  anchor exists (auth off, not a member) — the briefing then covers the last 24 hours and says so. */
  seenAt: string | null;
  /** The live continuous drive (running / paused / idle), or null — "No runner". */
  runner: DriveStatus | null;
  /** The newest continuous drive, live or ended — the runner card's repos, so work left on a stopped
   *  runner's branch can still be merged out. Equal to `runner` while one is live. */
  lastRunner: DriveStatus | null;
  activeRun: LedgerActiveRun | null;
  /** Drive id → mode, for the chronicle's runner / drive / manual badge. */
  driveModes: Record<string, "bounded" | "continuous">;
  /** The approval inbox — `pending` plans. Null = the read failed. */
  pending: LoopPlanRecord[] | null;
  /** Recent plans of every status, for the directions' "plans that ran under it". */
  plans: LoopPlanRecord[] | null;
  directions: LoopDirectionRecord[] | null;
  /** The chronicle's first page. */
  runs: LoopRunChronicleEntry[] | null;
  /** The first page was full: older runs exist or may exist, and counts over it are lower bounds. */
  runsHasMore: boolean;
  lessons: RunnerKeptLessonRow[] | null;
  /** Repo → commits on the runner branch not on its base. A missing key or null is UNKNOWN (git could
   *  not say, the read timed out, or this deployment has no checkout) — never zero. */
  ahead: Record<string, number | null>;
  failed: LedgerRead[];
}

/** `POST /api/org/local/runner/merge` → `MergeOutResult` (runner-branch.ts) plus the base it used. */
export type RunnerMergeResponse =
  | { ok: true; outcome: "fast-forward" | "merged"; mergedSha: string | null; note: string; base: string }
  | { ok: false; outcome: "commands"; commands: string[]; note: string; base: string };
