// OrgEmpty + ExportCsvLink — split out of ui.tsx to keep it under the 200-LOC cap
// (docs/ORG-TABS-REFACTOR.md). Server-safe. Re-exported from ui.tsx so every existing import site
// is unchanged.

import { EmptyState } from "@/components/EmptyState";

export function OrgEmpty({ title, body, href, cta }: { title: string; body: string; href?: string; cta?: string }) {
  return <EmptyState icon="🏔️" title={title} body={body} actions={[{ label: cta ?? "← Home", href: href ?? "/" }]} />;
}

/**
 * The "Export CSV" download anchor shared by the org tabs (contributors, delivery, …). Owns the
 * `/api/org/export` URL contract (`org`, `kind`, `format=csv`, optional `segment` + `stack`) and the
 * brand pill styling so a change to either lands in one place. Pass `className` for per-site
 * additions (e.g. `shrink-0`). Server-safe.
 *
 * BOTH page scopes must be forwarded: the pages compose segment AND tech-stack filters, so an export
 * that carried only the segment silently widened a stack-filtered view back to the whole fleet —
 * exactly the "numbers I circulated don't match what I saw" failure the scoped pages exist to prevent.
 */
export function ExportCsvLink({
  org,
  kind,
  segmentId,
  stack,
  className = "",
}: {
  org: string;
  kind: string;
  segmentId?: string | null;
  /** The active tech-stack group KEY (`activeStack?.key`), mirroring the page's `?stack=` param. */
  stack?: string | null;
  className?: string;
}) {
  const href =
    `/api/org/export?org=${encodeURIComponent(org)}&kind=${kind}&format=csv` +
    `${segmentId ? `&segment=${segmentId}` : ""}${stack ? `&stack=${encodeURIComponent(stack)}` : ""}`;
  return (
    <a
      href={href}
      className={`focus-ring rounded-md border border-slate-700 px-3 py-1.5 font-mono text-sm text-slate-300 transition hover:border-accent hover:text-white${className ? ` ${className}` : ""}`}
    >
      Export CSV
    </a>
  );
}
