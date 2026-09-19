// GET    /api/org/memory/:id                                      -> { memory }  (read-gated)
// PATCH  /api/org/memory/:id { content?, kind?, namespace?, ... } -> { ok }      (member + Team+)
// DELETE /api/org/memory/:id                                      -> { ok }      (admin · soft-archive)
//
// Per-row org gate: the owning org is resolved FROM the memory (getOrgMemoryOrgSlug), then authorized —
// a caller can never reach another tenant's memory by guessing an id (design doc §4.1: "a key asking for
// a project it doesn't own gets a 403, not empty results"). DELETE soft-archives, never hard-deletes, so
// provenance and supersede lineage survive. Mirrors the skills [id] route.
//
// AND THE AUTHOR GATE, on reads AND writes (§4.5). Membership is not enough for another author's
// PRIVATE scratch: GET 404s it, every db read composes visibilityScope(viewer), and gateWrite applies
// the same test. It did not, which meant a member who could not READ a private memory could still PATCH
// it — overwrite the content, or set visibility:"shared" and publish it — because updateOrgMemory is
// keyed on id alone. Read-scoping without write-scoping is not a privacy rule, it is a display rule.
//
// AND THE ORIGIN GATE, on writes only. A registry-origin row is a mirror of a file in a repo the
// customer owns; PATCH or DELETE here would be reverted by the next index pass. The UI already hides
// archive on those rows; the wire must refuse too (`409 registry-origin`), matching reflect/apply.
// A write that reports success and does not survive is worse than a refusal.

import { NextResponse } from "next/server";
import {
  archiveOrgMemory,
  getCreditState,
  getOrgId,
  getOrgMemory,
  getOrgMemoryOrgSlug,
  isDbConfigured,
  recordAudit,
  updateOrgMemory,
} from "@/lib/db";
import { requireOrgAccess, requireOrgRead, requireOrgRole } from "@/lib/authz";
import { resolveViewerLogin } from "@/lib/access";
import { workspaceAllowsMemory } from "@/lib/db";
import { MEMORY_KINDS, isMemoryKind, isMemoryVisibility } from "@/lib/org/memory-kinds";
import type { OrgRole } from "@/lib/db/members";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Resolve+authorize the memory's owning org for a write. Returns the org slug, or a NextResponse to
 *  send back (503 no-db / 404 unknown / gate 401-403 / 403 plan). Reads use requireOrgRead inline. */
async function gateWrite(id: string, min: OrgRole): Promise<{ org: string } | NextResponse> {
  if (!isDbConfigured()) return NextResponse.json({ error: "Memory requires a database." }, { status: 503 });
  const org = await getOrgMemoryOrgSlug(id);
  if (!org) return NextResponse.json({ error: "Memory not found." }, { status: 404 });
  const denied = min === "member" ? await requireOrgAccess(org) : await requireOrgRole(org, min);
  if (denied) return denied;
  const rowGate = await denyWriteOnRow(id);
  if (rowGate) return rowGate;
  const credit = await getCreditState(org).catch(() => null);
  // Team+ orgs, or a personal workspace (free-with-limits — edits/archives don't grow the store).
  if (!(await workspaceAllowsMemory(org, credit?.plan))) {
    return NextResponse.json({ error: "Shared Org Memory is a Team-plan feature." }, { status: 403 });
  }
  return { org };
}

/**
 * Per-row write refusals, after the org/role gate and before the plan gate.
 *
 * THE §4.5 AUTHOR GATE. Another author's private scratch answers 404 — the same response GET gives,
 * deliberately: a caller who is not allowed to know the row exists must not learn it from the write
 * path either, so this is 404 rather than 403. It runs for `admin` too. An admin can archive any
 * SHARED memory, and an org that needs a compliance erase has /api/org/erase for it; letting the
 * role reach inside a colleague's private notes is not the same power, and nothing in the product
 * asks for it.
 *
 * THE ORIGIN GATE. A registry-origin row is a mirror of a file in a repo the customer owns. PATCH
 * or DELETE here would be reverted by the next index pass, so the refusal names that (`409
 * registry-origin`) rather than succeeding and quietly reverting. The author gate runs first: a
 * private row the caller may not know about still answers 404, not 409.
 */
