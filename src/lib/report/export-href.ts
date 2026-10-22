// The URLs the report header's export buttons fetch. Pure and client-safe (no server imports).
//
// The page's own `?org=` hint is forwarded so the export reads the report the page shows; it is a
// HINT, never trusted: the export door (./export-read.ts) re-gates it with canReadOrg, and an org the
// viewer cannot read falls back to the owner rule exactly as the page does.

export type ReportExportKind = "pdf" | "share-card";

export function reportExportHref(
  kind: ReportExportKind,
  repo: { owner: string; name: string; headSha?: string | null },
  org?: string | null,
): string {
  const ref = `${repo.owner}/${repo.name}${repo.headSha ? `@${repo.headSha}` : ""}`;
  const hint = org?.trim();
  return `/api/report/${kind}?repo=${encodeURIComponent(ref)}${hint ? `&org=${encodeURIComponent(hint)}` : ""}`;
}
