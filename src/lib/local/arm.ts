// WHAT A LANE MAY BE ARMED WITH — one transport, one model, and optionally a DIFFERENT transport and
// model for the planning step. The successor to `agent-options.ts`'s model/effort pair, which could
// express "sonnet at high effort" and nothing else.
//
// The pair was adequate while there was exactly one thing to spawn. It stopped being adequate the
// moment the loop could spawn something that is not `claude`: a run is no longer described by a model
// name, because the same name means nothing without the transport that resolves it, and the whole
// point of the exercise — Claude plans, a local model executes — is a configuration the old shape
// cannot hold at all.
//
// DEPENDENCY-FREE ON PURPOSE (no `process`, no `node:*`): the cockpit's arm builder and the API
// route's validator have to agree exactly, and the way that stops being true is two lists. Environment
// resolution and spawning live in `transport/`, which the browser never loads. Same reasoning, and the
// same law, as agent-options.ts before it.

/** The agent CLIs this build can spawn. A closed list, because it reaches a re-parsing shell. */
export const TRANSPORT_IDS = ["claude", "pi"] as const;
export type TransportId = (typeof TRANSPORT_IDS)[number];

/**
 * A model token both ends accept.
 *
 * Deliberately a SHAPE rather than a list. `agent-options.ts` could keep a closed three-item roster
 * because every entry was a Claude alias; a local roster is whatever the operator has pulled, and an
 * enum of it would be a list this repo has to chase. The safety property the closed list actually
 * bought — that nothing shell-reparseable gets through — is the regex, and it is unchanged from the
 * one `agent.ts` and `claude-cli.ts` already apply at their own spawn doors.
 */
export const MODEL_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

/** The planning half of an arm, when it differs from the executing half. */
export interface PlanArm {
  transport: TransportId;
  model: string;
}

/**
 * ONE ARMED CONFIGURATION.
 *
 * `plan` absent means the executing half plans too — which is exactly what every run before this
 * type existed did, so an arm with no `plan` is the old behaviour written down rather than a new
 * default.
 */
export interface Arm {
  /** Stable slug, unique within a run: "claude", "claude-plan-local-exec", "local". */
  id: string;
  /** Human label the ledger and the theater print. */
  label: string;
  /** The transport that EXECUTES. */
  transport: TransportId;
  /** The model that executes. */
  model: string;
  /** A different transport/model for the planning step, or null/absent for "the same one". */
  plan?: PlanArm | null;
  /**
   * This arm plans with a transport below the recorded capability floor (see the floor's record in
   * docs/features/org-planning/live.md). Opt-in, always labelled, and its parked batches count as
   * failures rather than being discarded — that is what gives the floor a measurement which can one
   * day retire it, instead of a permanent exemption.
   */
  belowFloor?: boolean;
}

/** `single` = one arm drives the run. `compare` = N arms race the same curated batch. */
export type ArmPolicy = "single" | "compare";
export const ARM_POLICIES = ["single", "compare"] as const;

/** How many arms a `compare` run may carry. Two is a comparison; above four the wall clock of a
 *  serial local arm makes a run that never finishes, which is a worse answer than no answer. */
export const MIN_COMPARE_ARMS = 2;
export const MAX_COMPARE_ARMS = 4;

/** A slug/label both ends accept: printable, bounded, and nothing a shell re-parses. */
const ARM_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_LABEL = 60;

export function normalizeTransport(v: unknown): TransportId | null {
  return typeof v === "string" && (TRANSPORT_IDS as readonly string[]).includes(v) ? (v as TransportId) : null;
}

export function normalizeModel(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t && t.length <= 80 && MODEL_TOKEN.test(t) ? t : null;
}

function normalizePlanArm(v: unknown): PlanArm | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const transport = normalizeTransport(o.transport);
  const model = normalizeModel(o.model);
  return transport && model ? { transport, model } : null;
}

