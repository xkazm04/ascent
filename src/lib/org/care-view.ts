// The read model behind the `Care` tab (UC3 "individual care" — docs/REGISTRY-AND-CARE-IMPL.md §5).
//
// ONE view model, TWO modes, decided by `Organization.kind`:
//   personal → the developer's own home. Everything here arrived because THEY pushed it
//              (`npx ascent mentor share`); nothing is derived from a scan of a person.
//   org      → the anonymized care aggregate, under the SAME anti-surveillance floors the
//              Contributors/Adoption tabs use (`champions.ts`). There is deliberately NO per-person
//              shape in the org branch of this type: the surveillance-y view is not merely hidden in
//              the UI, it is unrepresentable in the data.
//
// Until C3 lands (`POST /api/me/mentor/share` + the personal tables), the loader in the `-load` sibling
// returns an HONEST
// EMPTY state — nothing shared yet / population below the floor. It never fabricates. The three
// prototype variants are exercised from `care-view.fixture.ts` via `?demo=`.

import { CHAMPION_MIN_POP } from "@/components/org/shared/champions";
import type { DimensionId } from "@/lib/types";

// ── Personal mode ─────────────────────────────────────────────────────────────────────────────────

/** The five move families of the local mentor's seed catalogue (GOLDEN-USE-CASES.md UC3). */
export type CareMoveCategory = "session" | "verification" | "context" | "tooling" | "cost";

/** A move's lifecycle. `kept`/`dropped` are the developer's own verdict, never inferred. */
export type CareMoveState = "proposed" | "trying" | "kept" | "dropped";

export interface CareMove {
  id: string;
  title: string;
  state: CareMoveState;
  category: CareMoveCategory;
  /** "why" — the evidence from the developer's OWN journal that proposed this move. */
  why: string;
  /**
   * Fleet evidence ascent can add and the local skill cannot see: "3 other repos gained 2 pts on D2
   * after adopting this". Null when the fleet has nothing to say (honest zeros).
   */
  evidence: string | null;
  /** Estimated saving in minutes per week, as the mentor scored it for THIS developer. */
  expectedSaving: number | null;
  /** The trial contract: "try for N sessions". Null once the move is closed. */
  tryFor: number | null;
  /** Reason recorded when the state is `dropped` — the decline memory, so it is never re-asked. */
  droppedReason?: string;
  /** A kept move that could become a registry skill authored by this developer (the UC2 bridge). */
  registryPromotable?: boolean;
  /** When the state last changed (ISO). */
  at: string;
}

/** The 30-day session-shape counts. Every field is opt-in: see `sharedFields`. */
export interface CareSessionShape {
  sessionsPerWeek: number | null;
  turnsPerSession: number | null;
  planModePct: number | null;
  retriesPerSession: number | null;
  testsBeforeCommitPct: number | null;
  skillInvokes30d: number | null;
}

export type CareShapeField = keyof CareSessionShape;

/** A field's anonymous org band — quartiles only, so no individual is recoverable. */
export interface CareBand {
  p25: number;
  p50: number;
  p75: number;
}

export interface CarePersonalView {
  profile: {
    /** Self-stated, from the mentor interview — never inferred. */
    role: string | null;
    /** A HINT the developer confirmed (explorer / director / verifier), not an assigned label. */
    archetypeHint: string | null;
    goals: string[];
    /** When the profile was last pushed from the machine. Null = never shared. */
    sharedAt: string | null;
  };
  moves: CareMove[];
  shape: CareSessionShape;
  /** Which shape fields the developer chose to share. A field absent here reads as "not shared". */
  sharedFields: CareShapeField[];
  /** Anonymous org bands for the shared fields — present only if the developer opted into comparison. */
  orgBands: Partial<Record<CareShapeField, CareBand>> | null;
  /** Cross-repo grounding the local skill cannot see: the repos you commit to, and their open gaps. */
  myRepos: Array<{
    fullName: string;
    level: string | null;
    score: number | null;
    openRecommendations: Array<{ title: string; dimension: DimensionId | string }>;
  }>;
  /** Weekly retro lines, newest first. */
  journal: Array<{ at: string; line: string; kind?: "retro" | "weekly" | "move" }>;
  setup: {
    mentorInstalled: boolean;
    hookInstalled: boolean;
    lastShareAt: string | null;
    /** The privacy ledger, field by field: exactly what is and is not leaving the machine. */
    sharing: Array<{ field: string; shared: boolean; note?: string }>;
  };
}

// ── Org mode ──────────────────────────────────────────────────────────────────────────────────────

export interface CareOrgView {
  /** Developers in the workspace who could opt in — the floor denominator. */
  population: number;
  /** True when `population < CHAMPION_MIN_POP`: aggregates are suppressed, not merely thin. */
  belowFloor: boolean;
  floor: number;
  adoption: { setUp: number; sharing: number };
  /** Fleet-wide most-kept moves — counts only, never who. */
  topKeptMoves: Array<{ title: string; keptBy: number; category: CareMoveCategory; promotable: boolean }>;
  /** Anonymized interview themes ("where AI wastes my time") → registry backlog inputs. */
  asks: Array<{ theme: string; count: number }>;
  /** Session-shape distribution as bands. No individual row exists in this type by design. */
  shapeBands: Partial<Record<CareShapeField, CareBand>>;
  /** Kept move → repo score delta, reusing the skill-outcomes idea. */
  outcomes: Array<{ move: string; repos: number; avgDelta: number; dimension: DimensionId | string }>;
}

