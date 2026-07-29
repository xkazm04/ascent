// POST /api/org/memory/check { org, content, kind?, namespace? }
//   -> { recommendation, duplicates: [{ ...match, memory }], summary?, llmUnavailable, engine }
//
// The write-intelligence pass for Shared Org Memory (design doc §8 "write policy"): before a memory is
// committed, decide whether it is novel, a duplicate, or a CORRECTION of something already stored. Runs
// the local Claude Code CLI over a bounded shortlist of the org's own memories; degrades to a
// deterministic token-overlap verdict when no model is reachable.
//
// Gated like a WRITE (member + Team+), not a read: it spends the LLM and only ever precedes a POST.
//
// This route is a THIN ADAPTER over src/lib/memory/consolidation.ts — it resolves the caller, fetches
// the candidate set, and joins the verdict back to the memory rows the UI has to render. All judgment
// lives in the core, so the future MCP `memory_write` tool reuses it without touching this file (§5/§6).

import { NextResponse } from "next/server";
import { candidateOrgMemories, getCreditState, isDbConfigured, workspaceAllowsMemory, type MemoryRow } from "@/lib/db";
import { requireOrgAccess } from "@/lib/authz";
import { resolveViewerLogin } from "@/lib/access";
import { isMemoryKind } from "@/lib/org/memory-kinds";
import { analyzeWrite } from "@/lib/memory/consolidation";
import { resolveMemoryRunner } from "@/lib/memory/consolidation-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The CLI check is interactive but not instant (the engine caps it at MEMORY_CHECK_TIMEOUT_MS, 90s).
export const maxDuration = 120;

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Memory requires a database." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as {
    org?: string;
    content?: string;
    kind?: string;
    namespace?: string;
  };
  if (!body.org || !body.content?.trim()) {
    return NextResponse.json({ error: "Provide { org, content }." }, { status: 400 });
  }
  const denied = await requireOrgAccess(body.org);
  if (denied) return denied;
  const credit = await getCreditState(body.org).catch(() => null);
  // Team+ orgs, or a personal workspace (free-with-limits): the write-intelligence check follows the
  // same entitlement as the write it precedes.
  if (!(await workspaceAllowsMemory(body.org, credit?.plan))) {
    return NextResponse.json({ error: "Shared Org Memory is a Team-plan feature." }, { status: 403 });
  }

  const kind = isMemoryKind(body.kind) ? body.kind : "semantic";
  const viewer = await resolveViewerLogin();

  // Only memories this caller may actually SEE become candidates — the check must never reveal another
  // author's private scratch through a "you already wrote this" verdict.
  const candidates = await candidateOrgMemories(
    body.org,
    { namespace: body.namespace, kind },
    viewer,
  );

  const runner = await resolveMemoryRunner();
  const verdict = await analyzeWrite(
    { content: body.content, kind, namespace: body.namespace, candidates },
    runner?.run ?? null,
    // A user who navigates away or hits Cancel aborts the in-flight call (or kills the spawned CLI)
    // instead of leaving it running.
    request.signal,
    runner?.engine,
  );

  // Join each match back to its row so the UI can show WHAT it would supersede, not just an id.
  const byId = new Map<string, MemoryRow>(candidates.map((c) => [c.id, c]));
  const duplicates = verdict.duplicates
    .map((d) => {
      const memory = byId.get(d.id);
      return memory ? { ...d, memory } : null;
    })
    .filter((d): d is typeof d & object => d !== null);

  return NextResponse.json({
    recommendation: verdict.recommendation,
    duplicates,
    summary: verdict.summary,
    llmUnavailable: verdict.llmUnavailable,
    engine: verdict.engine,
    /** How many of the org's memories were actually compared — so the UI never implies a full scan. */
    comparedCount: candidates.length,
  });
}