async function denyWriteOnRow(id: string): Promise<NextResponse | null> {
  const memory = await getOrgMemory(id);
  if (!memory) return NextResponse.json({ error: "Memory not found." }, { status: 404 });
  if (memory.visibility === "private") {
    const viewer = await resolveViewerLogin();
    if (!(viewer && memory.createdBy === viewer)) {
      return NextResponse.json({ error: "Memory not found." }, { status: 404 });
    }
  }
  if (memory.origin === "registry") {
    return NextResponse.json(
      {
        error:
          "This note is a mirror of a file in your registry. Editing or archiving it here would be reverted by the next index pass — change it with a pull request instead.",
        code: "registry-origin",
      },
      { status: 409 },
    );
  }
  return null;
}

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Memory requires a database." }, { status: 503 });
  const { id } = await ctx.params;
  const org = await getOrgMemoryOrgSlug(id);
  if (!org) return NextResponse.json({ error: "Memory not found." }, { status: 404 });
  const denied = await requireOrgRead(org);
  if (denied) return denied;
  const memory = await getOrgMemory(id);
  if (!memory) return NextResponse.json({ error: "Memory not found." }, { status: 404 });
  // Another author's private scratch is not readable just because its id was guessed (§4.5).
  if (memory.visibility === "private" && memory.createdBy !== (await resolveViewerLogin())) {
    return NextResponse.json({ error: "Memory not found." }, { status: 404 });
  }
  return NextResponse.json({ memory });
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gateWrite(id, "member");
  if (g instanceof Response) return g;
  const body = (await request.json().catch(() => ({}))) as {
    content?: string;
    kind?: string;
    namespace?: string;
    visibility?: string;
    source?: string;
    confidence?: number;
    tags?: string[];
    archived?: boolean;
  };
  if (body.kind !== undefined && !isMemoryKind(body.kind)) {
    return NextResponse.json({ error: `kind must be one of: ${MEMORY_KINDS.join(", ")}.` }, { status: 400 });
  }
  if (body.visibility !== undefined && !isMemoryVisibility(body.visibility)) {
    return NextResponse.json({ error: "visibility must be 'shared' or 'private'." }, { status: 400 });
  }
  try {
    await updateOrgMemory(id, {
      content: body.content,
      kind: body.kind,
      namespace: body.namespace,
      visibility: body.visibility,
      source: body.source,
      confidence: body.confidence,
      tags: Array.isArray(body.tags) ? body.tags : undefined,
      archived: body.archived,
    });
    const actor = await resolveViewerLogin();
    const orgId = (await getOrgId(g.org.toLowerCase()).catch(() => null)) ?? undefined;
    const changed = Object.keys(body).filter((k) => body[k as keyof typeof body] !== undefined);
    await recordAudit("org_memory.updated", { memoryId: id, changed }, { orgId, actorId: actor ?? undefined });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if ((err as { code?: string }).code === "P2025") {
      return NextResponse.json({ error: "Memory not found." }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to update the memory." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gateWrite(id, "admin");
  if (g instanceof Response) return g;
  try {
    await archiveOrgMemory(id);
    const actor = await resolveViewerLogin();
    const orgId = (await getOrgId(g.org.toLowerCase()).catch(() => null)) ?? undefined;
    await recordAudit("org_memory.archived", { memoryId: id }, { orgId, actorId: actor ?? undefined });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if ((err as { code?: string }).code === "P2025") {
      return NextResponse.json({ error: "Memory not found." }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to archive the memory." }, { status: 500 });
  }
}
