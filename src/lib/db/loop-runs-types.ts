// Shapes, constants and row→record projections for the loop-run tables — the PARSING half of the
// store, split out of loop-runs.ts to keep each module readable. The JSON-in-TEXT decoding lives
// here because it is the one place a malformed column turns into a crash three layers up in a React
// tree, and it is worth being able to test without a database in the room.
//
// Import from the `@/lib/db/loop-runs` barrel; this module is an implementation split.

import { normalizeDelivery, type LoopDelivery } from "@/lib/local/delivery-options";
import type { ScanDiff } from "@/lib/report/compare";
import type { ComparableScan } from "@/lib/db/scans";
import type { DimensionId } from "@/lib/types";

/**
 * What a lane DID, as one headline per deliverable — the outcome cell's unit of display.
 *
 *   • `closed`    — a follow-up the agent claimed RESOLVED (`covers` = its id).
 *   • `installed` — a foundation/practice lane's deterministic install.
 *   • `hardened`  — an attributable upward dimension movement not already covered by a close.
 *   • `regressed` — the same, downward. Reported: a regression the loop caused is a deliverable too.
 *   • `noted`     — none of the above: the client fold synthesizes `noted` rows for armed-but-
 *                   unresolved batch items (proposed gaps), `reviewDeliverable` appends `noted`
 *                   REVIEW MARKERS (see `isReviewMarker`), and the server-side deriver emits ONE as
 *                   the last rung of its totality fallback (see `retired` below and
 *                   src/lib/local/lane-deliverables.ts) — a lane that committed but closed nothing
 *                   identifiable still names what it did.
 *
 * CLOSED vs RETIRED — one kind, one flag, and the distinction is load-bearing.
 *
 * `closed` used to mean two very different things: a gap the AGENT actually closed, and a row the
 * RESCAN simply stopped raising. One campaign run printed ten "closed" rows off a single commit —
 * nine were phantom D4 rows being retired after the coverage-guarantee fix, work nobody did. A sheet
 * (or any ledger built on it) that counts those as output overstates the loop.
 *
 * So a row the rescan retired without an agent claim behind it carries `retired: true`. It is a FLAG
 * rather than a sixth `LaneDeliverableKind` on purpose: the sheet's `KIND_META` is an exhaustive
 * `Record<LaneDeliverableKind, …>` in a file this change does not own, so a new member would be a
 * compile break there, while an unread flag degrades to exactly today's rendering.
 *
 * It is asserted ONLY when the lane's own `RESOLVED:` lines are on file. A read-side backfill has no
 * claims to compare against (the agent summary is not persisted), and "unknown" is never evidence of
 * "not claimed" — the same posture `parsePlatformSignals` and `getLatestUnmeasurableDims` take.
 */
export type LaneDeliverableKind = "closed" | "installed" | "hardened" | "regressed" | "noted";

/** An owner's one-click ruling on a deliverable row — the human gate: the loop proposes, the human
 *  disposes. Absent on every row written before reviews existed, which parses as "not reviewed". */
export type DeliverableReview = "approved" | "dismissed";

export interface LaneDeliverable {
  /** ≤ 8 words, verb-first past tense: "Hardened GitHub CI/CD". */
  headline: string;
  dimId: DimensionId | null;
  kind: LaneDeliverableKind;
  /** Follow-up ids / signal names this covers. */
  covers: string[];
  /** One line of evidence for the expanded view. */
  evidence: string | null;
  /** JSON-in-TEXT widening (same technique as `parseTargets`): old rows parse with no review. */
  review?: DeliverableReview;
  /** THE RESCAN STOPPED RAISING THIS; no agent RESOLVED clause covers it. See the header above.
   *  Absent (never `false`) when the row is agent-claimed or when the claims are unknown. */
  retired?: true;
}

const DELIVERABLE_KINDS: readonly LaneDeliverableKind[] = ["closed", "installed", "hardened", "regressed", "noted"];

/**
 * A REVIEW MARKER: the entry `reviewDeliverable` appends when an owner rules on a row that is not in
 * the persisted list (a backfilled derivation, or a proposed batch item the client synthesized). It
 * carries only the key and the ruling; the read side re-derives the row and attaches the review by
 * key, and no surface renders a marker as a row of its own.
 */
export const isReviewMarker = (d: LaneDeliverable): boolean =>
  d.kind === "noted" && d.covers.length === 1 && d.headline === d.covers[0];

