// THE ARM BUILDER'S EDIT STATE — what the operator is half-way through typing, as distinct from what
// the wire will accept.
//
// A draft is NOT an `Arm`. It carries two things an armed configuration has no business carrying: a
// stable React key (a row keeps its identity while its model is being retyped) and the operator's
// deliberate below-floor acknowledgement, which is a decision made in the dialog rather than a
// property of the run. Everything else is derived, and derived THROUGH `@/lib/local/arm` — the ids,
// the labels and every validation rule come from the module the route's validator also calls, because
// the way a panel and a validator stop agreeing is two lists.

import {
  MAX_COMPARE_ARMS,
  MIN_COMPARE_ARMS,
  normalizeArmSet,
  type Arm,
  type ArmPolicy,
  type PlanArm,
  type TransportId,
} from "@/lib/local/arm";

/**
 * The transport at or above the recorded capability floor for the PLANNING half.
 *
 * Today's floor is "Claude", recorded on 2026-09-21: the plan step fails closed, so a plan a local
 * model renders unreadable parks the whole batch rather than producing bad work. It is a measured
 * floor, not a permanent exemption — an arm below it is armable, marked, and counted.
 */
export const FLOOR_TRANSPORT: TransportId = "claude";

/**
 * Display names for the transport picker.
 *
 * GUESS, flagged: the real source is WP1's `allTransportProfiles()` (`transport/profile.ts`), which
 * still throws `not implemented`, so calling it from a render would take the panel down. Swap this map
 * for that registry the moment it returns.
 */
export const TRANSPORT_LABELS: Record<TransportId, string> = { claude: "Claude", pi: "Pi" };

/** The model token a freshly added row starts on. Pi's is empty: a local roster is whatever the
 *  operator pulled, and a pre-filled guess would be a model name this repo invented. */
export const DEFAULT_MODEL: Record<TransportId, string> = { claude: "sonnet", pi: "" };

export interface ArmDraft {
  /** Stable across edits — the row's React key, never sent. The wire id is derived at send time. */
  key: string;
  transport: TransportId;
  model: string;
  /** The "plan with a different model" disclosure, or null for "the executing half plans too". */
  plan: PlanArm | null;
  /** The operator ticked the below-floor opt-in for THIS row. UI-only. */
  floorAck: boolean;
}

let seq = 0;
export function newArmDraft(transport: TransportId = FLOOR_TRANSPORT): ArmDraft {
  seq += 1;
  return { key: `arm-${seq}`, transport, model: DEFAULT_MODEL[transport], plan: null, floorAck: false };
}

/** The planning half of a draft, resolved the same way `planArmOf` resolves an arm's. */
export function planHalf(d: ArmDraft): PlanArm {
  return d.plan ?? { transport: d.transport, model: d.model };
}

/** True when this row PLANS with a transport below the floor — the pure-local arm and the
 *  local-plans/Claude-executes inversion both land here; Claude-plans/local-executes does not. */
export function isBelowFloor(d: ArmDraft): boolean {
  return planHalf(d).transport !== FLOOR_TRANSPORT;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** A wire id that satisfies `arm.ts`'s ARM_ID and is unique within the set — the index suffix is what
 *  guarantees the second half, since two rows may legitimately name the same model. */
export function armIdOf(d: ArmDraft, index: number): string {
  const p = planHalf(d);
  const exec = slug(`${d.transport}-${d.model}`);
  const base = d.plan ? `${slug(`${p.transport}-${p.model}`)}-plan-${exec}` : exec;
  const suffix = `-${index + 1}`;
  const head = (base || "arm").slice(0, 40 - suffix.length);
  return `${head}${suffix}`.replace(/^-+/, "arm-");
}

/** One draft as the route will receive it. Plain data on purpose: the only validator is `arm.ts`'s. */
export function draftToWire(d: ArmDraft, index: number): Record<string, unknown> {
  return {
    id: armIdOf(d, index),
    // Empty label = let `normalizeArm` format the default one, which already reads a split arm as the
    // split it is ("claude:sonnet plan -> pi:qwen3.8:27b"). A second format here would be a second list.
    label: "",
    transport: d.transport,
    model: d.model.trim(),
    plan: d.plan ? { transport: d.plan.transport, model: d.plan.model.trim() } : null,
    ...(isBelowFloor(d) ? { belowFloor: true } : {}),
  };
}

export function draftsToWire(drafts: readonly ArmDraft[]): Record<string, unknown>[] {
  return drafts.map(draftToWire);
}

/** A row that is below the floor and has NOT been acknowledged. The opt-in is deliberate, so an
 *  un-ticked row is not silently dropped and not silently sent: the whole set is unarmable. */
export function needsFloorOptIn(d: ArmDraft): boolean {
  return isBelowFloor(d) && !d.floorAck;
}

/**
 * The armed set, or null when this configuration is not armable.
 *
 * Validation is `normalizeArmSet` and nothing else — the panel adds exactly one rule the wire cannot
 * express, the un-acknowledged below-floor row, because consent is a fact about the dialog rather
 * than about the run.
 */
export function draftsToArms(drafts: readonly ArmDraft[], policy: ArmPolicy): Arm[] | null {
  if (drafts.some(needsFloorOptIn)) return null;
  return normalizeArmSet(draftsToWire(drafts), policy);
}

/** The two fields the start body carries. Null when the set is not armable, so a caller cannot send
 *  half a configuration. */
export function armRequestFields(
  drafts: readonly ArmDraft[],
  policy: ArmPolicy,
): { armPolicy: ArmPolicy; arms: Record<string, unknown>[] } | null {
  if (!draftsToArms(drafts, policy)) return null;
  return { armPolicy: policy, arms: draftsToWire(drafts) };
}

export const canAddArm = (policy: ArmPolicy, count: number): boolean => policy === "compare" && count < MAX_COMPARE_ARMS;
export const canRemoveArm = (policy: ArmPolicy, count: number): boolean => policy === "compare" && count > MIN_COMPARE_ARMS;

/** Switching policy re-shapes the set: `single` keeps the first row, `compare` grows to the minimum. */
export function draftsForPolicy(drafts: readonly ArmDraft[], policy: ArmPolicy): ArmDraft[] {
  if (policy === "single") return drafts.slice(0, 1);
  const out = drafts.slice(0, MAX_COMPARE_ARMS);
  while (out.length < MIN_COMPARE_ARMS) out.push(newArmDraft());
  return out;
}

/**
 * THE WHOLE CONFIGURATION AS ONE STRING — what a probe verdict is a verdict ABOUT.
 *
 * Not just the transports: the probe's `model` check asks the server whether it actually holds the
 * model this arm names, so a typed-over model id invalidates the green light exactly as a swapped
 * transport does. Conservative on purpose — an over-eager re-probe costs a button press, and a
 * stale green light costs the hours the probe exists to protect.
 */
export function armsSignature(drafts: readonly ArmDraft[]): string {
  return JSON.stringify(draftsToWire(drafts));
}

/** The distinct transports a set will actually spawn — what the preflight probe has to clear. */
export function transportsOf(drafts: readonly ArmDraft[]): TransportId[] {
  const seen = new Set<TransportId>();
  for (const d of drafts) {
    seen.add(d.transport);
    if (d.plan) seen.add(d.plan.transport);
  }
  return [...seen];
}
