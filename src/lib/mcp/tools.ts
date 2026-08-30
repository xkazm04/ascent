// The MCP tool catalog (W5) — the org's own standing, made readable by the agents that write its code.
//
// THE POINT OF THE DOOR. Ascent already ships the org's standard as files in a PR (the `.ai/`
// foundation, practice starters, skills). That reaches an agent at setup time. It does not reach the
// agent at the moment it is deciding how to write the next change — and that moment is where Port's
// "make the governed route the fastest route" either happens or does not. These tools put the fleet's
// standing, its gate verdict, its open gaps, its declared AI stance and its own proven practices one
// call away from the coding agent.
//
// MOSTLY READS, AND TWO WRITES THAT EARNED THEIR DOOR. This catalog shipped read-only, and the
// reason given was that a write tool is a governance surface needing an authorization model, a
// machine audit actor, and an answer to "what stops an agent closing its own recommendation". Those
// questions are now answered rather than deferred, and the answers are what the write tools are
// allowed to be: they report the agent's OWN behaviour (it ran this skill; it used this memory) and
// they change no judgement the org made. Nothing here closes a recommendation, adopts a practice or
// edits a memory — the write door is for evidence, not for decisions. A write tool carries
// `mutates: true`, needs `telemetry:write` on top of the resource scope it writes about, is gated by
// `src/lib/mcp/write-gate.ts`, records one audit row per accepted call, and is refused outright to
// Athena.
//
// SCOPES ARE PER-TOOL, and `tools/list` filters by what the caller's token actually holds. The
// revision blesses this explicitly: the tool set "MAY vary by the authorization presented on the
// request … since credentials are per-request input, not connection state." So an agent is never
// shown a tool it would be refused, and granting the door does not grant the org's memory.

import type { SkillTokenScope } from "@/lib/db";

/** The plan-gated resource families the catalog knows about (see `src/app/api/mcp/gates.ts`). */
export type McpPlanGate = "memory" | "skills";

/** A tool definition plus the scope a caller must hold to see and call it. */
export interface McpToolDef {
  name: string;
  title: string;
  description: string;
  /** Every tool needs `mcp:read`; a tool over a scoped resource ALSO needs that resource's scope. */
  scopes: SkillTokenScope[];
  /**
   * The workspace-plan family this tool reads or writes, resolved per REQUEST by the route — scopes
   * say what this token may do, a plan says what this workspace has. They are different questions and
   * the catalog cannot answer the second one, which is why this is a marker and not a predicate.
   */
  planGate?: McpPlanGate;
  /**
   * Present and `true` on a tool that WRITES. The marker is what makes "is this a write?" a property
   * of the catalog rather than a list maintained somewhere else that a new tool can be forgotten
   * from: the route runs `assertWriteAllowed` on exactly the tools carrying it, and
   * `src/lib/mcp/write-gate.ts` asserts structurally that every policy row is a marked tool and every
   * marked tool has a policy row. Athena refuses every tool carrying it outright.
   */
  mutates?: true;
  inputSchema: Record<string, unknown>;
}

const repoArg = {
  type: "object",
  properties: {
    repo: { type: "string", description: 'Repository as "owner/name". Omit for the whole fleet.' },
  },
  additionalProperties: false,
} as const;

/**
 * The catalog. ORDER IS LOAD-BEARING and alphabetical by name: the revision asks servers to return
 * tools deterministically so clients can cache the list and so the tool block stays byte-identical
 * across calls, which is what keeps an LLM's prompt cache warm.
 */
