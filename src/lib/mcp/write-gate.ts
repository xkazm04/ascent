// THE WRITE DOOR'S POLICY TABLE (moonshot #17) — and the seam #3 (W4-N) extends.
//
// The MCP catalog was read-only "deliberately", and the reason given was honest: a write tool is a
// governance surface, and it needs an authorization model, a machine audit actor, and an answer to
// "what stops an agent inflating its own evidence". This file is that answer, and it is a TABLE
// rather than a chain of `if (tool === …)` for one specific reason: the next lane adds write tools
// (`claim_followup`, `report_work`), and the difference between "add a row" and "add a branch" is the
// difference between a contract and a place where a rule can be forgotten.
//
// So the extension contract is exactly two edits: one `WRITE_TOOL_POLICY` row and one handler. The
// structural test asserts the two halves cannot drift — every policy key is a tool marked `mutates`,
// and every tool marked `mutates` has a policy row — so a write tool added without a policy fails the
// suite rather than shipping ungated.
//
// WHAT A WRITE MUST CLEAR, in this order:
//   1. `telemetry:write` — the write scope. Never implied by `mcp:read`; a read token stays a read
//      token no matter which tools its org has bought.
//   2. The tool's own RESOURCE scope (`memory:read` for a citation, `skills:read` for an invoke
//      report). A caller may only write evidence ABOUT a resource it is allowed to read: a token that
//      cannot see the org's memory must not be able to vote on which memories are useful.
//   3. The PLAN gate — the same one the read side of that resource carries, resolved per request.
//   4. The per-token daily CEILING. Every write here is self-reported evidence that feeds a ranking,
//      so an aggressive or looping agent must not be able to bury the honest signal in its own
//      volume. The ceiling is anti-inflation, not anti-abuse; the rate limiter is the abuse control.
//
// PURE ON PURPOSE. Nothing here reads Prisma, the clock or the request. The counts arrive as numbers
// the route measured, so the whole policy is testable as a function of its inputs — and the route
// cannot accidentally satisfy a gate by handing it a live predicate that fails open.

import type { SkillTokenScope } from "@/lib/db";
import type { McpGates, McpPlanGate } from "@/app/api/mcp/gates";

export interface WriteToolPolicy {
  /** The resource scope this write needs BEYOND `mcp:read` + `telemetry:write`. */
  resourceScope: SkillTokenScope;
  /** The workspace-plan family, or null for a write over an ungated resource. */
  planGate: McpPlanGate | null;
  /**
   * The `AuditLog.action` this write records. One row per accepted write, never a batch summary.
   *
   * NAMES THE TOOL (`mcp.write.<tool>`), deviating from the spec's single `mcp.tool.write` id. The
   * ceiling below is declared PER TOOL and is counted from the audit trail, so one shared action id
   * would make every per-tool number a lie — the counter could not tell two tools apart without
   * scanning a JSON column. The `mcp.write.` prefix keeps the family greppable and readable in the
   * org's audit viewer, which is the second reason: "an agent cited a memory" is a more useful line
   * than "an agent wrote something".
   */
  auditAction: string;
  /**
   * How many of THIS write a single audit actor may make in a day. A ceiling, not a quota: it is set
   * where a well-behaved agent will never see it and a runaway one hits it within minutes.
   */
  perTokenDailyMax: number;
  /**
   * The natural key that makes a retried call a no-op, as a human-readable string — `null` when the
   * arguments do not carry one, which means the handler must NOT claim idempotency for that call.
   * This is a description of the store's own unique constraint, not a second implementation of it:
   * the database is what actually enforces uniqueness, and this exists so the audit row and the
   * refusal message can name the key the caller collided on.
   */
  idempotencyKey: (org: string, args: Record<string, unknown>) => string | null;
}