/** `deliverablesJson` → the list; anything malformed is an empty list, never a crash in a React tree. */
export function parseDeliverables(raw: string | null | undefined): LaneDeliverable[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.flatMap((d): LaneDeliverable[] => {
      if (!d || typeof d !== "object") return [];
      const e = d as Partial<LaneDeliverable>;
      if (typeof e.headline !== "string" || !e.headline.trim()) return [];
      const kind = (DELIVERABLE_KINDS as readonly string[]).includes(e.kind as string) ? (e.kind as LaneDeliverableKind) : "noted";
      return [
        {
          headline: e.headline,
          dimId: typeof e.dimId === "string" ? (e.dimId as DimensionId) : null,
          kind,
          covers: Array.isArray(e.covers) ? e.covers.filter((x): x is string => typeof x === "string") : [],
          evidence: typeof e.evidence === "string" ? e.evidence : null,
          // The widened review field: anything but the two rulings parses as "not reviewed".
          ...(e.review === "approved" || e.review === "dismissed" ? { review: e.review } : {}),
          // Same widening for the retired flag: only a literal `true` sets it, so a row written
          // before the flag existed — and any other value — parses as "not asserted".
          ...(e.retired === true ? { retired: true as const } : {}),
        },
      ];
    });
  } catch {
    return [];
  }
}
// TYPE-ONLY, and the import runs the other way at runtime: `lane-economics.ts` is the pure fold and
// depends on these shapes, while this module only needs its result type to declare what the detail
// view carries. Erased at compile time, so there is no module cycle in the emitted graph.
import type { LaneEconomics } from "@/lib/local/lane-economics";
// Both TYPE-ONLY and both pure modules (no Prisma, no node built-ins reached at type level), for the
// same reason as the line above: the record has to describe what the columns hold, and a second
// "equivalent" declaration here is how a field silently stops arriving.
import type { LaneBriefProvenance } from "@/lib/org/lane-brief";
import type { LaneReport } from "@/lib/local/lane-report";
import type { LaneOutcomeRow } from "@/lib/db/lane-outcomes";

/** Lanes in flight at once. 4 local `claude -p` sessions already saturate a developer box. */
export const LOOP_CONCURRENCY_CAP = 4;
export const LOOP_DEFAULT_CONCURRENCY = 2;
/** Same ceiling the single-repo autopilot always had — a bounded loop, never an open-ended agent. */
export const LOOP_MAX_CYCLES_CAP = 5;
/** Per-lane log ceiling, in lines. Matches the old in-memory autopilot's bound. */
export const LANE_LOG_LINES = 200;

export type LoopRunPhase = "curating" | "running" | "done" | "stopped" | "error";

/**
 * How a run spends models (MOONSHOT #27).
 *
 *   • `single` — every lane runs the one resolved model. What every run before #27 was.
 *   • `ab`     — the same curated batch is worked by TWO lanes per repo per cycle, one per model,
 *                each in its own worktree and each rescanned by the same guardbanded scorer. Two
 *                arms of one experiment, so a cost/lift difference is a MEASUREMENT rather than a
 *                comparison of two runs that differed in a dozen other ways.
 */
export type LoopModelPolicy = "single" | "ab";

/** HOW A RUN'S WORK IS DELIVERED. Declared in the dependency-free `delivery-options` module (the
 *  cockpit's picker and the route's validator read the same list) and re-exported here so the record
 *  below and every reader of it have one import for the run's shape. */
export type { LoopDelivery };

export const LOOP_MODEL_POLICIES: readonly LoopModelPolicy[] = ["single", "ab"];

/** A policy from an untrusted string (the column is TEXT, the wire is JSON), else `single`. */
export const asModelPolicy = (v: unknown): LoopModelPolicy =>
  v === "ab" ? "ab" : "single";

/** The ONE declared cost source for a lane. A second value would be a second source, which is the
 *  thing the one-source rule exists to forbid — an envelope figure added to an OTLP figure
 *  double-counts the same tokens. See `src/lib/local/lane-economics.ts`. */
export const LANE_COST_SOURCE = "envelope" as const;
export type LoopLanePhase = "queued" | "dispatching" | "rescanning" | "done" | "error";

