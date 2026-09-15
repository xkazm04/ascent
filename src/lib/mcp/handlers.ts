// MCP tool handlers (W5) — the adapter layer between the protocol and reads that already exist.
//
// Every handler here is a projection of a shipped function. Nothing computes a new number, and
// nothing reaches past what the calling token's scopes allow. If a handler ever needs its own
// arithmetic, that arithmetic belongs in the module that owns the data, not here — otherwise the
// agent door and the dashboard would eventually disagree about the same fact.
//
// This module keeps the FLEET-STANDING tools and the dispatcher. The org's own curated corpus (skills,
// registry subjects, lessons) is projected by `registry-reads.ts`, and the two write tools by
// `registry-writes.ts` — see those files for why the split is by rule and not by size.
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

import { bumpMemoryAccessCounts, candidateOrgMemories, getOrgRecommendations, getOrgRollup } from "@/lib/db";
import { citationCountsFor } from "@/lib/db/org-memory-citations";
import { getOrgGatePolicy } from "@/lib/db/org-gate";
import { getActiveOrgStance } from "@/lib/db/org-stance";
import { getRepoAdmission } from "@/lib/db/org-admission";
import { compileStance } from "@/lib/org/admission";
import { defaultGatePolicy, describeGatePolicy, evaluateGateLite } from "@/lib/scoring/gate";
import { PRACTICES } from "@/lib/practices";
// `Args`/`str`/`fail` come from registry-reads rather than being duplicated here; its back-edge to
// this module is type-only, so the two do not form a runtime cycle.
import { fail, findSkills, getGoverningSubject, getSkill, getSkillLessons, str, type Args } from "@/lib/mcp/registry-reads";
import { citeMemory, reportSkillInvoke } from "@/lib/mcp/registry-writes";
import { compareAgainstExemplar } from "@/lib/mcp/exemplar-tool";
import { claimFollowupsTool, getFixBriefTool, reportAttemptTool } from "@/lib/mcp/work-tools";
import { MCP_TOOLS } from "@/lib/mcp/tools";
import { validateArgs } from "@/lib/mcp/validate-args";

export interface ToolResult {
  structuredContent: unknown;
  /** Human/model-readable text. Defaults to the JSON of structuredContent when omitted. */
  text?: string;
  isError?: boolean;
}

/**
 * The ONE way a tool result becomes text for a model. Lifted out of the MCP route (it was inline at
 * `src/app/api/mcp/route.ts`) when Athena became a second in-process consumer of these same handlers:
 * two doors serving the same tool must not be able to show the model two different renderings of the
 * same answer, and the only way to guarantee that is for neither of them to own the rendering.
 *
 * `text` when the handler wrote one (every `fail()` does), otherwise the pretty-printed structured
 * payload — the exact expression the route used, moved rather than rewritten.
 */
export function toolResultText(result: ToolResult): string {
  return result.text ?? JSON.stringify(result.structuredContent, null, 2);
}

/** A work tool reached with no verified caller. Fails closed — see `runTool`. */
const unattributed = (name: string): ToolResult =>
  fail(`"${name}" acts on this organization's work queue on behalf of a named holder, and this call carried none.`);

const num = (a: Args, k: string, dflt: number, max: number): number => {
  const v = a[k];
  const n = typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? Math.max(1, Math.min(max, Math.floor(n))) : dflt;
};

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
  const repo = str(args, "repo");
  // THE REPO FILTER RUNS BEFORE THE CAP, inside the query. This handler used to ask for the fleet's
  // top `limit` moves and filter them by repo afterwards — so a repository with plenty of open gaps
  // answered `count: 0` whenever none of its own gaps were the FLEET's highest-leverage ones, and the
  // agent read that silence as "nothing to do here". Same ranking, same arithmetic; only the slice
  // moved (`getOrgRecommendations`'s `repoFullName`).
  const recs = await getOrgRecommendations(org, limit, null, null, repo);
  if (!recs) return fail(`No data for organization "${org}".`);
  return {
    structuredContent: {
      org,
      ...(repo ? { repo } : {}),
      count: recs.length,
      recommendations: recs.map((r) => ({
        title: r.title,
        dimension: r.dimId,
        impact: r.impact,
        repos: r.repos ?? [],
      })),
      // ABSENCE IS ANSWERED, NEVER LEFT AS AN EMPTY LIST. `count: 0` with no sentence reads to a model
      // as "this repository is clean"; for a repo that is simply unscanned, or whose gaps are all
      // closed, those are different facts and only one of them is good news.
      ...(recs.length === 0
        ? {
            note: repo
              ? `No open, tracked recommendation names ${repo}. That means this organization has none recorded against it — either it has no scan, or its gaps are closed — not that the repository is known to be in good shape.`
              : `This organization has no open, tracked recommendations recorded. That is an absence of records, not a clean bill of health.`,
          }
        : {}),
    },
  };
}

