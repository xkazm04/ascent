// GET  /api/org/memory/recall?org=&namespace=&kinds=a,b&charBudget=6000
// POST /api/org/memory/recall { org, namespace?, kinds?, charBudget? }
//   -> { memories: [{ ...row, score, ageDays }], usedChars, charBudget, consideredCount, omittedCount }
//
// The `recall` verb: "give me the most valuable thing this org knows, in N characters." Where GET
// /api/org/memory is a BROWSE surface (filter, search, sort, 200 rows for a human to scroll), this is
// the AGENT surface — value-ranked and budget-packed, so the answer drops straight into a context window.
//
// Two verbs on one route because both are legitimate: GET so a shell/agent can curl it, POST so a long
// `kinds` list or a scripted caller has a body. They share one implementation; the params are identical.
//
// READ-gated (any member of the org), not write-gated — recall is reading the store, and the same call
// that gates the per-row counter (/api/org/memory/:id/recall) gates this. The accessCount bump it
// performs is a decoration of that read, not an authoring act.
//
// THIN ADAPTER over src/lib/memory/recall.ts: resolve caller → fetch the bounded working set → call the
// pure core with an injected `now` → bump the counters of what was actually RETURNED. All judgment (the
// value model, the packing) lives in the core, so the future MCP `memory_recall` tool reuses it whole.

import { NextResponse } from "next/server";
import { bumpMemoryAccessCounts, isDbConfigured, lifecycleWorkingSet } from "@/lib/db";
import { requireOrgRead } from "@/lib/authz";
import { resolveViewerLogin } from "@/lib/access";
import { isMemoryKind } from "@/lib/org/memory-kinds";
import { normalizeCharBudget, recallMemories } from "@/lib/memory/recall";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RecallParams {
  org: string;
  namespace?: string;
  kinds: string[];
  charBudget: number;
}

/** Unknown kind ids are dropped rather than 400-ing: recall is a best-effort read, and a caller asking
 *  for a kind we retired should get the kinds we do have, not an error. */
const cleanKinds = (raw: unknown): string[] => {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(",")
      : [];
  return [...new Set(list.map((k) => String(k).trim()).filter(isMemoryKind))];
};

async function handle(params: RecallParams) {
  const denied = await requireOrgRead(params.org);
  if (denied) return denied;

  // Only memories this caller may actually SEE enter the pass — recall must never leak another author's
  // private scratch into an agent's context.
  const viewer = await resolveViewerLogin();
  const working = await lifecycleWorkingSet(
    params.org,
    { namespace: params.namespace, kinds: params.kinds.length ? params.kinds : undefined },
    viewer,
  );

  // The wall clock is read HERE, once, and injected — the core stays pure and its tests stay fixed.
  const result = recallMemories(working, {
    now: Date.now(),
    charBudget: params.charBudget,
    namespace: params.namespace,
    kinds: params.kinds,
  });

  // ONLY what was returned gets its tally bumped. A memory that lost the budget race was not recalled,
  // and counting it would turn accessCount into "how often was this store queried" — a number that rises
  // uniformly and therefore ranks nothing. One batched, best-effort update.
  await bumpMemoryAccessCounts(
    params.org,
    result.selected.map((s) => s.memory.id),
  );

  return NextResponse.json({
    memories: result.selected.map((s) => ({ ...s.memory, score: s.score, ageDays: s.ageDays })),
    usedChars: result.usedChars,
    charBudget: result.charBudget,
    /** Eligible rows the pass ranked — so a caller never implies it received everything. */
    consideredCount: result.consideredCount,
    omittedCount: result.omitted.length,
  });
}

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Memory requires a database." }, { status: 503 });
  const url = new URL(request.url);
  const org = url.searchParams.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  return handle({
    org,
    namespace: url.searchParams.get("namespace") ?? undefined,
    kinds: cleanKinds(url.searchParams.get("kinds")),
    charBudget: normalizeCharBudget(url.searchParams.get("charBudget")),
  });
}

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Memory requires a database." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as {
    org?: string;
    namespace?: string;
    kinds?: string[] | string;
    charBudget?: number;
  };
  if (!body.org) return NextResponse.json({ error: "Provide { org }." }, { status: 400 });
  return handle({
    org: body.org,
    namespace: body.namespace,
    kinds: cleanKinds(body.kinds),
    charBudget: normalizeCharBudget(body.charBudget),
  });
}