/**
 * What a lane DOES, not just which repo it does it to.
 *
 *   • `backlog`   — the original lane: dispatch the repo's open follow-ups to a local Claude session.
 *   • `foundation`— install the generated `.ai/` standard (no agent call: deterministic file writes).
 *   • `practice`  — install one Practice Library starter (same, one file).
 *   • `craft`     — dispatch the repo's CRAFT rungs to a local Claude session. Same machinery as
 *                   `backlog`, different batch and a different brief: it arms only once the repo has
 *                   no open gaps left, which is exactly where the loop used to die.
 *
 * The two deterministic kinds exist because UC1's loop is "scan → gaps → apply practice / `.ai/`
 * foundation → rescan", and until now the local loop could only do the middle step through an agent
 * while the other two lived behind a GitHub-App draft-PR door the loop never opened.
 *
 * `craft` exists (r12) because the loop ENDED at green. `openBatch` returned nothing the moment the
 * last gap closed, no lane could arm, and a repository that had done everything the rubric asks was
 * handed silence. Craft entries were already being produced and stored; they were simply undispatchable.
 * Note what a craft lane still is NOT: it moves no score, adds no debt, and closes nothing on the
 * ledger except its own rungs.
 */
export type LoopLaneKind = "backlog" | "foundation" | "practice" | "craft";

/** One repo in a run, with the kind of lane its FIRST cycle was armed for. */
export interface LoopTarget {
  repo: string;
  kind: LoopLaneKind;
  /** Practice Library id — set only on a `practice` target. */
  practiceId: string | null;
}

export const LANE_KINDS: readonly LoopLaneKind[] = ["backlog", "foundation", "practice", "craft"];

const asKind = (v: unknown): LoopLaneKind =>
  typeof v === "string" && (LANE_KINDS as readonly string[]).includes(v) ? (v as LoopLaneKind) : "backlog";

export interface LoopRunRecord {
  id: string;
  orgId: string;
  createdBy: string | null;
  phase: LoopRunPhase;
  repos: string[];
  concurrency: number;
  maxCycles: number;
  cycle: number;
  curated: boolean;
  /** The run's repos WITH the lane kind each was armed for — see `parseTargets`. Always the same
   *  length and order as `repos`, which is derived from it. */
  targets: LoopTarget[];
  /** The RESOLVED model this run's agent sessions were armed with; null on a row written before the
   *  column, which is unknown — never "the default". */
  model: string | null;
  /** The reasoning effort passed to the CLI, or null when none was chosen (the flag is then not
   *  passed at all — see src/lib/local/agent.ts). */
  effort: string | null;
  /** How this run spends models. `single` = every lane runs the one resolved model; `ab` = each repo
   *  is worked by TWO lanes, one per arm, sharing an `abPairKey`. */
  modelPolicy: LoopModelPolicy;
  /** The models this run is armed with, in order: one for `single`, two for `ab`. Empty on a row
   *  written before the column — "not recorded", which `model` above still answers for. */
  models: string[];
  /** How this run's lane branches were delivered. `null` on a row written before the column, which
   *  MEANS `branch` — that is exactly what those runs did — but is kept null rather than defaulted so
   *  a reader can still tell an old row from one an operator explicitly armed for branches. Use
   *  `deliveryOf` to collapse the two when what you want is the behaviour. */
  delivery: LoopDelivery | null;
  startedAt: string;
  endedAt: string | null;
  error: string | null;
  createdAt: string;
}

export interface LoopLaneRecord {
  id: string;
  runId: string;
  repoFullName: string;
  cycle: number;
  phase: LoopLanePhase;
  branch: string | null;
  batchIds: string[];
  closedIds: string[];
  commits: number;
  beforeScanId: string | null;
  afterScanId: string | null;
  /** Live rescan sub-stage (fetch | tree | files | analyze | score | compose), or null. */
  stage: string | null;
  /** The lane's log, newest last, already bounded to LANE_LOG_LINES. */
  log: string[];
  error: string | null;
  startedAt: string | null;
  endedAt: string | null;
  /** What the lane delivered, as headlines — written at lane end (src/lib/local/lane-deliverables.ts).
   *  Empty on a row written before the column; the read side then derives them from the diff. */
  deliverables: LaneDeliverable[];

