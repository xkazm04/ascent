// The MCP tool catalog (W5) — the org's own standing, made readable by the agents that write its code.
//
// THE POINT OF THE DOOR. Ascent already ships the org's standard as files in a PR (the `.ai/`
// foundation, practice starters, skills). That reaches an agent at setup time. It does not reach the
// agent at the moment it is deciding how to write the next change — and that moment is where Port's
// "make the governed route the fastest route" either happens or does not. These tools put the fleet's
// standing, its gate verdict, its open gaps, its declared AI stance and its own proven practices one
// call away from the coding agent.
//
// MOSTLY READS, AND FOUR WRITES THAT EARNED THEIR DOOR. This catalog shipped read-only, and the
// reason given was that a write tool is a governance surface needing an authorization model, a
// machine audit actor, and an answer to "what stops an agent closing its own recommendation". Those
// questions are now answered rather than deferred. Two of the writes report the agent's OWN
// behaviour (it ran this skill; it used this memory). The other two (moonshot #3) operate the org's
// WORK QUEUE: `claim_followups` leases rows so one agent works them at a time, `report_attempt`
// records what happened. A write tool carries `mutates: true`, needs `telemetry:write` on top of the
// resource scope it writes about, is gated by `src/lib/mcp/write-gate.ts`, records one audit row per
// accepted call, and is refused outright to Athena.
//
// AND HERE IS THE ANSWER TO THE QUESTION THIS COMMENT USED TO DEFER. What stops an agent closing its
// own recommendation is that the write path HAS NO VERB THAT CLOSES ONE. `status: "done"` is
// reachable only from a rescan of the default branch that both stops restating the gap and measures
// its dimension moving (`scans-persist`'s `decideInProgress`). A claim is a lease, an attempt is an
// account, a commit trailer is a hint — three ways to say "I did this" and no way to say "and it
// counted". Ascent adjudicates and never executes; that is the whole reason a vendor-neutral queue
// is safe to open.
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
    name: "claim_followups",
    title: "Claim follow-ups to work",
    description:
      "Take one or more of this organization's open follow-ups off its queue so you can work them, " +
      "with a time-limited lease nobody else can work them under. This is a pull queue any coding " +
      "agent can serve: Ascent runs nothing itself, it adjudicates. Name `ids` from " +
      "list_open_recommendations, or give a `count` and take the highest-value open items for a " +
      "repository. A lease you let expire releases the rows back to the queue, so report before it does.",
    scopes: ["mcp:read", "followups:write", "telemetry:write"],
    mutates: true,
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string", description: 'The repository to claim work in, as "owner/name".' },
        ids: {
          type: "array",
          items: { type: "string" },
          description: "Recommendation ids to claim. Omit to take the top `count` open items for the repository.",
        },
        count: { type: "integer", minimum: 1, maximum: 10, description: "How many to take when `ids` is omitted (default 3)." },
        leaseMinutes: {
          type: "integer",
          minimum: 5,
          maximum: 240,
          description: "How long you need the rows for (default 45). Ask for what your session will actually take.",
        },
      },
      required: ["repo"],
      additionalProperties: false,
    },
  },
  {
    name: "compare_against_exemplar",
    title: "Compare against an exemplar",
    description:
      "How one repository compares, signal by signal, against a named peer: another repository in " +
      "this organization, the organization's own strongest repository, or the public top decile for a " +
      "language or team shape. Answers the question a score cannot — not 'how good is this repo' but " +
      "'what specifically does a better one have that this one does not', joined to the practice that " +
      "carries each gap. A private repository cannot be compared against a public cohort.",
    scopes: ["mcp:read"],
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string", description: 'The repository to compare, as "owner/name".' },
        against: {
          type: "string",
          description:
            'The exemplar: "owner/name", "org:best", "org:best:D3", "cohort:lang:TypeScript" or "cohort:archetype:team".',
        },
      },
      required: ["repo", "against"],
      additionalProperties: false,
    },
  },
  {
    name: "find_skills",
    title: "Find applicable skills",
    description:
      "Which of this organization's own curated skills apply to the task you are about to do. These " +
      "are the house's proven ways of doing things, written by the people who work here — matching one " +
      "is how you write code that looks like it belongs. Name the repository too and the ranking also " +
      "weights the dimensions that repository is measurably weakest in.",
    scopes: ["mcp:read", "skills:read"],
    planGate: "skills",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "What you are about to do, in a sentence." },
        repo: { type: "string", description: 'Repository as "owner/name". Optional; sharpens the ranking.' },
        limit: { type: "integer", minimum: 1, maximum: 25, description: "Max skills (default 5)." },
      },
      required: ["task"],
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
    name: "get_fix_brief",
    title: "Brief for claimed follow-ups",
    description:
      "The working brief for follow-ups YOU currently hold: each gap as the scan stated it, plus the " +
      "perimeter this organization declared — its permitted tools and models, its no-AI path zones, " +
      "the repository's autonomy tier and its review requirement, and when your lease expires. Read " +
      "this before changing anything. A row somebody else holds is refused by id rather than dropped, " +
      "so you always know which of your ids you no longer have.",
    // Reads only, so no `mutates` and no telemetry:write. The `followups:write` scope is still
    // required: a brief is only ever built for rows the caller HOLDS, and only a token that can
    // claim can hold one — so a read-only token seeing this tool would only ever be refused by it.
    scopes: ["mcp:read", "followups:write"],
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, description: "The recommendation ids you hold." },
      },
      required: ["ids"],
      additionalProperties: false,
    },
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
    name: "get_governing_subject",
    title: "Governing registry subject",
    description:
      "The subject in this organization's AI registry whose declared `use_when` governs the file you " +
      "are about to change or the decision you are about to make. This is the organization's own " +
      "written standard, not a general best practice — read it before choosing an approach in a " +
      "domain it covers, and follow the returned `file` path into the registry for the full text.",
    scopes: ["mcp:read", "skills:read"],
    planGate: "skills",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repo-relative path of the file you are about to change." },
        topic: { type: "string", description: "What you are deciding, if there is no single file." },
      },
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
    name: "get_skill",
    title: "Read a skill",
    description:
      "The full text of one of this organization's skills — the SKILL.md body it publishes, plus its " +
      "version, content hash and registry path. Read this before following a skill you found with " +
      "find_skills; the summary in a search result is not the instruction.",
    scopes: ["mcp:read", "skills:read"],
    planGate: "skills",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "The skill's name, as find_skills returned it." } },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "get_skill_lessons",
    title: "Lessons from a skill",
    description:
      "What people and agents in this organization actually learned running a skill: the entries from " +
      "its LESSONS.md, grouped by the version they were learned against. These are experience reports " +
      "— where the skill was awkward, what it missed — and they are the fastest way to avoid repeating " +
      "a mistake this organization has already made.",
    scopes: ["mcp:read", "skills:read"],
    planGate: "skills",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "The skill's name." } },
      required: ["name"],
      additionalProperties: false,
    },
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
    name: "report_attempt",
    title: "Report an attempt on a follow-up",
    description:
      "Tell this organization what you did with ONE follow-up you hold: `resolved`, `skipped` or " +
      "`needs_human`, with one sentence of reason and the branch or pull request if you opened one. " +
      "Your verdict is your ACCOUNT, not the ruling — nothing you can call here closes a row. A " +
      "follow-up closes only when this organization's next scan of the default branch stops raising " +
      "the gap and its dimension measurably moves. Report before your lease expires.",
    scopes: ["mcp:read", "followups:write", "telemetry:write"],
    mutates: true,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The recommendation id, as claim_followups returned it." },
        verdict: {
          type: "string",
          enum: ["resolved", "skipped", "needs_human"],
          description:
            "resolved = you believe you fixed it (the rescan rules on that). skipped = you did not, and the row returns to the queue. needs_human = you stopped deliberately and a person is needed.",
        },
        reason: { type: "string", description: "One sentence in your own words. Required — a verdict with no reason is not an account." },
        branch: { type: "string", description: "The branch your work is on, if any." },
        prUrl: { type: "string", description: "The pull request you opened, if any." },
      },
      required: ["id", "verdict", "reason"],
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
