// GET /api/org/briefing/pdf?org=slug[&range=90d&from=&to=]  -> application/pdf
//
// Server-renders the executive briefing as a board-ready PDF (Direction #5 phase 2). Read-gated by the
// org (same as the Briefing page). 404 when the org has no scanned repos. Same ExecBriefing source as
// the page + the "Copy for LLM" brief, so all three stay in lockstep.

import { createElement, type ReactElement } from "react";
import { NextResponse } from "next/server";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { BriefingDocument } from "@/lib/pdf/briefing-document";
import { buildExecBriefing } from "@/lib/org/briefing";
import { getOrgBranding, isDbConfigured } from "@/lib/db";
import { requireOrgRead } from "@/lib/authz";
import { resolveWindow } from "@/lib/window";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Briefing export requires a database." }, { status: 503 });
  const sp = new URL(request.url).searchParams;
  const org = sp.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  const denied = await requireOrgRead(org);
  if (denied) return denied;

  const period = resolveWindow({
    range: sp.get("range") ?? undefined,
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
  });
  const briefing = await buildExecBriefing(org, { start: period.start, end: period.end }, period.title).catch(
    () => null,
  );
  if (!briefing) {
    return NextResponse.json({ error: "No scanned repositories yet for this organization." }, { status: 404 });
  }

  // EXEC-5: white-label branding for the PDF. A bad/unreachable logo could fail rendering, so fall
  // back to an unbranded render rather than 500 the download.
  const branding = (await getOrgBranding(org).catch(() => null)) ?? undefined;
  const render = (b: typeof branding) =>
    renderToBuffer(createElement(BriefingDocument, { briefing, branding: b }) as unknown as ReactElement<DocumentProps>);
  const buffer = await render(branding).catch(() => (branding ? render(undefined) : Promise.reject(new Error("render failed"))));
  const filename = `ascent-briefing-${org}-${briefing.generatedOn}.pdf`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, max-age=300",
    },
  });
}
