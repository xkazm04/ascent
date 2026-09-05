// GET /api/report/share-card?repo=owner/name[@sha]  -> image/png (attachment)
//
// The downloadable "share card" (G5-04): the score + level + dimension strip as a 1200×630 PNG a user
// can drop into a slide or a Slack message. Deliberately NOT a second renderer — it draws the exact
// artwork the report permalink already advertises as its social unfurl (`ReportShareCard`, shared via
// `@/lib/og/report-card`), so the image someone downloads is the image the link previews, caveats and
// all: an incomplete scan degrades to a "could not be completed" card instead of showing its 0/100,
// and a mock-engine report carries the DEMO badge.
//
// ACCESS. Read-gated like the sibling exports (`readableOrgForOwner` + `requireOrgRead`), so a private
// report's card is unreachable without org read access. Not plan-gated: the same PNG is already served
// publicly as the permalink's OpenGraph image, so gating this route would protect nothing.
//
// 404 when the repo has no saved scan — unlike the unfurl (which must never fail, so it falls back to
// a static card), a DOWNLOAD must not hand back a contentless placeholder PNG the user would paste
// into a deck believing it carried a result.

import { createElement } from "react";
import { NextResponse } from "next/server";
import { ImageResponse } from "next/og";
import { getScanReportByCommit, isDbConfigured } from "@/lib/db";
import { readableOrgForOwner } from "@/lib/auth";
import { requireOrgRead } from "@/lib/authz";
import { parseRepoParam } from "@/lib/report/repoParam";
import { safeFilenameSegment } from "@/lib/export/filename";
import { OG_SIZE } from "@/lib/og/og-brand";
import { ReportShareCard } from "@/lib/og/report-card";

export const runtime = "nodejs"; // the scan lookup uses the Prisma client
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isDbConfigured())
    return NextResponse.json({ error: "Share-card export requires a database." }, { status: 503 });
  const q = new URL(request.url).searchParams.get("repo");
  if (!q) return NextResponse.json({ error: "Missing ?repo=owner/name." }, { status: 400 });
  const parsed = parseRepoParam(q);
  if (!parsed) return NextResponse.json({ error: "Invalid repo. Use owner/name." }, { status: 400 });

  const orgSlug = await readableOrgForOwner(parsed.owner);
  const denied = await requireOrgRead(orgSlug);
  if (denied) return denied;

  let report;
  try {
    report = await getScanReportByCommit(parsed.owner, parsed.name, { headSha: parsed.sha, orgSlug });
  } catch (err) {
    console.error("[report/share-card] report lookup failed", err);
    return NextResponse.json(
      { error: "Couldn't load this report right now. Please try again in a moment." },
      { status: 503 },
    );
  }
  if (!report) {
    return NextResponse.json(
      { error: "No saved scan for this repository yet. Scan it first, then export." },
      { status: 404 },
    );
  }

  let png: ImageResponse;
  try {
    // `createElement` rather than JSX so this stays a plain `route.ts` (the route-handler filename
    // convention), matching how the PDF route builds its document element.
    png = new ImageResponse(createElement(ReportShareCard, { report, sha: parsed.sha }), { ...OG_SIZE });
  } catch (err) {
    // A satori/render failure must not escape as an unhandled 500 with a raw stack — DownloadButton
    // renders `{ error }` inline, so give it something to say.
    console.error("[report/share-card] render failed", err);
    return NextResponse.json({ error: "Failed to render the share card." }, { status: 500 });
  }

  // Sanitize every interpolated segment before the Content-Disposition header — the sha is
  // caller-supplied and unvalidated, so it must not be able to inject a header or a path separator.
  const filename = `ascent-${safeFilenameSegment(parsed.owner)}-${safeFilenameSegment(parsed.name)}${
    parsed.sha ? "-" + safeFilenameSegment(parsed.sha.slice(0, 7)) : ""
  }-card.png`;
  const headers = new Headers(png.headers);
  headers.set("content-disposition", `attachment; filename="${filename}"`);
  // `no-store`, matching the sibling exports: "Retest" sits beside the export controls, so a cached
  // card could be downloaded PRE-RESCAN and pasted into a deck as current.
  headers.set("cache-control", "private, no-store");
  return new Response(png.body, { status: 200, headers });
}
