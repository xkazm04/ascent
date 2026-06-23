// POST   /api/org/playbooks/:id/repos { repo } -> mark a repo as having applied this playbook
// DELETE /api/org/playbooks/:id/repos { repo } -> unmark it
// The org is resolved from the playbook (per-row gate); member-level access. Feeds adoption analytics.

import { NextResponse } from "next/server";
import { applyPlaybook, unapplyPlaybook } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { parseRepoUrl } from "@/lib/github/source";
import { resolvePlaybookOrg } from "@/lib/org/playbook-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { repo?: string };
  if (!body.repo?.trim()) return NextResponse.json({ error: "Provide { repo }." }, { status: 400 });
  const gated = await resolvePlaybookOrg(id);
  if (gated instanceof Response) return gated;
  // Tenant gate on the repo coordinate — mirror the PR-apply route (apply/route.ts:47-51). This
  // "mark applied" path previously trusted the client `repo` string verbatim, so a member could
  // record an arbitrary or cross-tenant repo (e.g. "other-org/private") against the org's playbook —
  // inflating its "Adopted by N repos" count and flowing a foreign/typo'd repo name into Initiative
  // scope (PlaybookCard → trackAsInitiative). Require the repo to belong to this org.
  const parsed = parseRepoUrl(body.repo.trim());
  if (!parsed) return NextResponse.json({ error: "Provide { repo: 'owner/name' }." }, { status: 400 });
  if (parsed.owner.toLowerCase() !== gated.org.toLowerCase()) {
    return NextResponse.json({ error: `Repo must belong to ${gated.org}.` }, { status: 400 });
  }
  const fullName = `${parsed.owner}/${parsed.repo}`;
  const session = await getSession();
  const ok = await applyPlaybook(gated.org, id, fullName, session?.login ?? null);
  if (!ok) return NextResponse.json({ error: "Unknown playbook for this org." }, { status: 404 });
  return NextResponse.json({ ok: true, repo: fullName });
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