async function aiStance(org: string, args: Args): Promise<ToolResult> {
  const published = await getActiveOrgStance(org);
  if (!published) {
    return fail(
      `This organization has not published an AI stance. Absence is not permission. Check with the org rather than assuming any tool, model or path is allowed.`,
    );
  }
  const s = published.stance;
  const base = {
    org,
    version: published.version,
    permittedTools: s.permittedTools,
    permittedModels: s.permittedModels,
    noAiZones: s.noAiZones,
    reviewTiers: s.reviewTiers,
    requireTrailer: s.provenance.requireTrailer,
    requireHumanApproval: s.provenance.requireHumanApproval,
  };

  // #8 — the optional per-repo narrowing. Without `repo` the answer is the org-wide DECLARATION and
  // nothing more, which is what the blanket disclaimer below correctly describes.
  const repo = str(args, "repo");
  if (!repo) {
    return {
      structuredContent: {
        ...base,
        enforcement:
          "This is the organization-wide declaration. Pass `repo` to see which of these clauses are " +
          "compiled into enforced controls for a specific repository, and which stay declared.",
      },
    };
  }
  // Constrained to the caller's own org, the same gate-then-constrain rule the admission routes keep:
  // an MCP principal authorized for one org must not be able to read another's decision by naming it.
  if (repo.split("/")[0]?.toLowerCase() !== org.toLowerCase()) {
    return fail(`"${repo}" is not a repository in ${org}.`);
  }
  const admission = await getRepoAdmission(org, repo);
  if (!admission) {
    return {
      structuredContent: {
        ...base,
        repo,
        // Honest null, said in words an agent can act on. "Not assessed" is not "allowed": the
        // absence of a decision is the absence of a decision.
        admission: { mode: null, tier: null, assessed: false },
        enforcement:
          `No autonomy tier has been assessed for ${repo} (it has not been scanned with a passport), so no ` +
          `per-repo control is compiled and the organization-wide declaration above is the whole of the policy. ` +
          `Absence of an assessment is not permission.`,
      },
    };
  }
  const compiled = compileStance(
    s,
    admission,
    {
      fullName: repo,
      derivedTier: admission.derivedTier,
      // This tool reads; it does not go fetch a repo's CODEOWNERS or branch governance. Those inputs
      // are honestly absent, which affects only the `unenforceable[]` list — never the mode or tier.
      codeownersPaths: [],
      observedRequiredApprovals: null,
      protectedBranch: null,
    },
    published.version,
  );
  return {
    structuredContent: {
      ...base,
      repo,
      admission: {
        mode: compiled.mode,
        tier: compiled.tier,
        assessed: compiled.tier !== null,
        source: compiled.tierSource,
        staleDecision: compiled.staleDecision,
      },
      // The per-clause ENFORCEMENT MAP that replaces the blanket "declared policy, not a runtime
      // control" string. The honesty rule it encoded is kept — its scope is narrowed to the truth:
      // some clauses ARE compiled into checkable controls now, and pretending otherwise would make an
      // agent ignore a bar that will actually block its PR.
      enforcedControls: {
        gate: compiled.gateOverlay,
        review: compiled.manifestOversight?.review || null,
        ruleset: compiled.ruleset ? compiled.ruleset.name : null,
      },
      // What stays DECLARED, and why. This is the half an agent must honor by itself — naming it is
      // the difference between a rule it can lean on and one it must carry.
      unenforceable: compiled.unenforceable,
      enforcement:
        compiled.mode === "blocked"
          ? `${repo} is admitted as BLOCKED: no AI-attributed change may land here. Do not open work in this repository.`
          : compiled.mode === "assisted-only"
            ? `${repo} is admitted as ASSISTED-ONLY: a human drives and you assist. Do not run autonomously here.`
            : `${repo} admits agent work at tier ${compiled.tier ?? "unassessed"}. The controls above are enforced; ` +
              `everything under \`unenforceable\` is declared only and is yours to honor.`,
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

  // USE EVIDENCE, folded in before the entries are handed over. `citedCount` lives on OrgMemory and
  // `MemoryRow` does not carry it, so it is read here rather than inferred — and an id missing from
  // the map is "no evidence", which is exactly the 0 the recall model treats as the term's absence.
  const counts: Record<string, { citedCount: number; notUsefulCount: number }> = await citationCountsFor(
    org,
    scored.map((s) => s.r.id),
  ).catch(() => ({}));

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
  // DELIVERIES ARE NOW COUNTED AT THIS DOOR. They never were: the REST recall route bumped
  // `accessCount` and this handler did not, so every memory an agent read through MCP looked, to
  // decay.ts, like one nobody had ever asked for. Best-effort by contract, and only what was returned.
  await bumpMemoryAccessCounts(org, scored.map(({ r }) => r.id)).catch(() => 0);

  return {
    structuredContent: {
      org,
      query,
      count: scored.length,
      entries: scored.map(({ r }) => ({
        // THE ID IS THE POINT OF THIS FIELD: it is what `cite_memory` needs to report back which of
        // these actually helped. Without it the citation channel has no handle to name.
        id: r.id,
        kind: r.kind,
        namespace: r.namespace,
        content: r.content,
        tags: r.tags,
        // Provenance and trust travel WITH the entry: an agent weighing a remembered decision should
        // see who recorded it and how confident the org was, not just the text.
        source: r.source,
        confidence: r.confidence,
        citedCount: counts[r.id]?.citedCount ?? 0,
        notUsefulCount: counts[r.id]?.notUsefulCount ?? 0,
      })),
      citing:
        "Report back with cite_memory using each entry's `id`. Whether a memory helped is something only you can know, and it is the only evidence this store has that a memory is worth keeping.",
    },
  };
}

/**
 * WHO IS CALLING, for the tools that need to know (moonshot #3).
 *
 * The read tools ignore it entirely and always will: a projection of an org's own data is the same
 * projection whoever asked. The WORK tools cannot — a claim has a holder, a brief is only for rows
 * that holder holds, and an attempt is that holder's account — so the actor arrives as an explicit
 * argument rather than as ambient state. That is what lets Athena dispatch the same handlers
 * in-process without either door having to know how the other authenticated.
 */
export interface McpPrincipal {
  /**
   * The value stored in `Recommendation.claimActor` — `agent:<token id>`.
   *
   * THE ID, NOT THE NAME. `createOrgApiToken` enforces no uniqueness on a token's name, so the old
   * `agent:<name>` form made two live tokens called `ci` ONE holder: either could brief and report on
   * rows the other leased. An id is unique by construction, so the ledger's holder comparison is now
   * a comparison of credentials rather than of labels somebody chose twice.
   */
  actor: string;
  /**
   * TRANSITIONAL — the pre-2026-09-05 holder form `agent:<token name>`, accepted ALONGSIDE `actor`
   * so rows claimed before the change stay workable by the token that claimed them. It carries the
   * old form's ambiguity for those rows only. Leases are hours, so every such row lapses back to the
   * queue within a day; after that this field and the dual-match in `followup-claims.ts` are deleted
   * together. Absent for a caller that never stored the old form.
   */
  legacyActor?: string | null;
  /** The verified token's id, for the audit row. */
  tokenId: string | null;
  /** The token's human NAME — a display label only. Never an identity: see `actor`. */
  label?: string | null;
}

/**
 * Dispatch by tool name. SCOPE, PLAN and WRITE enforcement all happen BEFORE this, in the route or in
 * Athena's grounding — this function trusts its caller completely, as it always has, and each door
 * carries its own gate rather than assuming the other ran. Load-bearing now that four tools WRITE.
 *
 * `principal` is OPTIONAL and its absence FAILS CLOSED: a work tool reached without one is refused
 * rather than run under an invented actor. Athena passes none (it refuses `mutates` tools outright),
 * and the MCP route always passes one, so the refusal is unreachable in practice — which is exactly
 * the state a fail-closed default should be in.
 */
export async function runTool(name: string, org: string, args: Args, principal?: McpPrincipal): Promise<ToolResult> {
  // THE SCHEMA IS ENFORCED HERE, BEFORE THE SWITCH — at the dispatcher rather than at either door, so
  // the MCP route and Athena's in-process grounding cannot disagree about what a tool accepts, and a
  // handler added by a future lane is validated without remembering to be. `null` for an unknown
  // tool: that is the default branch's answer to give, not a schema complaint.
  const def = MCP_TOOLS.find((t) => t.name === name);
  const violation = def ? validateArgs(def.inputSchema, args) : null;
  if (violation) {
    // In-band, addressed to the model: the request was well-formed and its argument was not, which
    // is something the caller can fix on its next call. See `validate-args.ts`.
    return fail(`${violation} Fix the argument and call ${name} again — nothing was done.`);
  }
  switch (name) {
    case "claim_followups":
      return principal ? claimFollowupsTool(org, args, principal) : unattributed(name);
    case "get_fix_brief":
      return principal ? getFixBriefTool(org, args, principal) : unattributed(name);
    case "report_attempt":
      return principal ? reportAttemptTool(org, args, principal) : unattributed(name);
    case "report_skill_invoke":
      return reportSkillInvoke(org, args, Date.now());
    case "cite_memory":
      return citeMemory(org, args);
    case "find_skills":
      return findSkills(org, args);
    case "get_skill":
      return getSkill(org, args);
    case "get_skill_lessons":
      return getSkillLessons(org, args);
    case "get_governing_subject":
      return getGoverningSubject(org, args);
    case "compare_against_exemplar":
      return compareAgainstExemplar(org, args);
    case "get_repo_standing":
      return repoStanding(org, args);
    case "get_gate_verdict":
      return gateVerdict(org, args);
    case "list_open_recommendations":
      return openRecommendations(org, args);
    case "get_ai_stance":
      return aiStance(org, args);
    case "get_practice_shape":
      return practiceShape(args);
    case "recall_org_memory":
      return recallMemory(org, args);
    default:
      return fail(`Unknown tool "${name}".`);
  }
}
