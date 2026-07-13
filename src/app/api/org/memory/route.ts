// GET  /api/org/memory?org=&namespace=&kind=&search=&sort=  -> { memories, kinds, namespaces }  (read-gated)
// POST /api/org/memory { org, content, kind?, namespace?, visibility?, source?, confidence?, tags?, supersedeId? }
//                                                          -> { id }   (member + Team+ plan)
//
// Shared Org Memory (Memory-as-a-Service MVP). Reads are open to any member of the org; WRITING is the
// gated capability (a memory nobody can read is worthless, so we never gate reads) — mirrors the Skills
// Library split. `supersedeId` makes the write a CORRECTION: the db layer stamps the old memory
// `supersededBy` in the same transaction, and refuses a target from another org (design doc §4 + §8).
//
// The tenant boundary is enforced twice, deliberately: requireOrgRead/requireOrgAccess authorize the
// slug, and every db query AND-s the resolved orgId. A client-supplied org is never trusted alone (§4.1).

import { NextResponse } from "next/server";
import {
  SupersedeTargetNotFoundError,
  createOrgMemory,
  getCreditState,
  getOrgId,
  isDbConfigured,
  listOrgMemories,
  listOrgMemoryNamespaces,
  recordAudit,
  type MemorySort,
} from "@/lib/db";
import { requireOrgAccess, requireOrgRead } from "@/lib/authz";
// resolveViewerLogin drives the `visibility='private'` filter (design doc §4.5) — a route file may only
// export Next's own handler/config names, so the helper lives in lib/access beside getViewer.
import { resolveViewerLogin } from "@/lib/access";
import { PERSONAL_MEMORY_LIMIT, personalMemoryCapReached, workspaceAllowsMemory } from "@/lib/db";
import { MEMORY_KINDS, isMemoryKind, isMemoryVisibility } from "@/lib/org/memory-kinds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isSort = (v: string | null): v is MemorySort =>
  v === "recent" || v === "confidence" || v === "recalls";

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Memory requires a database." }, { status: 503 });
  const url = new URL(request.url);
  const org = url.searchParams.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  const denied = await requireOrgRead(org);
  if (denied) return denied;

  const sortParam = url.searchParams.get("sort");
  const viewer = await resolveViewerLogin();
  const [memories, namespaces] = await Promise.all([
    listOrgMemories(
      org,
      {
        namespace: url.searchParams.get("namespace") ?? undefined,
        kind: url.searchParams.get("kind") ?? undefined,
        search: url.searchParams.get("search") ?? undefined,
        sort: isSort(sortParam) ? sortParam : undefined,
      },
      viewer,
    ),
    listOrgMemoryNamespaces(org),
  ]);
  return NextResponse.json({ memories: memories ?? [], kinds: MEMORY_KINDS, namespaces });
}

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Memory requires a database." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as {
    org?: string;
    content?: string;
    kind?: string;
    namespace?: string;
    visibility?: string;
    source?: string;
    confidence?: number;
    tags?: string[];
    supersedeId?: string;
  };
  if (!body.org || !body.content?.trim()) {
    return NextResponse.json({ error: "Provide { org, content }." }, { status: 400 });
  }
  const denied = await requireOrgAccess(body.org);
  if (denied) return denied;
  // Entitlement: writing an ORG's memory is a Team-and-up feature (reads stay open to all members);
  // a PERSONAL workspace writes free-with-limits (individual tier, decision 4) — capped below.
  const credit = await getCreditState(body.org).catch(() => null);
  if (!(await workspaceAllowsMemory(body.org, credit?.plan))) {
    return NextResponse.json({ error: "Shared Org Memory is a Team-plan feature." }, { status: 403 });
  }
  if (await personalMemoryCapReached(body.org, credit?.plan)) {
    return NextResponse.json(
      { error: `Personal memory is capped at ${PERSONAL_MEMORY_LIMIT} live entries. Archive or supersede one to add another.` },
      { status: 402 },
    );
  }
  if (body.kind !== undefined && !isMemoryKind(body.kind)) {
    return NextResponse.json({ error: `kind must be one of: ${MEMORY_KINDS.join(", ")}.` }, { status: 400 });
  }
  if (body.visibility !== undefined && !isMemoryVisibility(body.visibility)) {
    return NextResponse.json({ error: "visibility must be 'shared' or 'private'." }, { status: 400 });
  }

  const author = await resolveViewerLogin();
  try {
    const created = await createOrgMemory(
      body.org,
      {
        content: body.content,
        kind: body.kind,
        namespace: body.namespace,
        visibility: body.visibility,
        source: body.source,
        confidence: body.confidence,
        tags: Array.isArray(body.tags) ? body.tags : undefined,
        supersedeId: body.supersedeId,
      },
      author,
    );
    if (!created) return NextResponse.json({ error: "Failed to write the memory." }, { status: 500 });

    const orgId = (await getOrgId(body.org.toLowerCase()).catch(() => null)) ?? undefined;
    await recordAudit(
      "org_memory.created",
      { memoryId: created.id, kind: body.kind ?? "semantic", supersededId: body.supersedeId ?? null },
      { orgId, actorId: author ?? undefined },
    );
    return NextResponse.json(created);
  } catch (err) {
    // A supersede aimed at a memory outside this org (or already corrected by a racing writer) — the
    // whole write rolled back. A 400 is honest: the CLIENT's target is wrong, nothing was stored.
    if (err instanceof SupersedeTargetNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to write the memory." }, { status: 500 });
  }
}
