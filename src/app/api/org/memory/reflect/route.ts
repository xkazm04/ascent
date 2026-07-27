// POST /api/org/memory/reflect { org, namespace?, decay?: true, dryRun?: true }
//   -> { proposals, clusterCount, llmUnavailable, engine, decay? }
// POST /api/org/memory/reflect { org, apply: { summaryContent, memberIds, confidence, namespace? } }
//   -> { id, superseded }
//
// The `reflect` (and, optionally, `forget`) verbs for Shared Org Memory. Reflection is what finally
// PRODUCES the `summary` kind: it clusters the org's active memories, asks the model for one rollup per
// family, and hands the proposals back.
//
// THE SAFETY PROPERTY THIS ROUTE EXISTS TO PRESERVE: proposals are never silently applied. A reflection
// pass supersedes real memories that real people wrote; a model that misreads a cluster would retire
// them with nobody in the loop. So the default call PROPOSES (a pure read + one LLM pass, zero writes)
// and a SECOND, explicit call with `apply` performs the write. Even then nothing is deleted — members
// are stamped `supersededBy` and stay in the table, linked to the rollup that replaced them.
//
// `decay: true` runs the forget pass in the same call (they are the same janitorial moment), and
// `dryRun: true` makes that pass report what it WOULD archive without touching a row.
//
// Gated as a WRITE (member + Team+/personal workspace): it spends the LLM and, on apply, mutates the
// store. A THIN ADAPTER — every judgment lives in src/lib/memory/{reflection,decay}.ts.

import { NextResponse } from "next/server";
import {
  applyReflection,
  archiveOrgMemories,
  getCreditState,
  getOrgId,
  isDbConfigured,
  lifecycleWorkingSet,
  recordAudit,
  ReflectionMembersNotFoundError,
  workspaceAllowsMemory,
} from "@/lib/db";
import { requireOrgAccess } from "@/lib/authz";
import { resolveViewerLogin } from "@/lib/access";
import { resolveRunPrompt } from "@/lib/memory/consolidation-engine";
import { proposeReflections } from "@/lib/memory/reflection";
import { archiveDecayed } from "@/lib/memory/decay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One CLI pass over the clusters, capped by the engine at MEMORY_CHECK_TIMEOUT_MS (90s).
export const maxDuration = 120;

interface ApplyBody {
  summaryContent?: string;
  memberIds?: string[];
  confidence?: number;
  namespace?: string;
}

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Memory requires a database." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as {
    org?: string;
    namespace?: string;
    decay?: boolean;
    dryRun?: boolean;
    apply?: ApplyBody;
  };
  if (!body.org) return NextResponse.json({ error: "Provide { org }." }, { status: 400 });
  const denied = await requireOrgAccess(body.org);
  if (denied) return denied;
  // Same entitlement as the write it produces: Team+ orgs, or a personal workspace (free-with-limits).
  const credit = await getCreditState(body.org).catch(() => null);
  if (!(await workspaceAllowsMemory(body.org, credit?.plan))) {
    return NextResponse.json({ error: "Shared Org Memory is a Team-plan feature." }, { status: 403 });
  }

  const viewer = await resolveViewerLogin();
  const orgId = (await getOrgId(body.org.toLowerCase()).catch(() => null)) ?? undefined;

  // ── Apply: the explicit, second call that actually writes ──────────────────────────────────
  if (body.apply) {
    const { summaryContent, memberIds, confidence, namespace } = body.apply;
    if (!summaryContent?.trim() || !Array.isArray(memberIds) || memberIds.length < 2) {
      return NextResponse.json(
        { error: "Provide { apply: { summaryContent, memberIds: [>=2 ids] } }." },
        { status: 400 },
      );
    }
    if (!memberIds.every((id) => typeof id === "string" && id)) {
      return NextResponse.json({ error: "memberIds must be strings." }, { status: 400 });
    }
    try {
      const applied = await applyReflection(
        body.org,
        {
          summaryContent,
          memberIds,
          confidence: typeof confidence === "number" ? confidence : 0.6,
          namespace,
        },
        viewer,
      );
      if (!applied) return NextResponse.json({ error: "Failed to write the summary." }, { status: 500 });
      await recordAudit(
        "org_memory.reflected",
        { memoryId: applied.id, superseded: applied.superseded, memberIds },
        { orgId, actorId: viewer ?? undefined },
      );
      return NextResponse.json(applied);
    } catch (err) {
      // A member that isn't live in this org (wrong tenant, already superseded by a racing pass): the
      // whole transaction rolled back, so a 400 is honest — nothing was written.
      if (err instanceof ReflectionMembersNotFoundError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      return NextResponse.json({ error: "Failed to write the summary." }, { status: 500 });
    }
  }

  // ── Propose (+ optional forget pass): zero writes to memory content ────────────────────────
  const working = await lifecycleWorkingSet(body.org, { namespace: body.namespace }, viewer);

  const runPrompt = await resolveRunPrompt();
  const result = await proposeReflections(
    working.map((m) => ({
      id: m.id,
      content: m.content,
      kind: m.kind,
      confidence: m.confidence,
      namespace: m.namespace,
    })),
    runPrompt,
    // Navigating away kills the spawned CLI rather than leaving it running.
    request.signal,
  );

  // Join each proposal's members back to their rows so the UI can show WHAT would be superseded.
  const byId = new Map(working.map((m) => [m.id, m]));
  const proposals = result.proposals.map((p) => ({
    ...p,
    members: p.memberIds.map((id) => byId.get(id)).filter((m) => m !== undefined),
  }));

  let decay: Awaited<ReturnType<typeof archiveDecayed>> | undefined;
  if (body.decay) {
    decay = await archiveDecayed(working, Date.now(), (ids) => archiveOrgMemories(body.org!, ids), {
      dryRun: Boolean(body.dryRun),
    });
    if (decay.archivedCount > 0) {
      await recordAudit(
        "org_memory.decayed",
        { archivedIds: decay.archivedIds, count: decay.archivedCount },
        { orgId, actorId: viewer ?? undefined },
      );
    }
  }

  return NextResponse.json({
    proposals,
    clusterCount: result.clusterCount,
    llmUnavailable: result.llmUnavailable,
    engine: result.engine,
    /** How many active memories the pass considered — so the UI never implies a full-store scan. */
    consideredCount: working.length,
    decay,
  });
}
