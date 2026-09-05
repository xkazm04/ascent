// LESSON CANDIDATES from local-mode loop lanes (self-hosted only).
//
//   GET  ?org=…[&status=pending]                        → { lessons }
//   POST { org, id, action: "keep" | "discard" }        → { lesson }
//
// WHY A CANDIDATE INBOX AND NOT A WRITE. An agent's "lesson" is a claim by an unattended process
// about what an organization should believe. Org Memory is read as truth by the companion, by the
// lane brief that produced this lesson in the first place, and by every consolidation pass — so a
// loop that wrote into it directly would let one bad session teach the whole organization something
// nobody agreed to. `keep` promotes through `createOrgMemory`, the same door the memory route uses,
// which is where the duplicate/consolidation rules live.
//
// GATES. `selfHostGuard()` first (on managed cloud this surface does not exist — 404, never 403,
// because a 403 advertises it), then `requireOrgAccess` for the read and `requireOrgRole(org,
// "member")` for the write. The POST also takes `requireSameOrigin` FIRST: it mutates, and on `keep`
// it writes into Org Memory.
//
// TENANCY is GATE-THEN-CONSTRAIN: the authorized org slug is passed INTO the update beside the
// candidate id, so a candidate from another organization is simply not found → 404. There is no
// `[id]` segment here, so `id-routes-gated.test.ts` is unaffected by design.

import { NextResponse } from "next/server";
import { PUBLIC_ORG, requireSameOrigin } from "@/lib/auth";
import { getViewer } from "@/lib/access";
import { requireOrgAccess, requireOrgRole } from "@/lib/authz";
import { selfHostGuard } from "@/lib/api/self-host";
import { createOrgMemory } from "@/lib/db/org-memory";
import { LOOP_LESSON_SOURCE, getLoopLesson, isLessonStatus, listLoopLessons, settleLoopLesson } from "@/lib/db/loop-lessons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = selfHostGuard();
  if (guard) return guard;
  const url = new URL(request.url);
  const org = url.searchParams.get("org")?.trim().toLowerCase() ?? "";
  if (!org || org === PUBLIC_ORG) return NextResponse.json({ error: "Missing 'org'." }, { status: 400 });
  const denied = await requireOrgAccess(org);
  if (denied) return denied;
  const status = url.searchParams.get("status");
  return NextResponse.json({ lessons: await listLoopLessons(org, isLessonStatus(status) ? status : undefined) });
}

type Body = { org?: unknown; id?: unknown; action?: unknown };

export async function POST(request: Request) {
  const xo = requireSameOrigin(request);
  if (xo) return xo;
  const guard = selfHostGuard();
  if (guard) return guard;

  const body = (await request.json().catch(() => ({}))) as Body;
  const org = typeof body.org === "string" ? body.org.trim().toLowerCase() : "";
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const action = body.action === "keep" || body.action === "discard" ? body.action : null;
  if (!org || !id || !action) return NextResponse.json({ error: "Missing 'org', 'id' or 'action'." }, { status: 400 });
  if (org === PUBLIC_ORG) return NextResponse.json({ error: "The public funnel org has no lesson inbox." }, { status: 403 });

  const denied = await requireOrgRole(org, "member");
  if (denied) return denied;

  let promotedMemoryId: string | null = null;
  if (action === "keep") {
    // Read the candidate ORG-CONSTRAINED before writing anything: promotion creates a real memory
    // row, and creating one from a candidate we then fail to settle would leave the org believing
    // something with no record of who decided it.
    const candidate = await getLoopLesson(org, id);
    if (!candidate) return NextResponse.json({ error: "No such lesson candidate." }, { status: 404 });
    if (candidate.status !== "pending") {
      return NextResponse.json({ error: `This candidate was already ${candidate.status}.` }, { status: 409 });
    }
    const viewer = await getViewer().catch(() => null);
    const created = await createOrgMemory(
      org,
      {
        content: candidate.content,
        kind: candidate.kind,
        ...(candidate.namespace ? { namespace: candidate.namespace } : {}),
        source: LOOP_LESSON_SOURCE,
      },
      viewer?.login ?? null,
    ).catch(() => null);
    if (!created) return NextResponse.json({ error: "Could not write that lesson into memory." }, { status: 409 });
    promotedMemoryId = created.id;
  }

  const viewer = await getViewer().catch(() => null);
  const lesson = await settleLoopLesson(org, id, action, viewer?.login ?? null, promotedMemoryId);
  if (!lesson) return NextResponse.json({ error: "No such lesson candidate." }, { status: 404 });
  return NextResponse.json({ lesson });
}
