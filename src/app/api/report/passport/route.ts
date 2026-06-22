// GET /api/report/passport?repo=owner/name[@sha]  -> application/json (the App Readiness Passport)
//
// Serves the stored passport for a persisted scan — the descriptive, tool-naming portfolio scorecard
// (see APP_READINESS_PASSPORT.md). Read-gated by the owning org exactly like the report PDF/skill
// exports: a PUBLIC repo's passport is open (its stack is inferable from the public repo anyway), a
// PRIVATE repo's passport is as sensitive as the report (it names integrations/persistence/secretsFrom)
// and requires org read access. 404 when the repo has no saved scan — this reflects an existing scan,
// it never triggers one. `?download` returns it as a .passport.json file.

import { NextResponse } from "next/server";
import { getRepoPassport, isDbConfigured } from "@/lib/db";
import { readableOrgForOwner } from "@/lib/auth";
import { requireOrgRead } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseRepo(q: string): { owner: string; name: string; sha?: string } | null {
  const at = q.indexOf("@");
  const base = at < 0 ? q : q.slice(0, at);
  const sha = at < 0 ? undefined : q.slice(at + 1) || undefined;
  const slash = base.indexOf("/");
  if (slash <= 0 || slash === base.length - 1) return null;
  return { owner: base.slice(0, slash), name: base.slice(slash + 1), sha };
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "-");

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Passport export requires a database." }, { status: 503 });
  const url = new URL(request.url);
  const q = url.searchParams.get("repo");
  if (!q) return NextResponse.json({ error: "Missing ?repo=owner/name." }, { status: 400 });
  const parsed = parseRepo(q);
  if (!parsed) return NextResponse.json({ error: "Invalid repo. Use owner/name." }, { status: 400 });

  // Resolve the owning org and gate the read — a private repo's passport is as sensitive as its report.
  const orgSlug = await readableOrgForOwner(parsed.owner);
  const denied = await requireOrgRead(orgSlug);
  if (denied) return denied;

  const passport = await getRepoPassport(parsed.owner, parsed.name, { orgSlug, headSha: parsed.sha }).catch(() => null);
  if (!passport) {
    return NextResponse.json(
      { error: "No passport for this repository yet. Scan it first, then export." },
      { status: 404 },
    );
  }

  const headers: Record<string, string> = { "content-type": "application/json; charset=utf-8" };
  if (url.searchParams.has("download")) {
    const filename = `${safe(parsed.owner)}-${safe(parsed.name)}.passport.json`;
    headers["content-disposition"] = `attachment; filename="${filename}"`;
  }
  return new NextResponse(JSON.stringify(passport, null, 2), { headers });
}
