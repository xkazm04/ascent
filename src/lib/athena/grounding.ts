// GROUNDING — how Athena reaches this organization's real data, and the gate she reaches it through.
//
// She dispatches the SAME tools the MCP door serves (src/lib/mcp/tools.ts), in-process, through the
// same handlers (src/lib/mcp/handlers.ts). One catalog, one implementation, one serializer: an agent
// asking the MCP endpoint for `get_repo_standing` and Athena answering the same question from the
// dashboard must not be able to disagree about the fleet, and they cannot if neither owns a copy.
//
// ── THE GATE IS OURS, AND IT IS STRICTER THAN THE DOOR WE BORROWED FROM ─────────────────────────
//
// `runTool` PERFORMS NO TENANCY CHECK. Its own comment says so (handlers.ts): "Scope enforcement
// happens BEFORE this, in the route." The `org` argument goes straight into `getOrgRollup(org)`,
// `getActiveOrgStance(org)` and `candidateOrgMemories(org, …)` unvalidated, so a caller that reaches
// `runTool` without gating first has handed an arbitrary slug to a tenant read. This module therefore
// carries its own gate rather than assuming one ran upstream:
//
//   1. ORG READ, before ANY tool runs. `createAthenaGrounding` refuses as a whole — it returns null
//      and the turn never reaches a model — rather than refusing tool-by-tool. A caller who may not
//      read this org must not be able to spend its tokens either.
//
//   2. THE PLAN GATES, before a tool over a plan-gated resource. This block used to say the memory
//      gate was "a separate finding about the MCP route" that this module would not fix, because a
//      module has no business changing another door's authorization from the inside. That finding is
//      now FIXED at its own door: `src/app/api/mcp/gates.ts` resolves the same predicates per request
//      and `POST /api/mcp` refuses a plan-closed tool in words (moonshot #17). Both doors now gate,
//      and Athena remains the stricter of the two — she also refuses every WRITE tool outright.
//
//   3. NO WRITES, EVER. The catalog gained two tools that write (`cite_memory`,
//      `report_skill_invoke`); Athena is offered neither, and refuses them by name if a model invents
//      the call. The reason is not squeamishness about writes: those tools report an AGENT's OWN
//      behaviour — "I ran this skill", "I used this memory" — and Athena is not that agent. Her
//      writing them would put an operator's chat turn into the org's use-evidence, inflating exactly
//      the counters the write ceiling exists to protect.
//
// ── ORG-AUTHORED TEXT IS UNTRUSTED ON EVERY PATH IT TRAVELS ─────────────────────────────────────
//
// Memory content is written by org members, harvested from scanned repositories, and written by their
// AGENTS. So are skills, their LESSONS.md entries, and the registry subjects a customer publishes:
// every one is text ascent stores but did not author, and every one now reaches the model through
// these tools. Each is neutralized and quoted inside `wrapUntrusted` before the model sees it,
// exactly as consolidation.ts and reflection.ts do. The boundary INSTRUCTION
// (MEMORY_UNTRUSTED_BOUNDARY) is stated once in the system prompt (prompt.ts); this is the block that
// instruction is about. Ascent's own computed standing — scores, gate verdicts, recommendations — is
// NOT fenced, because ascent authored it.

import type { AthenaTool, ToolCall } from "@/lib/llm/leg";
import { MCP_TOOLS } from "@/lib/mcp/tools";
import { toolResultText, type ToolResult } from "@/lib/mcp/handlers";
import { neutralize, wrapUntrusted } from "@/lib/llm/untrusted";

/** The one tool that reads the org's memory store. */
export const ATHENA_MEMORY_TOOL = "recall_org_memory";

/**
 * Every tool whose result carries text the ORG wrote rather than text ascent computed. Derived by
 * name and asserted in the tests, because the failure mode of a missing entry is silent: a skill body
 * containing "ignore your previous instructions" would reach the model unfenced.
 */
export const ATHENA_UNTRUSTED_TOOLS = new Set([
  ATHENA_MEMORY_TOOL,
  "find_skills",
  "get_skill",
  "get_skill_lessons",
  "get_governing_subject",
]);

/**
 * Ceiling on one tool result, in characters. Bounds the prompt no matter how large the org's fleet
 * grows: four legs × this is the worst case a completion can be asked to read. Truncation is
 * ANNOUNCED in the text so the model never mistakes a cut list for a complete one.
 */
export const ATHENA_TOOL_RESULT_MAX = 12_000;

