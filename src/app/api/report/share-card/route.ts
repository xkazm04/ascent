// GET /api/report/share-card?repo=owner/name[@sha][&org=slug]  -> image/png (attachment)
//
// The downloadable "share card" (G5-04): the score + level + dimension strip as a 1200×630 PNG a user
// can drop into a slide or a Slack message. Deliberately NOT a second renderer — it draws the exact
// artwork the report permalink already advertises as its social unfurl (`ReportShareCard`, shared via
// `@/lib/og/report-card`), so the image someone downloads is the image the link previews, caveats and
// all: an incomplete scan degrades to a "could not be completed" card instead of showing its 0/100,
// and a mock-engine report carries the DEMO badge.
//
// ACCESS. Read through the shared export door (`readReportForExport`, src/lib/report/export-read.ts):
// the permalink's org rule, gated before a STRICT read, so a private report's card is unreachable
// without org read access and an outage is a 503, never a 404. Not plan-gated: the same PNG is already
// served publicly as the permalink's OpenGraph image, so gating this route would protect nothing.
//
// 404 when the repo has no saved scan — unlike the unfurl (which must never fail, so it falls back to
// a static card), a DOWNLOAD must not hand back a contentless placeholder PNG the user would paste
// into a deck believing it carried a result.

import { createElement } from "react";
import { NextResponse } from "next/server";
import { reportHandledError } from "@/lib/api/respond";
import { ImageResponse } from "next/og";
import { readReportForExport } from "@/lib/report/export-read";
import { OG_SIZE } from "@/lib/og/og-brand";
import { ReportShareCard } from "@/lib/og/report-card";

export const runtime = "nodejs"; // the scan lookup uses the Prisma client
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const read = await readReportForExport(request, { label: "report/share-card", noun: "Share-card export" });
  if (!read.ok) return read.response;
  const { report, parsed, stem } = read;

  let png: ImageResponse;
  try {
    // `createElement` rather than JSX so this stays a plain `route.ts` (the route-handler filename
    // convention), matching how the PDF route builds its document element.
    png = new ImageResponse(createElement(ReportShareCard, { report, sha: parsed.sha }), { ...OG_SIZE });
  } catch (err) {
    // A satori/render failure must not escape as an unhandled 500 with a raw stack — DownloadButton
    // renders `{ error }` inline, so give it something to say.
    console.error("[report/share-card] render failed", err);
    reportHandledError(err, { message: "report/share-card render failed" });
    return NextResponse.json({ error: "Failed to render the share card." }, { status: 500 });
  }

  // The door sanitized the stem: the sha is caller-supplied and must not be able to inject a header.
  const filename = `${stem}-card.png`;
  const headers = new Headers(png.headers);
  headers.set("content-disposition", `attachment; filename="${filename}"`);
  // `no-store`, matching the sibling exports: "Retest" sits beside the export controls, so a cached
  // card could be downloaded PRE-RESCAN and pasted into a deck as current.
  headers.set("cache-control", "private, no-store");
  return new Response(png.body, { status: 200, headers });
}
