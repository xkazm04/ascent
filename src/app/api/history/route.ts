// GET /api/history?repo=owner/repo[&format=csv]  ->  prior scans + per-dimension scores (trends).
//   - default: the RepositoryHistory as JSON (ETag'd; powers the /trends charts)
//   - format=csv: the per-scan history as a CSV file download — the portable "show my boss progress"
//     artifact for a QBR deck / spreadsheet / CI pull.
// Requires DATABASE_URL (Phase 2). Returns 503 when persistence is disabled.

import { NextResponse } from "next/server";
import { parseRepoUrl } from "@/lib/github/source";
import { getRepositoryHistory, isDbConfigured, type RepositoryHistory } from "@/lib/db";
import { getSession, isAuthConfigured, readableOrgForOwner } from "@/lib/auth";
import { DIMENSIONS } from "@/lib/maturity/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Quote a CSV field iff it contains a comma, quote, or newline (RFC 4180). Total by design: a value
 *  whose String() throws (a throwing toString, an unexpected object from a future DB shape) must not
 *  blow up the whole export — it degrades to an empty cell, not a generic 500 for every scan. */
function csvField(v: unknown): string {
  let s: string;
  try {
    s = v == null ? "" : String(v);
  } catch {
    s = "";
  }
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Per-scan history as CSV (oldest → newest), one column per dimension. */
function historyToCsv(history: RepositoryHistory): string {
  const dimIds = DIMENSIONS.map((d) => d.id);
  const header = ["scannedAt", "overall", "level", "levelName", "engine", ...dimIds].join(",");
  const rows = [...history.scans].reverse().map((s) => {
    const byDim = new Map((s.dimensions ?? []).map((d) => [d.dimId, d.score]));
    const dims = dimIds.map((id) => csvField(byDim.get(id) ?? ""));
    // Quote EVERY field uniformly (was raw for scannedAt/overall/dims): if any value ever gains a
    // comma (a comma'd locale timestamp, a stringy dim cell), an unquoted field shifts the column
    // count and misaligns the whole export.
    return [csvField(s.scannedAt), csvField(s.overallScore), csvField(s.level), csvField(s.levelName), csvField(s.engineProvider), ...dims].join(",");
  });
  return [header, ...rows].join("\n") + "\n";
}

/** Reduce a repo full-name to a safe ASCII token for a Content-Disposition filename (no CRLF / quote
 *  injection from a slug). The real identity lives in the payload. */
function safeFilenameSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "repo";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const repo = searchParams.get("repo");
  if (!repo) {
    return NextResponse.json({ error: "Missing 'repo' query parameter." }, { status: 400 });
  }
  const parsed = parseRepoUrl(repo);
  if (!parsed) {
    return NextResponse.json({ error: "Invalid repository reference." }, { status: 400 });
  }
  if (!isDbConfigured()) {
    return NextResponse.json(
      { error: "History is unavailable: no database configured (Phase 2 feature)." },
      { status: 503 },
    );
  }

  // Gate behind a session when auth is configured, mirroring the /trends page this API
  // feeds. The org-scoping below already prevents cross-tenant reads (an unauthenticated
  // caller resolves to the "public" org), but requiring sign-in keeps the API and page in
  // lockstep and blocks anonymous enumeration of owner/repo slugs. Auth-off (local/demo)
  // deployments skip the gate, consistent with the rest of the app.
  if (isAuthConfigured() && !(await getSession())) {
    return NextResponse.json({ error: "Sign in to view history." }, { status: 401 });
  }

  try {
    // Scope to the org the caller may read (own org via session, else public) so a
    // name collision can't leak another tenant's history.
    const orgSlug = await readableOrgForOwner(parsed.owner);
    const wantCsv = searchParams.get("format") === "csv";
    // `?dims=0` requests the lightweight overall-only series (skips the per-dimension fan-out) for
    // callers that chart only the overall line; the default (and any CSV export) returns dimensions.
    const includeDimensions = wantCsv || searchParams.get("dims") !== "0";
    const history = await getRepositoryHistory(parsed.owner, parsed.repo, { orgSlug, includeDimensions });
    const payload =
      history ??
      { repo: { owner: parsed.owner, name: parsed.repo, fullName: `${parsed.owner}/${parsed.repo}` }, scans: [] };

    if (wantCsv) {
      const file = `ascent-trends-${safeFilenameSlug(payload.repo.fullName)}-${payload.scans[0]?.scannedAt?.slice(0, 10) ?? "history"}.csv`;
      return new NextResponse(historyToCsv(payload), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${file}"`,
          "cache-control": "private, no-store",
        },
      });
    }

    // A repo's history is append-only: existing scan points are immutable snapshots; only new
    // points append. So a weak validator over (mode, count, newest-scan-id) changes iff a new scan
    // landed (the mode marker keeps the light and full responses from sharing an ETag). Emit it and
    // answer a matching If-None-Match with a free 304 so the /trends page and any pollers don't
    // re-transfer an unchanged series. Caching is `private` (not `s-maxage`): the payload is
    // org-scoped and may be auth-gated, so it must never sit in a shared proxy cache where another
    // tenant could receive it.
    // Fold a content signature of the newest scan (scannedAt + overallScore) into the validator, not
    // just (mode, count, newest id): a malformed newest row later CORRECTED in place — same id, same
    // total count — left the weak ETag unchanged, so a client holding it got a 304 forever and never
    // saw the fix. The signature changes when the newest row's timestamp or score changes.
    const newest = payload.scans[0];
    const sig = newest ? `${newest.id}-${newest.scannedAt}-${newest.overallScore}` : "none";
    const etag = `W/"h${includeDimensions ? "f" : "l"}${payload.scans.length}-${sig}"`;
    const headers: Record<string, string> = {
      etag,
      "cache-control": "private, max-age=30, stale-while-revalidate=300",
    };
    if (request.headers.get("if-none-match") === etag) {
      return new NextResponse(null, { status: 304, headers });
    }
    return NextResponse.json(payload, { headers });
  } catch (err) {
    console.error("[history] query failed", err);
    return NextResponse.json({ error: "Failed to load history." }, { status: 500 });
  }
}