  // ── MOONSHOT #27 — what this lane's agent session cost, from ONE declared source.
  // Every field is null on a lane that reported nothing, and null is NOT zero: a 0 here would be
  // averaged downstream as a free session, which is a claim nobody made.
  /** The model this lane actually ran. Null on a pre-#27 row — unknown, not "the default". */
  model: string | null;
  /** `"envelope"` and nothing else today. Stamped so a reader never has to guess which population a
   *  figure came from, and so a second source can never be quietly added to the first. */
  costSource: string | null;
  /** MICRO-CENTS (`round(total_cost_usd * 100 * 1e6)`). Displays divide; the store never rounds. */
  costMicros: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  turns: number | null;
  agentDurationMs: number | null;
  /** The CLI's own session id — A JOIN KEY ONLY. Never a licence to add an `AgentSession` row's cost
   *  to this lane's: that is OTLP export of sessions a DEVELOPER ran, a different population. */
  agentSessionId: string | null;
  /** Joins the two arms of one `ab` pair; null on a `single` run. */
  abPairKey: string | null;

  // ── MOONSHOT #25 — the org's own standard in, the agent's structured result out.
  /** PROVENANCE of the brief this lane was given — which playbook and version, which mined practice,
   *  which memory and skill ids, what was omitted and why. Not the prose: the prose is rebuilt
   *  deterministically from the same inputs. `null` on a lane written before briefs existed. */
  /** Dominant dimension of the lane's dispatched batch (MOONSHOT #26). Null when the batch spanned
   *  none — and a lane with no dimension cannot open a PR, because ImprovementPr.dimId is not
   *  nullable and inventing one would file real work under a dimension nobody chose. */
  dimId: string | null;
  /** The PR this lane became, denormalized. Null until an owner opens one; the loop never pushes. */
  prNumber: number | null;
  prUrl: string | null;
  brief: LaneBriefProvenance | null;
  /** The agent's own `.ascent/lane-report.json`, parsed and validated. `null` when the lane predates
   *  the contract; a lane that ran and wrote nothing carries `{ parsed: false }`, which is a
   *  different fact and is not the same as "it skipped nothing". */
  report: LaneReport | null;

  // ── MOONSHOT #3 — WHO IS DOING THIS LANE'S WORK.
  /** `local` (Ascent spawned an agent in a worktree on the operator's own box) or `remote-agent`
   *  (some agent elsewhere pulls this lane's rows over MCP; Ascent starts no process and opens no
   *  worktree for it). Defaults to `local`, so every lane written before this reads as what it was. */
  executor: LoopLaneExecutor;
  /** The claimant's opaque actor id — `agent:<token name>` for a remote lane. Null = unclaimed. */
  claimedBy: string | null;
  /** ISO. When the current claim lapses; null = no lease held, which for a remote lane means nobody
   *  has claimed into it yet, and is never read as "expired". */
  leaseUntil: string | null;
}

/** Who runs a lane's work. A remote lane deliberately carries NO cost envelope: #27's figures come
 *  from a `claude -p` session Ascent spawned, and there is no such session here. `costMicros` stays
 *  null on one — unknown, never zero. */
export type LoopLaneExecutor = "local" | "remote-agent";

export const asLaneExecutor = (v: string | null | undefined): LoopLaneExecutor =>
  v === "remote-agent" ? "remote-agent" : "local";

export interface LoopRunSummary {
  id: string;
  phase: LoopRunPhase;
  repos: string[];
  cycle: number;
  maxCycles: number;
  startedAt: string;
  endedAt: string | null;
  /** Summed overall-score movement across the lanes that have BOTH ends. Null when none do —
   *  "not measurable yet", which is not the same number as zero movement. */
  lift?: number | null;
  /** The agent configuration this run's lift was produced under — the history strip prints it beside
   *  the number, because comparing two lifts means comparing two setups. Null = unknown. */
  model?: string | null;
  effort?: string | null;
  /** MICRO-CENTS summed over the lanes that recorded a cost. `null` when NONE did — "not measured",
   *  which is a different fact from a run that cost nothing. */
  costMicros?: number | null;
}

/** One lane's before/after, as the detail view needs it. */
export interface LoopLaneOutcome {
  lane: LoopLaneRecord;
  /** What this lane did — resolved from the run's targets, so the ledger never has to guess. */
  kind: LoopLaneKind;
  before: ComparableScan | null;
  after: ComparableScan | null;
  diff: ScanDiff | null;
  closedFollowUpIds: string[];
  commits: number;
  /** The lane's headlines: the persisted list, or — for a row without one — the deterministic
   *  derivation from the persisted claims and diff, so old rows render headlines too. */
  deliverables: LaneDeliverable[];
}