/**
 * Validate one arm off the wire. Returns null rather than throwing, and the caller decides whether a
 * null is a 400 or a dropped option — the same discipline `normalizeAgentModel` established.
 *
 * A malformed `plan` is NOT silently dropped to "plans with itself": that would quietly convert a
 * "Claude plans, local executes" arm into a pure-local one and record the result under the wrong
 * name. A bad plan half fails the whole arm.
 */
export function normalizeArm(v: unknown): Arm | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = typeof o.id === "string" && ARM_ID.test(o.id.trim()) ? o.id.trim() : null;
  const transport = normalizeTransport(o.transport);
  const model = normalizeModel(o.model);
  if (!id || !transport || !model) return null;
  let plan: PlanArm | null = null;
  if (o.plan != null) {
    plan = normalizePlanArm(o.plan);
    if (!plan) return null;
  }
  const rawLabel = typeof o.label === "string" ? o.label.trim().slice(0, MAX_LABEL) : "";
  return {
    id,
    label: rawLabel || defaultArmLabel({ transport, model, plan }),
    transport,
    model,
    plan,
    ...(o.belowFloor === true ? { belowFloor: true } : {}),
  };
}

/**
 * Validate a whole arm set for a policy. `single` takes exactly one; `compare` takes 2..4 with
 * DISTINCT ids, because the ids are what join a lane row back to the arm that produced it — two arms
 * sharing an id would silently pool two populations into one number.
 */
export function normalizeArmSet(v: unknown, policy: ArmPolicy): Arm[] | null {
  if (!Array.isArray(v)) return null;
  const arms: Arm[] = [];
  for (const raw of v) {
    const arm = normalizeArm(raw);
    if (!arm) return null;
    arms.push(arm);
  }
  if (new Set(arms.map((a) => a.id)).size !== arms.length) return null;
  if (policy === "single") return arms.length === 1 ? arms : null;
  return arms.length >= MIN_COMPARE_ARMS && arms.length <= MAX_COMPARE_ARMS ? arms : null;
}

export function normalizeArmPolicy(v: unknown): ArmPolicy | null {
  return typeof v === "string" && (ARM_POLICIES as readonly string[]).includes(v) ? (v as ArmPolicy) : null;
}

/** The planning half, resolved: an explicit `plan`, else the executing half itself. */
export function planArmOf(arm: Arm): PlanArm {
  return arm.plan ?? { transport: arm.transport, model: arm.model };
}

/** True when an arm's two halves differ — the "Claude plans, local executes" shape. */
export function isSplitArm(arm: Arm): boolean {
  const p = planArmOf(arm);
  return p.transport !== arm.transport || p.model !== arm.model;
}

function defaultArmLabel(a: { transport: TransportId; model: string; plan?: PlanArm | null }): string {
  const exec = `${a.transport}:${a.model}`;
  if (!a.plan) return exec;
  return `${a.plan.transport}:${a.plan.model} plan -> ${exec}`;
}

/**
 * The one line a ledger, a theater header or an outcome row prints for an arm.
 *
 * Null renders NOTHING rather than "default" — a lane recorded before arms existed has an unknown
 * configuration, and "default" would be a claim about it. Same rule, verbatim, as
 * `agentConfigLabel`, which this replaces for arm-aware surfaces.
 */
export function armLabel(arm: Arm | null | undefined): string | null {
  if (!arm) return null;
  return arm.label || defaultArmLabel(arm);
}

/** Serialize for `LoopRun.armsJson` (TEXT on DSQL — there is no jsonb). */
export function serializeArms(arms: Arm[]): string {
  return JSON.stringify(arms);
}

/** Read `LoopRun.armsJson` back. A row written before arms existed, or corrupt, yields [] — never a
 *  fabricated single arm, because "which arm ran this" is precisely what such a row cannot answer. */
export function parseArms(json: string | null | undefined): Arm[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeArm).filter((a): a is Arm => a !== null);
  } catch {
    return [];
  }
}
