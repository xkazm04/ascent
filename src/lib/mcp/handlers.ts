// MCP tool handlers (W5) — the adapter layer between the protocol and reads that already exist.
//
// Every handler here is a projection of a shipped function. Nothing computes a new number, and
// nothing reaches past what the calling token's scopes allow. If a handler ever needs its own
// arithmetic, that arithmetic belongs in the module that owns the data, not here — otherwise the
// agent door and the dashboard would eventually disagree about the same fact.
//
// SHAPE OF EVERY RESULT. Each returns `structuredContent` (the machine payload, matching the tool's
// declared meaning) AND a `content` text block carrying the same data serialized. The revision keeps
// `content` as the universally-understood channel and treats `structuredContent` as the typed one;
// returning both is what the spec recommends for compatibility.
//
// ABSENCE IS ANSWERED, NEVER FAKED. A repo with no scan, an org with no stance, a memory search with
// no hit — each returns an explicit "not available, and here is why" rather than an empty object the
// model would read as "nothing to worry about". An agent acting on a silent absence is exactly the
// failure this product spends its whole surface avoiding.

import { candidateOrgMemories, getOrgRecommendations, getOrgRollup } from "@/lib/db";
import { getOrgGatePolicy } from "@/lib/db/org-gate";
import { getActiveOrgStance } from "@/lib/db/org-stance";
import { defaultGatePolicy, describeGatePolicy, evaluateGateLite } from "@/lib/scoring/gate";
import { PRACTICES } from "@/lib/practices";

export interface ToolResult {
  structuredContent: unknown;
  /** Human/model-readable text. Defaults to the JSON of structuredContent when omitted. */
  text?: string;
  isError?: boolean;
}

type Args = Record<string, unknown>;

const str = (a: Args, k: string): string | null => (typeof a[k] === "string" ? (a[k] as string).trim() : null);
const num = (a: Args, k: string, dflt: number, max: number): number => {
  const v = a[k];
  const n = typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? Math.max(1, Math.min(max, Math.floor(n))) : dflt;
};

/** A tool-execution error — actionable feedback the model can self-correct from (`isError: true`). */
const fail = (message: string): ToolResult => ({ structuredContent: { error: message }, text: message, isError: true });

async function repoStanding(org: string, args: Args): Promise<ToolResult> {
  const rollup = await getOrgRollup(org);
  if (!rollup) return fail(`No data for organization "${org}".`);
  const repo = str(args, "repo");

  if (repo) {
    const row = rollup.repos.find((r) => r.fullName.toLowerCase() === repo.toLowerCase());
    if (!row) return fail(`Repository "${repo}" is not in this organization's fleet.`);
    if (!row.latest) {
      return fail(`"${repo}" is in the fleet but has never been scanned, so it has no standing to report.`);
    }
    return {
      structuredContent: {
        repo: row.fullName,
        level: row.latest.level,
        overall: row.latest.overall,
        adoption: row.latest.adoption,
        rigor: row.latest.rigor,
        posture: row.latest.posture,
        scannedAt: row.latest.scannedAt,
        // The engine is surfaced because "mock" is the deterministic floor, not a graded scan — an
        // agent weighing this score deserves to know which produced it.
        engine: row.latest.engine,
        dimensions: row.latest.dims,
      },
    };
  }

  const scanned = rollup.repos.filter((r) => r.latest);
  return {
    structuredContent: {
      org,
      reposScanned: scanned.length,
      reposTotal: rollup.repos.length,
      avgOverall: rollup.avgOverall,
      avgAdoption: rollup.avgAdoption,
      avgRigor: rollup.avgRigor,
      repos: scanned.map((r) => ({ repo: r.fullName, level: r.latest!.level, overall: r.latest!.overall })),
    },
  };
}

async function gateVerdict(org: string, args: Args): Promise<ToolResult> {
  const repo = str(args, "repo");
  if (!repo) return fail("Provide a repository as \"owner/name\".");
  const rollup = await getOrgRollup(org);
  const row = rollup?.repos.find((r) => r.fullName.toLowerCase() === repo.toLowerCase());
  if (!row) return fail(`Repository "${repo}" is not in this organization's fleet.`);
  if (!row.latest) return fail(`"${repo}" has never been scanned, so no gate verdict exists yet.`);

  // The SAME evaluator and the SAME persisted policy the CI gate and the dashboard use — an agent
  // must never be told it would pass a bar that CI then blocks.
  const policy = (await getOrgGatePolicy(org)) ?? defaultGatePolicy("org");
  const verdict = evaluateGateLite(
    {
      level: row.latest.level,
      overall: row.latest.overall,
      posture: row.latest.posture,
      dims: row.latest.dims,
      protected: row.latest.protected,
      govReadable: row.latest.govReadable,
      aiGovernedRate: row.latest.aiGovernedRate,
      aiPrSample: row.latest.aiPrSample,
    },
    policy,
  );
  return {
    structuredContent: {
      repo: row.fullName,
      pass: verdict.pass,
      failures: verdict.failures.map((f) => ({ code: f.code, message: f.message })),
      policy: describeGatePolicy(policy).map((c) => c.text),
      // Said plainly: the verdict reflects the repo's LAST SCAN, not the working tree the agent is
      // about to change. A model that assumes otherwise would report a stale pass as a guarantee.
      basis: `Evaluated against ${row.fullName}'s latest scan (${row.latest.scannedAt}), not your working tree.`,
    },
  };
}