export interface LoopRunDetail {
  run: LoopRunRecord;
  lanes: LoopLaneRecord[];
  outcomes: LoopLaneOutcome[];
  /** One entry per outcome, SAME ORDER — what each lane cost against what it verifiably moved. The
   *  fold is pure (`src/lib/local/lane-economics.ts`); this is only where it is carried to a client. */
  economics: LaneEconomics[];
  /** One row per item the run's lanes dispatched — the agent's account beside the rescan's ruling.
   *  Empty on a run that predates the contract, which is not the same as "nothing was skipped". */
  itemOutcomes: LaneOutcomeRow[];
}

// ── row → record ─────────────────────────────────────────────────────────────────────────────────

const parseList = (raw: string | null | undefined): string[] => {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

/**
 * `reposJson` → the run's targets, accepting BOTH encodings.
 *
 * The column has always held `["owner/name", …]`. A lane kind is a per-repo fact that has to survive
 * a restart (the outcome ledger renders it long after the run ended), and the loop tables have no
 * spare JSON payload to put it in. Rather than add a column — which on this checkout would mean
 * regenerating the Prisma client into a `node_modules` shared with the operator's own working copy —
 * the existing JSON-in-TEXT column is WIDENED: an entry may now also be `{repo, kind, practiceId}`.
 * Every row written before this parses as `backlog`, which is exactly what those runs were. Same
 * technique the schema already uses for `runsJson` / `measurementJson`, and the reason the schema
 * header calls out "bulky string arrays are stored as serialized JSON in text columns".
 */
export function parseTargets(raw: string | null | undefined): LoopTarget[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: LoopTarget[] = [];
  for (const entry of parsed) {
    if (typeof entry === "string") {
      out.push({ repo: entry, kind: "backlog", practiceId: null });
      continue;
    }
    if (entry && typeof entry === "object" && typeof (entry as { repo?: unknown }).repo === "string") {
      const e = entry as { repo: string; kind?: unknown; practiceId?: unknown };
      out.push({
        repo: e.repo,
        kind: asKind(e.kind),
        practiceId: typeof e.practiceId === "string" ? e.practiceId : null,
      });
    }
  }
  return out;
}

/**
 * The kind a given lane ran as.
 *
 * A foundation/practice lane is a CYCLE-1 lane: once the standard (or the starter) is installed, the
 * repo's next cycle is ordinary backlog work with the new floor in place. That is the same shape the
 * curated batch already has — `loop-engine.ts` applies `input.batches` to cycle 1 only — and it is
 * what makes "install, then rescan, then work the gaps" one run instead of two.
 */
export function laneKindOf(
  targets: readonly LoopTarget[],
  lane: Pick<LoopLaneRecord, "repoFullName" | "cycle">,
): LoopLaneKind {
  if (lane.cycle !== 1) return "backlog";
  return targets.find((t) => t.repo === lane.repoFullName)?.kind ?? "backlog";
}

type RunRow = {
  id: string;
  orgId: string;
  createdBy: string | null;
  phase: string;
  reposJson: string;
  concurrency: number;
  maxCycles: number;
  cycle: number;
  curated: boolean;
  model?: string | null;
  effort?: string | null;
  modelPolicy?: string | null;
  modelsJson?: string | null;
  delivery?: string | null;
  startedAt: Date;
  endedAt: Date | null;
  error: string | null;
  createdAt: Date;
};

type LaneRow = {
  id: string;
  runId: string;
  repoFullName: string;
  cycle: number;
  phase: string;
  branch: string | null;
  batchIdsJson: string;
  closedIdsJson: string;
  commits: number;
  beforeScanId: string | null;
  afterScanId: string | null;
  stage: string | null;
  log: string;
  error: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  deliverablesJson?: string | null;
  // Optional so a read that predates the columns (or a fixture that does not select them) degrades
  // to `null` per field rather than failing to type — the same posture `model`/`effort` take above.
  model?: string | null;
  costSource?: string | null;
  costMicros?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  turns?: number | null;
  agentDurationMs?: number | null;
  agentSessionId?: string | null;
  abPairKey?: string | null;
  dimId?: string | null;
  prNumber?: number | null;
  prUrl?: string | null;
  briefJson?: string | null;
  reportJson?: string | null;
  executor?: string | null;
  claimedBy?: string | null;
  leaseUntil?: Date | null;
};

/** `briefJson` → provenance, or null. A malformed column is `null` (unknown), never a crash three
 *  layers up in a React tree — the same posture `parseTargets` takes. */
export function parseBriefProvenance(raw: string | null | undefined): LaneBriefProvenance | null {
  if (!raw || raw === "{}") return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const p = v as Partial<LaneBriefProvenance>;
    if (p.v !== 1 || !Array.isArray(p.sections) || !Array.isArray(p.omitted)) return null;
    return {
      v: 1,
      bytes: typeof p.bytes === "number" ? p.bytes : 0,
      sections: p.sections,
      omitted: p.omitted,
      housePatternVersion: typeof p.housePatternVersion === "string" ? p.housePatternVersion : null,
    };
  } catch {
    return null;
  }
}

