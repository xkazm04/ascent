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
import { getOrgBranding, getTechGroupIdByKey, isDbConfigured } from "@/lib/db";
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
  // A reseller can scope the briefing to one client via ?segment=<id> — a per-client deliverable.
  const segmentId = sp.get("segment");
  // ?stack=<key> scopes the deliverable to one tech-stack group (Feature 3b) — carried from the page.
  const techGroupId = await getTechGroupIdByKey(org, sp.get("stack")).catch(() => null);
  const briefing = await buildExecBriefing(org, { start: period.start, end: period.end }, period.title, segmentId, techGroupId).catch(
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
  let buffer: Buffer;
  try {
    // Try branded; on a bad/unreachable logo fall back to an unbranded render. If THAT also fails (or
    // there was no branding), the rejection used to escape as an unhandled 500 with a raw stack — wrap
    // the whole thing so a render failure degrades to a clean error instead.
    buffer = await render(branding).catch(() => (branding ? render(undefined) : Promise.reject(new Error("render failed"))));
  } catch (err) {
    console.error("[briefing/pdf] render failed", err);
    return NextResponse.json({ error: "Failed to render the briefing PDF." }, { status: 500 });
  }
  const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "-");
  // White-label the download name too: a branded org's export shouldn't reveal "ascent" in the filename.
  const brandSlug = branding?.brandName ? safe(branding.brandName).toLowerCase().slice(0, 40) : "ascent";
  const filename = `${brandSlug}-briefing-${safe(org)}-${safe(briefing.generatedOn)}.pdf`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, max-age=300",
    },
  });
}
