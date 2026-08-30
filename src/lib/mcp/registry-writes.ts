// The MCP write handlers (moonshot #17) — the two ways an agent reports back what it actually did.
//
// SPLIT FROM `registry-reads.ts` because the two halves have different rules, not because the file
// grew. A read here is a projection with no consequence; a write is gated by `write-gate.ts`, is
// ceilinged per token, records an audit row, and must be idempotent under replay. Keeping them in
// one module invites a future handler to be written in the reading style and quietly skip half of
// that. Athena refuses everything in this file outright.
//
// NEITHER TOOL CHANGES A JUDGEMENT THIS ORGANIZATION MADE. They record the agent’s own behaviour —
// “I ran this skill”, “I used this memory” — and nothing else. No recommendation is closed, no
// practice adopted, no memory edited. That boundary is what made a write door shippable at all.

import { recordSkillEvents } from "@/lib/db";
import { recordMemoryCitation } from "@/lib/db/org-memory-citations";
import { fail, findSkillByName, str, type Args } from "@/lib/mcp/registry-reads";
import type { ToolResult } from "@/lib/mcp/handlers";

/**
 * Timestamp quantization for a reported invoke, and the reason it exists.
 *
 * `OrgSkillEvent`'s idempotency key is `(session, skill, ts)` — a hash over all three. A retried tool
 * call (the transport dropped the response; the agent's harness re-sent) arrives seconds later with a
 * different `now`, so a raw wall-clock timestamp would produce a DIFFERENT key and the retry would be
 * recorded as a second invocation. Truncating to the hour makes the key stable across any retry
 * inside that hour, which is every realistic retry.
 *
 * The cost, stated: the event is recorded up to 59 minutes earlier than it happened. Nothing consumes
 * these timestamps at finer than day granularity (dormancy windows are measured in days, the backdate
 * clamp in 90 of them), so no reader can observe the difference — and the alternative, an invoke tally
 * that inflates on every network retry, is a number that would mean nothing at all.
 */
export const INVOKE_TS_BUCKET_MS = 3_600_000;

export function invokeEventTs(nowMs: number): string {
  return new Date(Math.floor(nowMs / INVOKE_TS_BUCKET_MS) * INVOKE_TS_BUCKET_MS).toISOString();
}
/**
 * `report_skill_invoke` — the agent's own claim that it ran a skill.
 *
 * The `invoke` event type was retired in July for having no producer, and un-retired by #19 because
 * the hook channel gave it one. This door is its second producer, and the two agree on the contract:
 * a sessioned event carries a dedupe key, so a retried report is dropped rather than double-counted.
 */
export async function reportSkillInvoke(org: string, args: Args, nowMs: number): Promise<ToolResult> {
  const name = str(args, "skill");
  const session = str(args, "session");
  if (!name) return fail("Provide `skill` — the name of the skill you ran.");
  if (!session) return fail("Provide `session` — your own session id. It is what makes a retried report idempotent.");

  const skill = await findSkillByName(org, name);
  if (skill === null) {
    return fail("This installation has no persistence configured, so a skill invocation cannot be recorded.");
  }
  if (!skill) {
    return fail(
      `"${name}" is not a skill in this organization's library, so there is nothing to report against. Call find_skills to see what it publishes.`,
    );
  }

  const { recorded } = await recordSkillEvents(org, [
    {
      skillId: skill.id,
      type: "invoke",
      source: "mcp",
      repo: str(args, "repo"),
      session,
      ts: invokeEventTs(nowMs),
    },
  ]);

  // A VERSION MISMATCH IS REPORTED, NOT SWALLOWED. An agent running a stale local copy of a skill is
  // acting on guidance this org has since changed, and that is worth more to it than the confirmation
  // it asked for. The invocation is still recorded — it happened.
  const claimed = str(args, "version");
  const current = skill.registryVersion;
  const stale = claimed && current && claimed !== current ? { claimed, current } : null;

  return {
    structuredContent: {
      skill: skill.name,
      recorded: recorded > 0,
      // `false` here means the report was a DUPLICATE of one already stored for this session, not
      // that it failed. Said plainly so an agent does not retry into a loop chasing a `true`.
      note:
        recorded > 0
          ? "Recorded."
          : "Already recorded for this session — one invocation per skill per session is counted, so nothing was added.",
      currentVersion: current,
      staleLocalCopy: stale,
      ...(stale
        ? {
            warning: `You reported version ${stale.claimed}; this organization publishes ${stale.current}. Your local copy is out of date — re-sync before relying on it.`,
          }
        : {}),
    },
  };
}

/**
 * `cite_memory` — the vote that finally distinguishes a memory that helped from one that was merely
 * delivered. See `src/lib/db/org-memory-citations.ts` for what the two counters do and do not mean.
 */
export async function citeMemory(org: string, args: Args): Promise<ToolResult> {
  const id = str(args, "id");
  const session = str(args, "session");
  const used = args.used;
  if (!id) return fail("Provide `id` — the memory's id, exactly as recall_org_memory returned it.");
  if (!session) return fail("Provide `session` — your own session id. One vote per memory per session.");
  if (typeof used !== "boolean") {
    // Deliberately strict: a missing `used` defaulted to `true` would turn every malformed call into
    // positive evidence, which is the one direction this counter must never drift.
    return fail("Provide `used` as a boolean: true if this memory was used, false if it did not help.");
  }

  const result = await recordMemoryCitation(org, {
    memoryId: id,
    sessionId: session,
    used,
    actor: str(args, "actor") ?? "mcp-agent",
    note: str(args, "note"),
  });

  if (result.outcome === "not-persisted") {
    return fail("This installation has no persistence configured, so a citation cannot be recorded.");
  }
  if (result.outcome === "unknown-memory") {
    // Gate-then-constrain: the query was already bounded by the token's org, so a foreign id is
    // simply not found. The message says that without confirming the id exists anywhere else.
    return fail(`No memory with id "${id}" belongs to this organization, so nothing was recorded.`);
  }

  return {
    structuredContent: {
      memoryId: id,
      used,
      outcome: result.outcome,
      counts: result.counts,
      basis:
        "These counts are self-reported by agents that read this memory. They record that someone said it was used, not that it demonstrably was.",
    },
  };
}
