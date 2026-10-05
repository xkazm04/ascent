// ONE entitlement decision for every Skills Library WRITE door.
//
// The Skills Library has four write doors — create (POST /api/org/skills), promote
// (POST /api/org/skills/promote), edit (PATCH|DELETE /api/org/skills/:id) and push
// (POST /api/org/skills/push) — and each used to re-decide the plan/personal entitlement inline.
// Three spelled out `workspaceAllowsSkills` + `personalSkillCapReached`; the fourth called
// `planAllowsSkillsLibrary` directly and never consulted the cap. The divergence IS intended (the
// CLI/CI push path does not extend the personal-workspace free tier) but it lived in prose beside
// four hand-copied call sites, which makes a deliberate exception indistinguishable from drift the
// day a fifth door is added.
//
// So the rule per door is a ROW in {@link SKILL_WRITE_DOORS}, a `Record` over the CLOSED
// {@link SkillWriteDoor} union: a fifth door cannot be added to the union without a row, because the
// Record stops typechecking. And the answer is an ENUMERATED decision, never a boolean — a gate that
// returns `false` has destroyed the information the caller needs to tell "your plan" from "this door
// is Team-only for personal workspaces" from "you are at 10 of 10".
//
// FAIL CLOSED: a door the table has no row for (a string that reached here from the wire, a row
// deleted by a bad merge) refuses with `unknown-door`. There is no path through this function that
// allows a write it could not name the reason for.
//
// NOTE on the tier source: the plan fact comes from `planAllowsSkillsLibrary` and the personal fact
// from `Organization.kind === "personal"`. `selfHosted()` is deliberately absent — it INFERS true
// when billing is unconfigured, so a managed deployment that lost its billing token would silently
// open every write door in the product. An authorization relaxation reads `selfHostedExplicit()` or
// nothing at all; this seam needs neither.

import { getCreditState, getPersonalUsage, isPersonalOrg, PERSONAL_SKILL_LIMIT } from "@/lib/db";
import { planAllowsSkillsLibrary } from "@/lib/plans";

/** The closed set of write doors. Adding one here forces a row in {@link SKILL_WRITE_DOORS}. */
export type SkillWriteDoor = "create" | "edit" | "promote" | "push";

const DOOR_NAMES = ["create", "edit", "promote", "push"] as const satisfies readonly SkillWriteDoor[];

export function isSkillWriteDoor(v: unknown): v is SkillWriteDoor {
  return typeof v === "string" && (DOOR_NAMES as readonly string[]).includes(v);
}

export interface SkillWriteDoorRule {
  /** Does the personal-workspace free path reach this door? False = Team+ only, whatever the kind. */
  personalPath: boolean;
  /** Does this door GROW the library, and so meet the personal cap? Edits/archives do not. */
  capApplies: boolean;
}

/**
 * The door table. Every cell of (door x tier) is decided here and nowhere else.
 *
 * `push: { personalPath: false }` is THE declared exception, now a row instead of a paragraph: the
 * CLI/CI push path does not extend the personal-workspace free tier.
 */
export const SKILL_WRITE_DOORS: Record<SkillWriteDoor, SkillWriteDoorRule> = {
  create: { personalPath: true, capApplies: true },
  promote: { personalPath: true, capApplies: true },
  // An edit (or an archive) replaces a row, it does not add one, so the cap is not its business.
  edit: { personalPath: true, capApplies: false },
  push: { personalPath: false, capApplies: false },
};

/** The declared state a decision is a pure function of. No I/O, no clock, no env. */
export interface SkillWriteState {
  /** Does the workspace's PLAN carry the Skills Library (`planAllowsSkillsLibrary`)? */
  planAllows: boolean;
  /** Is this a personal workspace (`Organization.kind === "personal"`)? */
  personal: boolean;
  /** Live (non-archived) skills in the workspace. Only read when the door's cap applies. */
  liveSkills: number;
}

/** The named outcomes. Each maps to exactly one status + message in {@link skillWriteDenial}. */
export type SkillWriteDecisionName =
  | "plan-allows"
  | "personal-allowance"
  | "plan-required"
  | "personal-door-closed"
  | "cap-reached"
  | "unknown-door";

