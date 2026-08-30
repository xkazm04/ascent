// The org-registry tools: what this organization's own standard says, and the two ways an agent
// reports back what it did with it (moonshot #17).
//
// WHY THESE LIVE HERE AND NOT IN `handlers.ts`. The original handlers are projections of the FLEET's
// computed standing — scores, gate verdicts, recommendations, all of it ascent's own arithmetic. The
// tools below project a different thing: the org's CURATED corpus (its skills, the registry subjects
// that govern its work, the lessons it has recorded) plus the evidence channel back. Keeping them in
// their own module is what stops `handlers.ts` from becoming the place every future tool is appended
// to, and it draws the same line the write gate draws: reads of ascent's judgement over here, the
// org's own material over there.
//
// EVERY RESULT ANSWERS ABSENCE IN WORDS. An org with no registry mapped, a skill name that does not
// exist, a repo that has never been scanned: each is a sentence explaining what is missing and why,
// never an empty list. An agent handed `[]` reads "nothing to worry about" and proceeds; that is the
// exact failure this product exists to prevent.

import { listOrgSkills, recordSkillEvents, type SkillRow } from "@/lib/db";
import { recordMemoryCitation } from "@/lib/db/org-memory-citations";
import type { ToolResult } from "@/lib/mcp/handlers";

type Args = Record<string, unknown>;

const str = (a: Args, k: string): string | null => (typeof a[k] === "string" ? (a[k] as string).trim() : null);
const fail = (message: string): ToolResult => ({ structuredContent: { error: message }, text: message, isError: true });

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

/** Exact-name lookup over the org's skills. `null` = persistence off (a different fact from "absent"). */
async function findSkillByName(org: string, name: string): Promise<SkillRow | null | undefined> {
  const rows = await listOrgSkills(org, { search: name });
  if (rows === null) return null;
  return rows.find((r) => r.name.toLowerCase() === name.toLowerCase());
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