export const MCP_TOOLS: readonly McpToolDef[] = [
  {
    name: "cite_memory",
    title: "Cite a recalled memory",
    description:
      "Report whether a memory this door delivered to you was actually USED in what you did, or was " +
      "read and did not help. This is the only evidence of usefulness the memory store can have — " +
      "without it, a memory that answered your question and one you ignored look identical. Call it " +
      "with the `id` from a recall_org_memory entry, once per memory per session.",
    scopes: ["mcp:read", "memory:read", "telemetry:write"],
    planGate: "memory",
    mutates: true,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The memory's `id`, exactly as recall_org_memory returned it." },
        used: { type: "boolean", description: "True if you used this memory; false if it did not help." },
        session: {
          type: "string",
          description:
            "Your own session id. One vote per memory per session — re-sending revises your vote rather than adding one.",
        },
        note: { type: "string", description: "One line on how it applied, or why it did not. Optional." },
      },
      required: ["id", "used", "session"],
      additionalProperties: false,
    },
  },
  {
    name: "get_ai_stance",
    title: "AI stance",
    description:
      "The organization's declared position on AI-assisted development: permitted tools and models, " +
      "no-AI path zones, per-tier review requirements, and whether an AI-attributed change requires a " +
      "human approval before merge. Read this before writing code with an agent in this org.",
    scopes: ["mcp:read"],
    inputSchema: { type: "object", additionalProperties: false },
  },
  {
    name: "get_gate_verdict",
    title: "CI gate verdict",
    description:
      "Whether a repository currently clears the organization's maturity gate, and every specific " +
      "condition it fails. Use before opening a pull request to see what would block it.",
    scopes: ["mcp:read"],
    inputSchema: {
      type: "object",
      properties: { repo: { type: "string", description: 'Repository as "owner/name".' } },
      required: ["repo"],
      additionalProperties: false,
    },
  },
  {
    name: "get_practice_shape",
    title: "Practice shape",
    description:
      "The reusable SHAPE of a practice this organization already does well: what the artifact " +
      "covers and which repository exemplifies it, without copying that repository's proprietary code. " +
      "Use to match the house style instead of inventing one.",
    scopes: ["mcp:read"],
    inputSchema: {
      type: "object",
      properties: {
        practiceId: { type: "string", description: "Practice id, e.g. agent-guidance. Omit to list all." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_repo_standing",
    title: "Repository standing",
    description:
      "How a repository (or the whole fleet) scores on the AI-native maturity model: overall level, " +
      "adoption vs rigor, and the per-dimension breakdown. Use to understand what this codebase is " +
      "already strong or weak at before changing it.",
    scopes: ["mcp:read"],
    inputSchema: repoArg as unknown as Record<string, unknown>,
  },
  {
    name: "list_open_recommendations",
    title: "Open recommendations",
    description:
      "The organization's open, tracked improvement recommendations: the gaps it has already decided " +
      "matter. Use to align an opportunistic change with work the org has actually prioritized.",
    scopes: ["mcp:read"],
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string", description: 'Repository as "owner/name". Omit for the whole fleet.' },
        limit: { type: "integer", minimum: 1, maximum: 50, description: "Max items (default 10)." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "recall_org_memory",
    title: "Recall org memory",
    description:
      "Search the organization's durable engineering memory (decisions, incidents and conventions it " +
      "has chosen to remember). Use before proposing an approach someone here has already ruled on.",
    // Two scopes: the door AND the resource. An `mcp:read`-only token does not silently gain memory.
    scopes: ["mcp:read", "memory:read"],
    planGate: "memory",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What you are about to do or decide." },
        limit: { type: "integer", minimum: 1, maximum: 20, description: "Max entries (default 5)." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "report_skill_invoke",
    title: "Report a skill invocation",
    description:
      "Tell this organization that you actually ran one of its skills. The Skills Library ranks and " +
      "retires skills on whether they are used, and an agent invoking a skill locally is invisible to " +
      "it otherwise — an unreported skill reads as dormant however often it runs. Report once per " +
      "skill per session; a repeat with the same session is not counted twice.",
    scopes: ["mcp:read", "skills:read", "telemetry:write"],
    planGate: "skills",
    mutates: true,
    inputSchema: {
      type: "object",
      properties: {
        skill: { type: "string", description: "The skill's name, as find_skills or get_skill returned it." },
        session: { type: "string", description: "Your own session id — the deduplication key." },
        version: {
          type: "string",
          description:
            "The version of the skill you ran, if your local copy declares one. Reported back to you when it does not match this organization's current version.",
        },
        repo: { type: "string", description: 'The repository you ran it against, as "owner/name". Optional.' },
      },
      required: ["skill", "session"],
      additionalProperties: false,
    },
  },
] as const;

/** The tools a caller holding `granted` may see and call. Pure. */
export function toolsForScopes(granted: readonly SkillTokenScope[]): McpToolDef[] {
  const held = new Set(granted);
  return MCP_TOOLS.filter((t) => t.scopes.every((s) => held.has(s)));
}

/** The wire shape of a tool — the catalog minus the server-side `scopes` field. */
export function toWireTool(t: McpToolDef): Record<string, unknown> {
  return { name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema };
}

/**
 * How long a client may cache `tools/list`. The catalog is a compile-time constant, so the only thing
 * that changes a caller's list is their token's scopes changing — an hour is a safe hint, and the
 * revision treats `ttlMs` as a freshness hint rather than a contract.
 *
 * `cacheScope` is PRIVATE, not public: the list varies by the caller's granted scopes, so a shared
 * intermediary caching one caller's list and serving it to another would leak which tools that org's
 * token can reach — and could hand an agent a tool it will then be refused.
 */
export const TOOLS_TTL_MS = 3_600_000;
export const TOOLS_CACHE_SCOPE = "private" as const;
