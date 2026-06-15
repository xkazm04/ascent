// GET /api/org/security/pdf?org=slug[&range=90d&from=&to=]  -> application/pdf
//
// Server-renders the security posture as a board/auditor-ready PDF (SEC-6). Read-gated by the org (same
// as the Security page). 404 when the org has no scanned repos. Same SecurityOverview source as the
// page + the "Copy for LLM" brief, so all three stay in lockstep. Mirrors the briefing PDF route.

import { createElement, type ReactElement } from "react";
import { NextResponse } from "next/server";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { SecurityDocument } from "@/lib/pdf/security-document";
import { buildSecurityOverview } from "@/lib/org/security";
import { isDbConfigured } from "@/lib/db";
import { requireOrgRead } from "@/lib/authz";
import { resolveWindow } from "@/lib/window";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Security export requires a database." }, { status: 503 });
  const sp = new URL(request.url).searchParams;
  const org = sp.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  const denied = await requireOrgRead(org);
  if (denied) return denied;

  const period = resolveWindow({ range: sp.get("range") ?? undefined, from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined });
  const overview = await buildSecurityOverview(org, { start: period.start, end: period.end }, period.title).catch(() => null);
  if (!overview) {
    return NextResponse.json({ error: "No scanned repositories yet for this organization." }, { status: 404 });
  }

  const element = createElement(SecurityDocument, { overview }) as unknown as ReactElement<DocumentProps>;
  const buffer = await renderToBuffer(element);
  const filename = `ascent-security-${org}-${overview.generatedOn}.pdf`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, max-age=300",
    },
  });
}