export type SkillWriteDecision =
  | { allowed: true; decision: "plan-allows" }
  | { allowed: true; decision: "personal-allowance"; limit: number; remaining: number }
  | { allowed: false; decision: "plan-required" }
  | { allowed: false; decision: "personal-door-closed" }
  | { allowed: false; decision: "cap-reached"; limit: number }
  | { allowed: false; decision: "unknown-door" };

/**
 * The one predicate. Pure: same state in, same named decision out.
 *
 * Order is the invariant: plan first (a Team+ org never meets a cap), then the personal path, then
 * the door's own cap. Anything that is not a known door refuses.
 */
export function skillWriteDecision(door: SkillWriteDoor, state: SkillWriteState): SkillWriteDecision {
  const rule = SKILL_WRITE_DOORS[door];
  if (!rule) return { allowed: false, decision: "unknown-door" };
  if (state.planAllows) return { allowed: true, decision: "plan-allows" };
  if (!state.personal) return { allowed: false, decision: "plan-required" };
  if (!rule.personalPath) return { allowed: false, decision: "personal-door-closed" };
  const limit = PERSONAL_SKILL_LIMIT;
  if (rule.capApplies && state.liveSkills >= limit) return { allowed: false, decision: "cap-reached", limit };
  return {
    allowed: true,
    decision: "personal-allowance",
    limit,
    remaining: Math.max(0, limit - state.liveSkills),
  };
}

/** Every refusing decision, extracted from the union — what {@link skillWriteDenial} accepts. */
export type SkillWriteRefusal = Extract<SkillWriteDecision, { allowed: false }>;

/** The HTTP shape of a refusal. Pure — the route wraps it in `NextResponse.json(body, { status })`. */
export interface SkillWriteDenial {
  status: number;
  body: { error: string; decision: SkillWriteDecisionName };
}

/**
 * Decision -> status + message. The status codes are load-bearing for the CLI (403 = entitlement,
 * 402 = cap, so a client can tell "upgrade" from "archive one"); the `decision` name is what makes
 * the reason machine-readable instead of four routes returning one identical string.
 */
export function skillWriteDenial(decision: SkillWriteRefusal): SkillWriteDenial {
  switch (decision.decision) {
    case "plan-required":
      return { status: 403, body: { error: "The Skills Library is a Team-plan feature.", decision: "plan-required" } };
    case "personal-door-closed":
      return {
        status: 403,
        body: {
          error: "Pushing skills is a Team-plan path; a personal workspace cannot push to its library.",
          decision: "personal-door-closed",
        },
      };
    case "cap-reached":
      return {
        status: 402,
        body: {
          error: `Personal skills are capped at ${decision.limit}. Archive one to author another.`,
          decision: "cap-reached",
        },
      };
    case "unknown-door":
      return { status: 403, body: { error: "Unknown skills write door.", decision: "unknown-door" } };
  }
}

/**
 * Resolve the declared state from the workspace, then decide. The ONE call a write route makes.
 *
 * A Team+ plan short-circuits before any personal read (the common org path costs one credit read,
 * exactly what it cost when the chain was inline), and the live count is only fetched for a door
 * whose cap applies.
 */
export async function skillWriteGate(orgSlug: string, door: SkillWriteDoor): Promise<SkillWriteDecision> {
  if (!isSkillWriteDoor(door)) return { allowed: false, decision: "unknown-door" };
  const credit = await getCreditState(orgSlug).catch(() => null);
  if (planAllowsSkillsLibrary(credit?.plan)) {
    return skillWriteDecision(door, { planAllows: true, personal: false, liveSkills: 0 });
  }
  const personal = await isPersonalOrg(orgSlug).catch(() => false);
  let liveSkills = 0;
  if (personal && SKILL_WRITE_DOORS[door]?.capApplies) {
    const usage = await getPersonalUsage(orgSlug).catch(() => null);
    liveSkills = usage?.skills.used ?? 0;
  }
  return skillWriteDecision(door, { planAllows: false, personal, liveSkills });
}