/** `reportJson` → the parsed lane report, or null when the lane predates the contract. */
export function parseReportColumn(raw: string | null | undefined): LaneReport | null {
  if (!raw || raw === "{}") return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const r = v as Partial<LaneReport>;
    if (r.v !== 1) return null;
    return {
      v: 1,
      parsed: r.parsed === true,
      ...(typeof r.raw === "string" ? { raw: r.raw } : {}),
      items: Array.isArray(r.items) ? r.items : [],
      lessons: Array.isArray(r.lessons) ? r.lessons.filter((l): l is string => typeof l === "string") : [],
    };
  } catch {
    return null;
  }
}

export function toRunRecord(row: RunRow): LoopRunRecord {
  const targets = parseTargets(row.reposJson);
  return {
    id: row.id,
    orgId: row.orgId,
    createdBy: row.createdBy,
    phase: row.phase as LoopRunPhase,
    repos: targets.map((t) => t.repo),
    targets,
    concurrency: row.concurrency,
    maxCycles: row.maxCycles,
    cycle: row.cycle,
    curated: row.curated,
    model: row.model ?? null,
    effort: row.effort ?? null,
    modelPolicy: asModelPolicy(row.modelPolicy),
    models: parseList(row.modelsJson),
    // An unrecognised string parses as null — "unchosen" — and never as a guess at a mode that would
    // write into the operator's working copy. Same posture `normalizeAgentModel` takes at the route.
    delivery: normalizeDelivery(row.delivery),
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toLaneRecord(row: LaneRow): LoopLaneRecord {
  return {
    id: row.id,
    runId: row.runId,
    repoFullName: row.repoFullName,
    cycle: row.cycle,
    phase: row.phase as LoopLanePhase,
    branch: row.branch,
    batchIds: parseList(row.batchIdsJson),
    closedIds: parseList(row.closedIdsJson),
    commits: row.commits,
    beforeScanId: row.beforeScanId,
    afterScanId: row.afterScanId,
    stage: row.stage,
    log: row.log ? row.log.split("\n") : [],
    error: row.error,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
    deliverables: parseDeliverables(row.deliverablesJson),
    // `?? null` per field, never `?? 0`: a column the row does not carry is UNKNOWN, and the fold
    // that prices a verified point has to be able to tell that apart from a free session.
    model: row.model ?? null,
    costSource: row.costSource ?? null,
    costMicros: row.costMicros ?? null,
    inputTokens: row.inputTokens ?? null,
    outputTokens: row.outputTokens ?? null,
    cacheReadTokens: row.cacheReadTokens ?? null,
    turns: row.turns ?? null,
    agentDurationMs: row.agentDurationMs ?? null,
    agentSessionId: row.agentSessionId ?? null,
    abPairKey: row.abPairKey ?? null,
    dimId: row.dimId ?? null,
    prNumber: row.prNumber ?? null,
    prUrl: row.prUrl ?? null,
    brief: parseBriefProvenance(row.briefJson),
    report: parseReportColumn(row.reportJson),
    // #3 — the lane's worker. `asLaneExecutor` floors an unreadable value to `local`, which is what
    // every row written before the column actually was; `leaseUntil` crosses as an ISO STRING, never
    // a Date (AGENTS.md's wire-safe rule — the cockpit renders a countdown off it).
    executor: asLaneExecutor(row.executor),
    claimedBy: row.claimedBy ?? null,
    leaseUntil: row.leaseUntil ? row.leaseUntil.toISOString() : null,
  };
}

/** Trim a log to the last LANE_LOG_LINES lines. Pure — exported for the engine and its tests. */
export function boundLog(lines: readonly string[]): string[] {
  return lines.length > LANE_LOG_LINES ? lines.slice(lines.length - LANE_LOG_LINES) : [...lines];
}

