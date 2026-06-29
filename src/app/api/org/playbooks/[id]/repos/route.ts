// POST   /api/org/playbooks/:id/repos { repo } -> mark a repo as having applied this playbook
// DELETE /api/org/playbooks/:id/repos { repo } -> unmark it
// The org is resolved from the playbook (per-row gate); member-level access. Feeds adoption analytics.

import { NextResponse } from "next/server";
import { applyPlaybook, unapplyPlaybook } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { parseOrgRepo, resolvePlaybookOrg } from "@/lib/org/playbook-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { repo?: string };
  if (!body.repo?.trim()) return NextResponse.json({ error: "Provide { repo }." }, { status: 400 });
  const gated = await resolvePlaybookOrg(id);
  if (gated instanceof Response) return gated;
  // Tenant gate on the repo coordinate (shared with the PR-apply route via parseOrgRepo). This "mark
  // applied" path previously trusted the client `repo` string verbatim, so a member could record an
  // arbitrary or cross-tenant repo (e.g. "other-org/private") against the org's playbook — inflating
  // its "Adopted by N repos" count and flowing a foreign/typo'd repo name into Initiative scope
  // (PlaybookCard → trackAsInitiative). Require the repo to belong to this org.
  const coord = parseOrgRepo(body.repo, gated.org);
  if (coord instanceof Response) return coord;
  const session = await getSession();
  const ok = await applyPlaybook(gated.org, id, coord.fullName, session?.login ?? null);
  if (!ok) return NextResponse.json({ error: "Unknown playbook for this org." }, { status: 404 });
  return NextResponse.json({ ok: true, repo: coord.fullName });
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { repo?: string };
  if (!body.repo?.trim()) return NextResponse.json({ error: "Provide { repo }." }, { status: 400 });
  const gated = await resolvePlaybookOrg(id);
  if (gated instanceof Response) return gated;
  await unapplyPlaybook(id, body.repo.trim());
  return NextResponse.json({ ok: true });
}