export interface CareView {
  mode: "personal" | "org";
  /** Fixture-driven demo label, surfaced as a chip so a prototype is never mistaken for live data. */
  demo?: string;
  personal?: CarePersonalView;
  org?: CareOrgView;
}

// ── Honest empties ────────────────────────────────────────────────────────────────────────────────

/** The pre-C3 personal state: the mentor has never shared anything. Nothing invented. */
export function emptyPersonalView(): CarePersonalView {
  return {
    profile: { role: null, archetypeHint: null, goals: [], sharedAt: null },
    moves: [],
    shape: {
      sessionsPerWeek: null,
      turnsPerSession: null,
      planModePct: null,
      retriesPerSession: null,
      testsBeforeCommitPct: null,
      skillInvokes30d: null,
    },
    sharedFields: [],
    orgBands: null,
    myRepos: [],
    journal: [],
    setup: { mentorInstalled: false, hookInstalled: false, lastShareAt: null, sharing: SHARING_LEDGER_OFF },
  };
}

/**
 * The privacy ledger's default: every line OFF. This list is the contract the tab renders — the point
 * of naming the never-shared rows explicitly is that silence about transcripts would be read as
 * "maybe". It says so in the negative, permanently.
 */
export const SHARING_LEDGER_OFF: CarePersonalView["setup"]["sharing"] = [
  { field: "Session counts (30d)", shared: false },
  { field: "Plan-mode ratio", shared: false },
  { field: "Tests-before-commit ratio", shared: false },
  { field: "Skill invokes", shared: false },
  { field: "Moves kept / dropped", shared: false },
  { field: "Transcript text", shared: false, note: "never leaves your machine — not a setting" },
  { field: "Prompts, diffs, file contents", shared: false, note: "never collected" },
  { field: "Per-person rows in org mode", shared: false, note: "unrepresentable in the org view model" },
];

/** The pre-C3 org state: the floor decides, and with no opt-ins the population is zero. */
export function emptyOrgView(population = 0): CareOrgView {
  return {
    population,
    belowFloor: population < CHAMPION_MIN_POP,
    floor: CHAMPION_MIN_POP,
    adoption: { setUp: 0, sharing: 0 },
    topKeptMoves: [],
    asks: [],
    shapeBands: {},
    outcomes: [],
  };
}

// ── Small shared derivations (pure; used by every variant) ─────────────────────────────────────────

export const CARE_MOVE_STATES: readonly CareMoveState[] = ["proposed", "trying", "kept", "dropped"];

export const CARE_CATEGORY_LABEL: Record<CareMoveCategory, string> = {
  session: "Session shape",
  verification: "Verification",
  context: "Context",
  tooling: "Tooling",
  cost: "Cost",
};

export const CARE_SHAPE_LABEL: Record<CareShapeField, string> = {
  sessionsPerWeek: "Sessions / week",
  turnsPerSession: "Turns / session",
  planModePct: "Plan mode",
  retriesPerSession: "Retries / session",
  testsBeforeCommitPct: "Tests before commit",
  skillInvokes30d: "Skill invokes (30d)",
};

/** Fields rendered as a percentage. Everything else is a plain count. */
export const CARE_SHAPE_PCT: ReadonlySet<CareShapeField> = new Set<CareShapeField>([
  "planModePct",
  "testsBeforeCommitPct",
]);

/** Fields where a HIGHER number is the healthier habit — decides which way a band comparison reads. */
export const CARE_SHAPE_HIGHER_IS_BETTER: ReadonlySet<CareShapeField> = new Set<CareShapeField>([
  "planModePct",
  "testsBeforeCommitPct",
  "skillInvokes30d",
]);

export const CARE_SHAPE_ORDER: readonly CareShapeField[] = [
  "sessionsPerWeek",
  "turnsPerSession",
  "planModePct",
  "retriesPerSession",
  "testsBeforeCommitPct",
  "skillInvokes30d",
];

export function careMovesByState(moves: CareMove[]): Record<CareMoveState, CareMove[]> {
  const out: Record<CareMoveState, CareMove[]> = { proposed: [], trying: [], kept: [], dropped: [] };
  for (const m of moves) out[m.state].push(m);
  return out;
}

/** Minutes/week the KEPT moves are expected to give back. Honest null when nothing is quantified. */
export function careKeptSaving(moves: CareMove[]): number | null {
  const vals = moves.filter((m) => m.state === "kept" && m.expectedSaving != null).map((m) => m.expectedSaving!);
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
}

/** Format a shape value for display, respecting percent fields and honest nulls. */
export function careShapeValue(field: CareShapeField, value: number | null | undefined): string {
  if (value == null) return "—";
  return CARE_SHAPE_PCT.has(field) ? `${Math.round(value)}%` : String(value);
}

/** Where a value sits inside a band, as a short sentence. Never names anyone. */
export function careBandVerdict(field: CareShapeField, value: number | null, band: CareBand | undefined): string | null {
  if (value == null || !band) return null;
  const higher = CARE_SHAPE_HIGHER_IS_BETTER.has(field);
  if (value >= band.p75) return higher ? "top quartile" : "above the org's upper quartile";
  if (value <= band.p25) return higher ? "bottom quartile" : "below the org's lower quartile";
  return value >= band.p50 ? "above the median" : "below the median";
}