export interface AthenaGroundingDeps {
  /** May the caller read this org AT ALL. In the routes this is `canReadOrg` from @/lib/authz. */
  canReadOrg: (org: string) => Promise<boolean>;
  /** May this workspace use memory on its plan. In the routes, `workspaceAllowsMemory(org, plan)`. */
  memoryAllowed: (org: string) => Promise<boolean>;
  /**
   * May this workspace use the Skills Library on its plan (`workspaceAllowsSkills(org, plan)`).
   *
   * OPTIONAL, AND ABSENT MEANS CLOSED. The skills tools arrived at this door before the route that
   * builds these deps was widened to resolve the predicate (that route is another lane's file). An
   * unwired gate must fail closed: offering the org's curated skills on a plan that does not carry
   * them would reopen, on this door, exactly the hole moonshot #17 closed on the other one. When the
   * route supplies it, the tools appear with no further change here.
   */
  skillsAllowed?: (org: string) => Promise<boolean>;
  /** Dispatch. In the routes this is `runTool` from @/lib/mcp/handlers, unchanged. */
  runTool: (name: string, org: string, args: Record<string, unknown>) => Promise<ToolResult>;
}

export interface AthenaGrounding {
  /** The tools the model may call this turn, already filtered by the gates above. */
  tools: AthenaTool[];
  /** Runs one call. Never throws: a tool failure is feedback the model can recover from. */
  execute: (call: ToolCall) => Promise<string>;
}

/**
 * The catalog as the leg transports want it — the MCP definitions minus their server-side `scopes`.
 *
 * Filtered on the tool's OWN `mutates` marker and `planGate` rather than on a list kept here: a write
 * tool added by a future lane is refused to Athena the moment it is marked, with no edit to this file
 * and no chance of the list being forgotten.
 *
 * AND ON THE PRINCIPAL SCOPE, for the same structural reason. `mutates` catches the writes; it does
 * not catch `get_fix_brief`, which reads — but reads only rows a named HOLDER holds, and this runner
 * has no principal to be one (`runTool` fails it closed with "acts on this organization's work queue
 * on behalf of a named holder, and this call carried none"). Offering it was offering a tool whose
 * every invocation was a refusal: the model spends a turn on it, reports the capability as broken, and
 * the org's tokens paid for both. `followups:write` is the catalog's own marker for "this tool needs a
 * holder", so a future work tool disappears from here the moment it declares that scope.
 */
const PRINCIPAL_SCOPE = "followups:write" as const;

export function athenaToolCatalog(opts: { memoryAllowed: boolean; skillsAllowed?: boolean }): AthenaTool[] {
  const open = { memory: opts.memoryAllowed, skills: Boolean(opts.skillsAllowed) };
  return MCP_TOOLS.filter((t) => !t.mutates)
    .filter((t) => !t.scopes.includes(PRINCIPAL_SCOPE))
    .filter((t) => !t.planGate || open[t.planGate])
    .map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
}

const argsOf = (call: ToolCall): Record<string, unknown> =>
  call.args && typeof call.args === "object" && !Array.isArray(call.args) ? call.args : {};

/**
 * Build the grounding for one turn.
 *
 * Returns **null** when the caller may not read this org. Null is not an error state to be logged and
 * stepped over — it is the whole refusal, and the turn must stop on it BEFORE a model is called.
 * Refusing after the completion would mean the org's tokens were spent on a request that was never
 * allowed, which is the cheaper half of the same leak.
 */
