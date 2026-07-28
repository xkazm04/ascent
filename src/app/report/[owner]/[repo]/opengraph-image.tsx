import { ImageResponse } from "next/og";
import { getScanReportByCommit } from "@/lib/db";
import { readableOrgForOwner } from "@/lib/auth";
import { OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og/og-brand";
import { ReportShareCard, ReportShareCardFallback } from "@/lib/og/report-card";
import { parseRepoParam } from "./repoParam";

// Per-repo social card for the report permalink — the image the page's generateMetadata advertises
// via twitter:summary_large_image. SHELL-1: when the repo has a persisted scan we draw its real
// score + level + a dimension strip; otherwise (no DB, private, or never scanned) we fall back to a
// static card built purely from the route params, so an unfurl can NEVER fail. The DB read is
// best-effort and wrapped — any error degrades to the static card.
//
// The artwork itself lives in `@/lib/og/report-card` (G5-04) so this unfurl and the downloadable
// share card (`GET /api/report/share-card`) are the same image, including its provenance caveats
// (demo badge / incomplete-scan degradation). This route owns only the crawler-facing read.

export const runtime = "nodejs"; // the scan lookup uses the Prisma client
export const alt = "Ascent maturity report";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const { name, sha } = parseRepoParam(repo);
  const ref = `${owner}/${name}`;

  // Best-effort: resolve the readable org + pinned/latest report. Any failure → static fallback.
  const report = await (async () => {
    try {
      const orgSlug = await readableOrgForOwner(owner);
      return await getScanReportByCommit(owner, name, { headSha: sha, orgSlug });
    } catch {
      return null;
    }
  })();

  return new ImageResponse(
    report ? <ReportShareCard report={report} sha={sha} /> : <ReportShareCardFallback repoRef={ref} />,
    { ...size },
  );
}
