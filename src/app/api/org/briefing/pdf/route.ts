// GET /api/org/briefing/pdf?org=slug[&range=90d&from=&to=]  -> application/pdf
//
// Server-renders the executive briefing as a board-ready PDF (Direction #5 phase 2). Read-gated by the
// org (same as the Briefing page). 404 when the org has no scanned repos; 503 when a read failed. Same ExecBriefing source as
// the page + the "Copy for LLM" brief, so all three stay in lockstep.

import { createElement, type ReactElement } from "react";
import { NextResponse } from "next/server";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { BriefingDocument } from "@/lib/pdf/briefing-document";
import { buildExecBriefing } from "@/lib/org/briefing";
import { getTechGroupIdByKey, isDbConfigured } from "@/lib/db";
import { requireOrgRead } from "@/lib/authz";
import { respondError } from "@/lib/api/respond";
import { noteReadFailure } from "@/lib/org/degraded-read";
import { orgWindowBounds, resolveOrgWindow } from "@/lib/org/period";
import { attachBriefingNarrative } from "@/lib/org/briefing-narrative";
import { readDeliverableBranding } from "@/lib/branding/deliverable";
import { safeFilenameSegment } from "@/lib/export/filename";
import { pdfAttachmentResponse } from "@/lib/pdf/export-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The document render is CPU-bound and may additionally wait on the (opt-in, bounded) narrative pass;
// give it the same headroom the sibling security export takes.
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Briefing export requires a database." }, { status: 503 });
  const sp = new URL(request.url).searchParams;
  const org = sp.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  // Read gate only, on purpose: the briefing PDF is deliberately outside pdfExport (planAllowsPdfExport) and
  // free on every tier, unlike /api/report/pdf. See docs/adr/2026-10-07-briefing-pdf-free-on-every-tier.md.
  const denied = await requireOrgRead(org);
  if (denied) return denied;

  // G5-10: resolve the window the SAME way the Executive page does — `resolveOrgWindow`, which layers
  // the remembered-period cookie UNDER an explicit ?range= (so the page's own download link, which
  // always carries ?range=, is authoritative and unaffected). The cookie-blind `resolveWindow` used
  // here before meant a bookmarked or shared PDF URL with no ?range= silently exported the 90d default
  // while the page beside it showed the org's remembered period. Window arithmetic (canonical zone,
  // calendar days, half-open bounds) is inherited unchanged from `@/lib/org/timezone` via resolveWindow.
  const period = await resolveOrgWindow({
    range: sp.get("range") ?? undefined,
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
  });
  // A reseller can scope the briefing to one client via ?segment=<id> — a per-client deliverable.
  const segmentId = sp.get("segment");
  // ?stack=<key> scopes the deliverable to one tech-stack group (Feature 3b) — carried from the page.
  // FAIL CLOSED on an unresolvable scope: `null` from the resolver is overloaded ("no scope requested"
  // vs "requested but renamed/deleted/DB hiccup"), and passing it through would silently render the
  // WHOLE-org briefing under a URL the owner scoped down. Only `null-because-absent` stays unscoped.
  const stackKey = sp.get("stack");
  // A FAILED read is not "no such scope": the first is a server fault (503, try again), the second a
  // genuinely unresolvable key (404). Both fail closed; only the wording and status differ.
  let techGroupId: string | null = null;
  if (stackKey) {
    try {
      techGroupId = await getTechGroupIdByKey(org, stackKey);
    } catch (err) {
      return respondError(503, "Could not check the tech-stack scope just now. Try again.", { cause: err });
    }
    if (!techGroupId) {
      return NextResponse.json({ error: "Unknown tech-stack scope for this organization." }, { status: 404 });
    }
  }
  // A thrown build is not an empty fleet: 503 (a server fault 5xx monitoring can count) with an honest
  // body DownloadButton shows inline, versus 404 for a fleet that genuinely has no scans.
  let built: Awaited<ReturnType<typeof buildExecBriefing>>;
  try {
    built = await buildExecBriefing(org, orgWindowBounds(period), period.title, segmentId, techGroupId);
  } catch (err) {
    console.error("[briefing/pdf] build failed", err instanceof Error ? err.message : err);
    return respondError(503, "Could not build the briefing. Try again.", { cause: err });
  }
  if (!built) {
    return NextResponse.json({ error: "No scanned repositories yet for this organization." }, { status: 404 });
  }
  // G5-03: the board PDF is the one deliverable that opts into the narrative pass. It is grounded
  // strictly in the figures already assembled above, and `attachBriefingNarrative` never throws —
  // an unconfigured/failed/ungrounded model call yields the deterministic paragraph instead, so this
  // can neither fail the download nor introduce a figure that isn't in the briefing.
  const briefing = await attachBriefingNarrative(built);

  // EXEC-5: white-label branding for the PDF, through the one deliverable door. It re-checks the
  // CURRENT plan (the brand columns survive a downgrade, so an unconditional apply would keep delivering
  // a paid feature) and hands back the logo as the snapshot taken at save: a data: URI, so @react-pdf
  // makes no network request and this route never fetches the owner's host at render time.
  const branding = (await readDeliverableBranding(org, { surface: "briefing pdf" })) ?? undefined;
  const render = (b: typeof branding) =>
    renderToBuffer(createElement(BriefingDocument, { briefing, branding: b }) as unknown as ReactElement<DocumentProps>);
  let buffer: Buffer;
  try {
    // The ladder: branded -> branded without the logo -> unbranded. A logo failure must not strip the
    // brand name and accent with it (the filename below still carries the brand), so the middle rung
    // keeps them. If the last rung also fails the rejection lands in the catch below as a clean 500.
    buffer = await render(branding).catch((err: unknown) => {
      if (!branding) throw err;
      noteReadFailure("briefing pdf branded render (retrying without the logo)", err);
      const withoutLogo = branding.logoUrl ? render({ ...branding, logoUrl: null }) : Promise.reject(err);
      return withoutLogo.catch((err2: unknown) => {
        if (branding.logoUrl) noteReadFailure("briefing pdf logo-less render (retrying unbranded)", err2);
        return render(undefined);
      });
    });
  } catch (err) {
    console.error("[briefing/pdf] render failed", err);
    return respondError(500, "Failed to render the briefing PDF.", { cause: err });
  }
  // White-label the download name too: a branded org's export shouldn't reveal "ascent" in the filename.
  const brandSlug = branding?.brandName ? safeFilenameSegment(branding.brandName).toLowerCase().slice(0, 40) : "ascent";
  // A per-client briefing carries the client in its name too, so two clients exported on one day are
  // two different files rather than one overwriting the other in a download folder.
  const client = briefing.segmentName ? `-${safeFilenameSegment(briefing.segmentName)}` : "";
  const filename = `${brandSlug}-briefing-${safeFilenameSegment(org)}${client}-${safeFilenameSegment(briefing.generatedOn)}.pdf`;
  return pdfAttachmentResponse(buffer, filename, "private, max-age=300");
}
