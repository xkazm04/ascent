// GET /api/history?repo=owner/repo[&format=csv]  ->  prior scans + per-dimension scores (trends).
//   - default: the RepositoryHistory as JSON (ETag'd; powers the /trends charts)
//   - format=csv: the per-scan history as a CSV file download — the portable "show my boss progress"
//     artifact for a QBR deck / spreadsheet / CI pull.
// Requires DATABASE_URL (Phase 2). Returns 503 when persistence is disabled.

import { NextResponse } from "next/server";
import { parseRepoUrl } from "@/lib/github/source";
import { getRepositoryHistory, isDbConfigured, type RepositoryHistory } from "@/lib/db";
import { sha256Hex } from "@/lib/db/audit-integrity";
import { isAuthConfigured, readableOrgForOwner } from "@/lib/auth";
import { authGateEnabled, resolveViewerLogin } from "@/lib/access";
import { canReadOrg } from "@/lib/authz";
import { DIMENSIONS } from "@/lib/maturity/model";
import { csvTable } from "@/lib/export/csv";
import { safeFilenameSlug } from "@/lib/export/filename";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Per-scan history as CSV (oldest → newest), one column per dimension. */
function historyToCsv(history: RepositoryHistory): string {
  const dimIds = DIMENSIONS.map((d) => d.id);
  // "engine" = provider (mock/bedrock/gemini/…), "model" = the specific model that graded the snapshot.
  // Both matter for an audit artifact: "mock" flags a deterministic-floor quarter, and the model name
  // lets an auditor tell a sonnet grade from a haiku one quarter to quarter. [Tiger P1-5]
  const header = ["scannedAt", "overall", "level", "levelName", "engine", "model", ...dimIds];
  const rows = [...history.scans].reverse().map((s) => {
    const byDim = new Map((s.dimensions ?? []).map((d) => [d.dimId, d.score]));
    const dims = dimIds.map((id) => byDim.get(id) ?? "");
    // csvTable quotes EVERY field uniformly via csvField: if any value ever gains a comma (a comma'd
    // locale timestamp, a stringy dim cell), an unquoted field shifts the column count and misaligns
    // the whole export.
    return [s.scannedAt, s.overallScore, s.level, s.levelName, s.engineProvider, s.engineModel, ...dims];
  });
  return csvTable(header, rows);
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
  // Keyed on the DORMANT custom-OAuth predicate, this never fired in production: the 401 was dead code
  // and the endpoint stayed anonymously reachable (org-scoping still prevented cross-tenant reads, but
  // the slug-enumeration block the comment above promises did not exist). Gate on whichever stack is live.
  if ((authGateEnabled() || isAuthConfigured()) && !(await resolveViewerLogin())) {
    return NextResponse.json({ error: "Sign in to view history." }, { status: 401 });
  }

  try {
    // Scope to the org the caller may read (own org via session, else public) so a name collision
    // can't leak another tenant's history. An explicit `?org={slug}` wins when the caller may read it
    // (canReadOrg) — so an in-app link can address a repo under its OWNING tenant even when the org
    // slug differs from the owner login (e.g. a rebranded org). The gate keeps it from reaching
    // another tenant's private history.
    const orgHint = searchParams.get("org")?.trim().toLowerCase();
    const orgSlug = orgHint && (await canReadOrg(orgHint)) ? orgHint : await readableOrgForOwner(parsed.owner);
    const wantCsv = searchParams.get("format") === "csv";
    // `?dims=0` requests the lightweight overall-only series (skips the per-dimension fan-out) for
    // callers that chart only the overall line; the default (and any CSV export) returns dimensions.
    const includeDimensions = wantCsv || searchParams.get("dims") !== "0";
    // Honor `?limit=` so callers (DimensionTrends sends the overall series' length) can align ranges
    // with the server-fetched trend series; the DB layer clamps it to 1..200 and coerces junk to 30.
    // CSV defaults to the 200 retention cap so an export isn't silently truncated to the newest 30
    // scans of a possibly years-long history; JSON keeps the default (30) when no limit is given.
    const limitParam = searchParams.get("limit");
    const limitRaw = limitParam == null ? NaN : Number(limitParam);
    const limit = Number.isFinite(limitRaw) ? limitRaw : wantCsv ? 200 : undefined;
    const history = await getRepositoryHistory(parsed.owner, parsed.repo, { orgSlug, includeDimensions, limit });
    const payload =
      history ??
      { repo: { owner: parsed.owner, name: parsed.repo, fullName: `${parsed.owner}/${parsed.repo}` }, scans: [] };

    if (wantCsv) {
      const file = `ascent-trends-${safeFilenameSlug(payload.repo.fullName, "repo")}-${payload.scans[0]?.scannedAt?.slice(0, 10) ?? "history"}.csv`;
      const body = historyToCsv(payload);
      return new NextResponse(body, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${file}"`,
          "cache-control": "private, no-store",
          // Self-verifying integrity for the filed artifact: recompute SHA-256 over the bytes to confirm
          // the export wasn't altered after download.
          "x-ascent-content-sha256": sha256Hex(body),
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
    // Fold a content signature of the WHOLE series into the validator, not just the newest scan: an
    // in-place fix to an OLDER row (same id, same total count, newest untouched) must still bust the
    // cache. Signing only the newest scan (scannedAt + overallScore) left a client holding the ETag a
    // 304 forever after any historical correction — it never saw the fix (trends-comparison #6). Hash a
    // compact per-scan projection of every point (id, timestamp, overall, level, and each dimension score
    // when dimensions are included) so a corrected value anywhere in the series changes the tag.
    const seriesSig = payload.scans.length
      ? sha256Hex(
          payload.scans
            .map(
              (s) =>
                `${s.id}:${s.scannedAt}:${s.overallScore}:${s.level}:${(s.dimensions ?? [])
                  .map((d) => `${d.dimId}=${d.score}`)
                  .join(",")}`,
            )
            .join("|"),
        ).slice(0, 24)
      : "none";
    const etag = `W/"h${includeDimensions ? "f" : "l"}${payload.scans.length}-${seriesSig}"`;
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
