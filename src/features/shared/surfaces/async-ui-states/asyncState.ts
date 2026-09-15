// The pure half of the async-ui-states scene: the state derivation (state-model), the request-key
// classification (windowing-vs-identifying-keys), the cause-typed empty taxonomy (empty-state-design),
// the failure classes (failure-states) and the placeholder / cascade constants. No React, no clock.

import { QUIET_PLACEHOLDER_DELAY_MS } from "@/components/ui/deferPolicy";

export type RegionState = "loading" | "settled-data" | "refreshing" | "superseded" | "settled-empty" | "failed";

export type RegionInputs = {
  /** A request is outstanding (derived from the request machinery, never a hand-set flag). */
  inFlight: boolean;
  /** How many items the region currently holds. */
  held: number;
  /** Sticky: has ANY request ever completed. Reset only by an explicit context change. */
  settled: boolean;
  /** The last failure, cleared when the next request starts. */
  error: FailureClass | null;
  /** The held content answers a previous WINDOW of the same subject. */
  superseded: boolean;
};

/**
 * The derivation, in the order that IS the model: presence of content dominates (a failed or
 * in-flight refresh never demotes held data); failure outranks loading when nothing is held; empty
 * requires the sticky settled bit; unstarted collapses into loading.
 */
export function deriveState(i: RegionInputs): RegionState {
  if (i.held > 0) return i.superseded ? "superseded" : i.inFlight ? "refreshing" : "settled-data";
  if (i.error) return "failed";
  if (i.inFlight) return "loading";
  if (i.settled) return "settled-empty";
  return "loading";
}

/** The edges the model refuses, named by the defect each would ship; the ledger counts them at 0. */
export const FORBIDDEN_EDGES = [
  "settled-data → loading on refresh (placeholder over data)",
  "anything → settled-empty while unsettled (the empty flash)",
  "failed → settled-empty (failure dressed as empty)",
  "settled-data → failed on a refresh failure (held data discarded)",
  "content kept across an identifying key change (another question's answer)",
] as const;

// ── Request-key classification ───────────────────────────────────────────────────────────────────
export type Axis = "identifying" | "windowing";
/** Declared ONCE, where the key is defined: which coordinates change the subject vs the view. */
export const KEY_CLASS = { term: "identifying", page: "windowing", sort: "windowing" } as const satisfies Record<string, Axis>;
export type KeyName = keyof typeof KEY_CLASS;

export type Consumer = "previous content" | "sticky settled bit" | "scroll position" | "windowing coordinates" | "choreography seen-set";
export const CONSUMERS: readonly Consumer[] = ["previous content", "sticky settled bit", "scroll position", "windowing coordinates", "choreography seen-set"];

/** What each consumer does on a change of the given axis — the one table five subsystems read. */
export function consumerOutcome(c: Consumer, axis: Axis): string {
  const w = axis === "windowing";
  switch (c) {
    case "previous content":
      return w ? "kept, marked superseded" : "dropped → loading";
    case "sticky settled bit":
      return w ? "survives" : "reset";
    case "scroll position":
      return w ? "preserved" : "reset to top";
    case "windowing coordinates":
      return w ? "untouched" : "reset to page 1";
    case "choreography seen-set":
      return w ? "survives" : "reset — first appearances";
  }
}

// ── Empty taxonomy ───────────────────────────────────────────────────────────────────────────────
export type EmptyCause = "first-run" | "prerequisite" | "no-match" | "permission" | "drained";

/** The discriminator: branch on the RAW collection, not the filtered one. */
export function emptyCause(raw: number, filtered: number, world: { prerequisiteMissing: boolean; hiddenByRole: boolean; queueSemantics: boolean }): EmptyCause | null {
  if (filtered > 0) return null;
  if (world.hiddenByRole) return "permission";
  if (raw > 0) return "no-match";
  if (world.prerequisiteMissing) return "prerequisite";
  return world.queueSemantics ? "drained" : "first-run";
}

export const EMPTY_COPY: Record<EmptyCause, { title: string; body: string; action: string; tone: "onboarding" | "diagnostic" | "prerequisite" | "access" | "clear" }> = {
  "first-run": { title: "No follow-ups yet", body: "Scan a repository and its gaps will land here.", action: "Scan a repository", tone: "onboarding" },
  prerequisite: { title: "Connect the GitHub App first", body: "Follow-ups are raised from scans, and scans need the app installed on the org.", action: "Connect the app", tone: "prerequisite" },
  "no-match": { title: "No follow-ups match “security”", body: "40 exist; the filter excludes all of them.", action: "Clear filter", tone: "diagnostic" },
  permission: { title: "Follow-ups exist that this role cannot see", body: "12 are recorded for the org; a viewer role does not list them.", action: "Request access", tone: "access" },
  drained: { title: "All clear", body: "Nothing is awaiting review.", action: "", tone: "clear" },
};

// ── Failure classes ──────────────────────────────────────────────────────────────────────────────
export type FailureClass = "unreachable" | "unauthorized";
/** One mapping, product-wide: the raw failure at the user's altitude, plus the action that fits it. */
export const FAILURE_COPY: Record<FailureClass, { title: string; action: "retry" | "sign-in" }> = {
  unreachable: { title: "Couldn’t load alerts — the service didn’t respond.", action: "retry" },
  unauthorized: { title: "You’re signed out of this org’s alerts.", action: "sign-in" },
};
export const ESCALATE_AFTER = 2;

// ── Placeholder + cascade constants ──────────────────────────────────────────────────────────────
/** The invisibility window rides on the placeholder's entrance — mirrored from Ascent's `.reveal-quiet`. */
export const GHOST_DELAY_MS = QUIET_PLACEHOLDER_DELAY_MS;
export const LATENCY = { warm: 40, slow: 900, race: 1400 } as const;
export type Latency = keyof typeof LATENCY;
export const CASCADE = { stepMs: 40, itemMs: 160, countCap: 8 } as const;
export const BUSY_TIMEOUT_MS = 4000;

/** Ghost bar widths, seeded by position: varied so rows read as data, stable so they never churn. */
export function ghostWidth(row: number, col: number): number {
  const v = ((row * 7 + col * 13) * 2654435761) >>> 0;
  return 40 + (v % 50);
}

export const SCENE_KEYFRAMES = `
@keyframes async-ghost-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes async-hold { from { opacity: 0; } to { opacity: 1; } }
@keyframes async-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes async-spin { to { transform: rotate(360deg); } }
`;

/** The placeholder's entrance: delayed in BOTH modes (the window is anti-flash, not decoration). */
export function ghostAnimation(reduced: boolean): string {
  return reduced ? `async-hold 1ms linear ${GHOST_DELAY_MS}ms both` : `async-ghost-in 200ms ease-out ${GHOST_DELAY_MS}ms both`;
}

/** A row's entrance on the loading → settled-data edge; `none` is the settled path. */
export function riseAnimation(index: number): string {
  return `async-rise ${CASCADE.itemMs}ms cubic-bezier(0.16, 1, 0.3, 1) ${Math.min(index, CASCADE.countCap - 1) * CASCADE.stepMs}ms both`;
}
