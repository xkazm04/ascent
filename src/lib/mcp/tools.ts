// The MCP tool catalog (W5) — the org's own standing, made readable by the agents that write its code.
//
// THE POINT OF THE DOOR. Ascent already ships the org's standard as files in a PR (the `.ai/`
// foundation, practice starters, skills). That reaches an agent at setup time. It does not reach the
// agent at the moment it is deciding how to write the next change — and that moment is where Port's
// "make the governed route the fastest route" either happens or does not. These tools put the fleet's
// standing, its gate verdict, its open gaps, its declared AI stance and its own proven practices one
// call away from the coding agent.
//
// READ-ONLY, DELIBERATELY. A write tool is a governance surface: it needs the stance model to
// authorize it, an audit actor that is a machine, and an answer to "what stops an agent closing its
// own recommendation". Those are real design questions, and shipping reads first answers the
// distribution question without pre-committing any of them.
//
// SCOPES ARE PER-TOOL, and `tools/list` filters by what the caller's token actually holds. The
// revision blesses this explicitly: the tool set "MAY vary by the authorization presented on the
// request … since credentials are per-request input, not connection state." So an agent is never
// shown a tool it would be refused, and granting the door does not grant the org's memory.

import type { SkillTokenScope } from "@/lib/db";

/** A tool definition plus the scope a caller must hold to see and call it. */
export interface McpToolDef {
  name: string;
  title: string;
  description: string;
  /** Every tool needs `mcp:read`; a tool over a scoped resource ALSO needs that resource's scope. */
  scopes: SkillTokenScope[];
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