export async function createAthenaGrounding(
  org: string,
  deps: AthenaGroundingDeps,
): Promise<AthenaGrounding | null> {
  const slug = (org ?? "").trim().toLowerCase();
  if (!slug) return null;
  if (!(await deps.canReadOrg(slug))) return null;

  // Resolved ONCE per turn (a plan lookup per tool call would be four round trips for one answer),
  // and then re-asserted inside `execute` — so a future refactor that builds an `execute` by some
  // other path still cannot dispatch the memory tool on a plan that does not carry it.
  const memoryAllowed = await deps.memoryAllowed(slug).catch(() => false);
  const skillsAllowed = deps.skillsAllowed ? await deps.skillsAllowed(slug).catch(() => false) : false;
  const tools = athenaToolCatalog({ memoryAllowed, skillsAllowed });
  const offered = new Set(tools.map((t) => t.name));

  const execute = async (call: ToolCall): Promise<string> => {
    const name = call?.name ?? "";

    // A WRITE TOOL IS REFUSED BY NAME, before the offered-tools check, so the answer explains itself
    // rather than reading as "that tool does not exist". Athena reports nobody's behaviour: the write
    // tools exist for the agent that did the work, and she did not do it.
    if (MCP_TOOLS.find((t) => t.name === name)?.mutates) {
      return `I can read this organization's data, but I do not write to it. "${name}" reports what an agent did with a skill or a memory, and that report has to come from the agent that did the work — not from me relaying a conversation.`;
    }

    // The plan gate is checked BEFORE the offered-tools check, and it answers with the REASON. The MCP
    // door deliberately conflates "no such tool" with "not yours" so an anonymous token cannot probe
    // an org's surface — but the caller here is Athena, answering an operator who is a member of this
    // org and who can act on the answer. "Memory is a Team-plan feature" is a fixable fact; "that tool
    // does not exist" is a dead end that would make her deny a capability the org can simply buy.
    if (name === ATHENA_MEMORY_TOOL && !memoryAllowed) {
      return "Shared Org Memory is a Team-plan feature and is not available for this workspace, so there is nothing recorded that I can read here.";
    }
    if (!skillsAllowed && MCP_TOOLS.find((t) => t.name === name)?.planGate === "skills") {
      return "The Skills Library is not available for this workspace, so there are no curated skills or registry subjects I can read here.";
    }
    if (!offered.has(name)) {
      // A name that is not in the catalog at all: a hallucinated tool. Reported as unavailable rather
      // than as an error, because a model that invents a tool recovers by using a real one.
      return `Tool "${name}" is not available on this turn.`;
    }

    let result: ToolResult;
    try {
      result = await deps.runTool(name, slug, argsOf(call));
    } catch (err) {
      return `Tool "${name}" failed: ${err instanceof Error ? err.message : String(err)}`;
    }

    // ONE serializer, lifted into handlers.ts, so this door and the MCP door show the model
    // byte-identical text for the same tool result.
    const raw = toolResultText(result);
    const text =
      raw.length > ATHENA_TOOL_RESULT_MAX
        ? `${raw.slice(0, ATHENA_TOOL_RESULT_MAX)}\n…[result truncated — this is not the whole list]`
        : raw;

    // Memory, skills, lessons and registry subjects are foreign-authored: the org wrote them, or its
    // agents did. Everything else here is ascent's own computed standing and is not fenced.
    return ATHENA_UNTRUSTED_TOOLS.has(name) ? wrapUntrusted(neutralize(text)) : text;
  };

  return { tools, execute };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// RECALL SURFACING — what is STORED is never filtered; what is SHOWN is.
//
// The chips above the answer are a claim: "this is what I already knew that bore on your question."
// Two failure modes make that claim worthless, and both are filtered here rather than in the store:
//
//   • THE ECHO. A memory that mostly repeats the operator's own sentence back at them tells them
//     nothing. It is still a perfectly good memory and it stays exactly where it is — it just does
//     not earn a chip.
//   • THE FRAGMENT. A memory whose first sentence is "See the runbook." has no insight to show. A
//     chip with nothing in it is worse than no chip: it advertises recall and then delivers a shrug.
//
// An EMPTY STRIP BEATS AN ECHO. When nothing survives, nothing is shown, and the answer stands on its
// own — which is what the answer was going to do anyway.
//
// The insight is derived MECHANICALLY (first sentence, cut on a word boundary). A second model call
// to summarise something already stored in one sentence would double the latency of the fastest phase
// of the turn to paraphrase text that is already a paraphrase.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** At most this many chips. Two fits above an answer without becoming a second answer. */
export const ATHENA_MAX_CHIPS = 2;
/** Below this share of shared words, a memory is saying something the operator did not just say. */
const ECHO_OVERLAP = 0.7;
/** An insight shorter than this is a fragment, not a thought. */
const MIN_INSIGHT_CHARS = 16;
/** Chips are read at a glance, so a chip is one short sentence. */
const MAX_INSIGHT_CHARS = 140;

export interface AthenaRecallChip {
  insight: string;
}

const STOP = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with", "is", "are", "was",
  "were", "be", "been", "it", "this", "that", "we", "our", "you", "your", "i", "do", "does", "did",
  "how", "what", "why", "when", "which", "should", "would", "can", "could", "at", "by", "from", "as",
]);

const words = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s/._-]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));

/** First sentence, whitespace collapsed, cut on a word boundary. Pure and deterministic. */
function firstSentence(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const end = flat.search(/[.!?](\s|$)/);
  const sentence = (end > 0 ? flat.slice(0, end + 1) : flat).trim();
  if (sentence.length <= MAX_INSIGHT_CHARS) return sentence;
  const cut = sentence.slice(0, MAX_INSIGHT_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > MAX_INSIGHT_CHARS / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Which recalled memories are worth SHOWING above this answer. Pure — no clock, no store — so the
 * filter is testable as a function of (memories, message) and nothing else.
 */
export function selectRecallChips(
  memories: { content: string }[],
  message: string,
): AthenaRecallChip[] {
  const asked = new Set(words(message ?? ""));
  const chips: AthenaRecallChip[] = [];
  for (const m of memories ?? []) {
    if (chips.length >= ATHENA_MAX_CHIPS) break;
    const content = typeof m?.content === "string" ? m.content : "";
    const insight = firstSentence(content);
    if (insight.length < MIN_INSIGHT_CHARS) continue; // the fragment

    const tokens = words(content);
    if (tokens.length > 0) {
      const shared = tokens.filter((t) => asked.has(t)).length;
      if (shared / tokens.length >= ECHO_OVERLAP) continue; // the echo
    }
    if (chips.some((c) => c.insight === insight)) continue;
    chips.push({ insight });
  }
  return chips;
}