const argStr = (args: Record<string, unknown>, k: string): string | null => {
  const v = args[k];
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

/**
 * The table. FOUR rows: two evidence writes (#17) and two work-protocol writes (#3).
 *
 * The extension contract held exactly as written — #3 added rows and handlers and changed nothing in
 * this file's logic. Note what its third tool, `get_fix_brief`, is NOT: it reads a brief for rows the
 * caller already holds and mutates nothing, so it carries no `mutates` marker, no `telemetry:write`
 * and no row here. Marking a read as a write to make it "feel" gated would have broken the structural
 * test's own equivalence (mutating ⟺ `telemetry:write` ⟺ a policy row) and told a reader something
 * untrue about what the tool does. Its `followups:write` scope is what keeps it out of a read token's
 * catalog, which is the actual requirement.
 */
export const WRITE_TOOL_POLICY: Record<string, WriteToolPolicy> = {
  // MOONSHOT #3 — the work protocol. A claim takes rows off the org's own queue, so it is gated on
  // `followups:write` and on nothing else: there is no plan family behind the Follow-ups ledger,
  // which every org has by virtue of having been scanned. `planGate: null` is therefore a fact, not
  // an omission.
  //
  // The ceiling is deliberately LOW relative to the other two. This is not an anti-inflation ceiling
  // — a claim inflates no ranking — it is an anti-HOARDING one: an agent looping on
  // `claim_followups` could otherwise lease every open row in the fleet and make the ledger read
  // empty to everyone else until the leases lapsed. 60 calls a day is far past any honest session
  // and far short of a fleet.
  claim_followups: {
    resourceScope: "followups:write",
    planGate: null,
    auditAction: "mcp.write.claim_followups",
    perTokenDailyMax: 60,
    // NO IDEMPOTENCY KEY, and the honesty of that null is the point: the compare-and-set IS the
    // idempotency. A repeated claim of a row this token already holds is refused as `held` by the
    // database, and a claim with `count` instead of `ids` names no rows at all, so there is nothing
    // stable for a key to describe. Claiming one would make the audit row promise a guarantee this
    // call does not have.
    idempotencyKey: () => null,
  },
  // An attempt is the agent's own account of one row it holds — the same event the local lane writes
  // into `.ascent/lane-report.json`. It changes no judgement: `report_attempt` cannot reach
  // `status: "done"`, which only a rescan writes. The ceiling is the claim ceiling times a batch,
  // since an honest session reports once per row it took.
  report_attempt: {
    resourceScope: "followups:write",
    planGate: null,
    auditAction: "mcp.write.report_attempt",
    perTokenDailyMax: 600,
    // One verdict per row per token: a retried report re-states the same account of the same row,
    // and the handler's holder check makes the second call a no-op once the lease has been cleared.
    idempotencyKey: (org, args) => {
      const id = argStr(args, "id");
      return id ? `${org}/followup/${id}` : null;
    },
  },
  // A citation is a vote on whether a delivered memory helped. It feeds `OrgMemory.citedCount`, which
  // feeds recall ranking — the most inflatable thing this door exposes, hence the tightest ceiling
  // relative to plausible honest use (200 cited memories in one day is already an extreme session).
  cite_memory: {
    resourceScope: "memory:read",
    planGate: "memory",
    auditAction: "mcp.write.cite_memory",
    perTokenDailyMax: 200,
    idempotencyKey: (org, args) => {
      const id = argStr(args, "id");
      const session = argStr(args, "session");
      return id && session ? `${org}/memory/${id}#${session}` : null;
    },
  },
  // An invoke report is the agent's own claim that it ran a skill. It feeds the dormancy verdict and
  // the use tally, so the same inflation argument applies; the ceiling is higher because a single
  // long session legitimately invokes many skills many times.
  report_skill_invoke: {
    resourceScope: "skills:read",
    planGate: "skills",
    auditAction: "mcp.write.report_skill_invoke",
    perTokenDailyMax: 500,
    idempotencyKey: (org, args) => {
      const skill = argStr(args, "skill");
      const session = argStr(args, "session");
      return skill && session ? `${org}/skill/${skill}#${session}` : null;
    },
  },
};

export interface WriteGateInput {
  tool: string;
  scopes: readonly SkillTokenScope[];
  gates: McpGates;
  /** The verified token's id. Null only when the door was reached without one, which cannot happen. */
  tokenId: string | null;
  /**
   * Writes this audit actor has already made TODAY with this tool.
   *
   * `null` is an HONEST NULL and means the counter could not be measured — persistence is off. It
   * deliberately opens the gate rather than closing it, and that is safe for the one reason that
   * makes it true: with no persistence there is no row to inflate and no ranking to distort. It must
   * never be used to paper over a failed query; the route passes `null` only for the "no database"
   * case and lets a query failure surface.
   */
  writesToday: number | null;
}

/** The refusal, or `null` when the write may proceed. */
export interface WriteDenial {
  denied: string;
}

/**
 * Decide whether one write tool call may run. Pure.
 *
 * Every refusal is STATED, unlike the door's opaque scope refusal: this caller is past `tools/call`'s
 * scope filter, so it holds a tool the token was offered, and a write it can fix (grant the scope,
 * upgrade the plan, stop looping) is one it should be told about. The one thing no message names is
 * another org's data, and none of them can — every input here is about the caller itself.
 */
export function assertWriteAllowed(input: WriteGateInput): WriteDenial | null {
  const policy = WRITE_TOOL_POLICY[input.tool];
  // A tool with no policy row is refused even if the catalog marked it `mutates`. The structural test
  // makes that combination impossible to commit; this is the runtime half of the same rule, and it
  // fails CLOSED so a future half-finished write tool cannot write.
  if (!policy) return { denied: `"${input.tool}" is not a registered write tool at this door.` };

  const held = new Set(input.scopes);
  if (!held.has("telemetry:write")) {
    return {
      denied: `Writing requires the telemetry:write scope, which this token does not hold. Reading the organization's data never implies permission to report back to it.`,
    };
  }
  if (!held.has(policy.resourceScope)) {
    return {
      denied: `"${input.tool}" writes evidence about a resource this token cannot read, so it also may not write it. The ${policy.resourceScope} scope is required.`,
    };
  }
  if (policy.planGate && !input.gates[policy.planGate]) {
    return {
      denied: `"${input.tool}" writes to a resource this workspace's plan does not include, so there is nothing here to write to.`,
    };
  }
  if (!input.tokenId) {
    return { denied: `A write must be attributable to a token, and this request carried none.` };
  }
  if (input.writesToday !== null && input.writesToday >= policy.perTokenDailyMax) {
    return {
      denied: `This token has already made ${input.writesToday} ${input.tool} writes today, which is its daily ceiling of ${policy.perTokenDailyMax}. The ceiling exists so self-reported evidence cannot be inflated by volume; it resets daily, and nothing you have already reported is lost.`,
    };
  }
  return null;
}

/** Every tool name the table governs — the set the route runs `assertWriteAllowed` for. */
export function writeToolNames(): string[] {
  return Object.keys(WRITE_TOOL_POLICY).sort();
}