async function openRecommendations(org: string, args: Args): Promise<ToolResult> {
  const limit = num(args, "limit", 10, 50);
  const recs = await getOrgRecommendations(org, limit);
  if (!recs) return fail(`No data for organization "${org}".`);
  const repo = str(args, "repo");
  const scoped = repo ? recs.filter((r) => r.repos?.some((x) => x.toLowerCase() === repo.toLowerCase())) : recs;
  return {
    structuredContent: {
      org,
      count: scoped.length,
      recommendations: scoped.slice(0, limit).map((r) => ({
        title: r.title,
        dimension: r.dimId,
        impact: r.impact,
        repos: r.repos ?? [],
      })),
    },
  };
}

async function aiStance(org: string): Promise<ToolResult> {
  const published = await getActiveOrgStance(org);
  if (!published) {
    return fail(
      `This organization has not published an AI stance. Absence is not permission. Check with the org rather than assuming any tool, model or path is allowed.`,
    );
  }
  const s = published.stance;
  return {
    structuredContent: {
      org,
      version: published.version,
      permittedTools: s.permittedTools,
      permittedModels: s.permittedModels,
      noAiZones: s.noAiZones,
      reviewTiers: s.reviewTiers,
      requireTrailer: s.provenance.requireTrailer,
      requireHumanApproval: s.provenance.requireHumanApproval,
      // The stance is a DECLARATION. Nothing in ascent enforces the path zones at commit time, and
      // an agent told otherwise might treat a zone as a hard wall it can lean on.
      enforcement:
        "This stance is declared policy, not a runtime control. Path-scoped no-AI zones are advisory; honor them yourself.",
    },
  };
}

function practiceShape(args: Args): ToolResult {
  const id = str(args, "practiceId");
  if (!id) {
    return {
      structuredContent: {
        practices: PRACTICES.map((p) => ({ id: p.id, label: p.label, dimension: p.dimId, summary: p.what })),
      },
    };
  }
  const p = PRACTICES.find((x) => x.id === id);
  if (!p) return fail(`Unknown practice "${id}". Call this tool with no argument to list the available ids.`);
  return {
    structuredContent: {
      id: p.id,
      label: p.label,
      dimension: p.dimId,
      summary: p.what,
      // `starter` IS the reusable shape — generic structure to copy, never the exemplar's source.
      // That is the leak-free property the practice library is built on: the structure travels
      // between repos, the proprietary code does not.
      shape: p.starter,
    },
  };
}

async function recallMemory(org: string, args: Args): Promise<ToolResult> {
  const query = str(args, "query");
  if (!query) return fail("Provide a `query` describing what you are about to do or decide.");
  const limit = num(args, "limit", 5, 20);
  const rows = await candidateOrgMemories(org, { limit: limit * 4 }, null);
  const q = query.toLowerCase().split(/\s+/).filter(Boolean);
  // Deliberately a plain term overlap, not a semantic search: this is a projection of stored rows,
  // and inventing a relevance model here would put a second, divergent ranking beside the one the
  // Memory tab shows.
  const scored = rows
    .map((r) => {
      const hay = `${r.content} ${r.tags.join(" ")}`.toLowerCase();
      return { r, score: q.filter((t) => hay.includes(t)).length };
    })
    .filter((x) => x.score > 0)
    // Ties break by confidence then id — deterministic, so the same query returns the same order.
    .sort((a, b) => b.score - a.score || b.r.confidence - a.r.confidence || a.r.id.localeCompare(b.r.id))
    .slice(0, limit);

  if (scored.length === 0) {
    return {
      structuredContent: {
        org,
        query,
        count: 0,
        entries: [],
        note: "No stored memory matched. That means nothing was recorded on this topic, not that the approach is endorsed.",
      },
    };
  }
  return {
    structuredContent: {
      org,
      query,
      count: scored.length,
      entries: scored.map(({ r }) => ({
        kind: r.kind,
        namespace: r.namespace,
        content: r.content,
        tags: r.tags,
        // Provenance and trust travel WITH the entry: an agent weighing a remembered decision should
        // see who recorded it and how confident the org was, not just the text.
        source: r.source,
        confidence: r.confidence,
      })),
    },
  };
}

/** Dispatch by tool name. Scope enforcement happens BEFORE this, in the route. */
export async function runTool(name: string, org: string, args: Args): Promise<ToolResult> {
  switch (name) {
    case "get_repo_standing":
      return repoStanding(org, args);
    case "get_gate_verdict":
      return gateVerdict(org, args);
    case "list_open_recommendations":
      return openRecommendations(org, args);
    case "get_ai_stance":
      return aiStance(org);
    case "get_practice_shape":
      return practiceShape(args);
    case "recall_org_memory":
      return recallMemory(org, args);
    default:
      return fail(`Unknown tool "${name}".`);
  }
}
