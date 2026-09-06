// The digest-freshness badge: a showcase authored against the registry subject's digest, read
// against the org's index mirror. No hooks, no "use client" — the gallery renders it on the server
// and the scene frame renders it on the client.
//
// Three outcomes, and only two draw anything: the digests match → "current"; they differ →
// "authored against an older subject"; no mirror row, or a row from an index pass that predates the
// digest mirror → NO badge. Absent is honest; a guessed badge is not.

import type { SurfaceFreshness } from "@/lib/org/surface-freshness";

export type FreshnessLabel = "current" | "authored against an older subject";

export function freshnessOf(authoredDigest: string, mirror: SurfaceFreshness[string] | undefined): FreshnessLabel | null {
  if (!mirror?.digest) return null;
  return mirror.digest === authoredDigest ? "current" : "authored against an older subject";
}

export function SurfaceFreshnessBadge({ label }: { label: FreshnessLabel | null }) {
  if (!label) return null;
  const tone = label === "current" ? "border-success/40 text-success-soft" : "border-warn/40 text-warn";
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 type-caption ${tone}`} data-freshness={label}>
      {label}
    </span>
  );
}
