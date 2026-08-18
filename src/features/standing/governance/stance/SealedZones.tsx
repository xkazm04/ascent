// The sealed interior of the perimeter (W3, real data) — extracted from perimeterParts.tsx so every
// file stays under the 200-LOC cap (AGENTS.md). Server-safe. Path-scoped zones carry the advisory
// label verbatim; the readout compares the declaration with observed attribution, it never enforces.

import { Kicker } from "@/components/ui";
import { PATH_ZONE_ADVISORY_LABEL } from "@/lib/org/stance";
import type { StanceZoneView } from "@/lib/org/stance-overview";

/** The sealed interior: declared no-AI zones, and whether observed attribution contradicts them. */
export function SealedZones({ zones }: { zones: StanceZoneView[] }) {
  if (zones.length === 0) return null;
  return (
    <div className="rounded-2xl border border-danger/30 bg-surface/40 p-5">
      <Kicker>Sealed · no AI authorship declared</Kicker>
      <p className="mt-2 max-w-3xl text-base text-slate-300">
        Inside the perimeter these repos and paths are declared closed regardless of tier. The readout below compares
        the declaration with OBSERVED git attribution: it reports contradictions, it does not enforce the seal.
      </p>
      <ul className="mt-4 grid gap-px overflow-hidden rounded-xl border border-divider bg-divider sm:grid-cols-2">
        {zones.map((z, i) => (
          <li key={i} className="bg-ink p-4">
            {z.repoGlobs.length > 0 && (
              <div className="font-mono text-sm text-slate-100">{z.repoGlobs.join(", ")}</div>
            )}
            {z.pathGlobs.length > 0 && (
              <div className="mt-1 font-mono text-sm text-slate-300">
                {z.pathGlobs.join(", ")}{" "}
                <span className="font-sans text-xs text-slate-500" title={PATH_ZONE_ADVISORY_LABEL}>
                  · advisory
                </span>
              </div>
            )}
            {z.pathGlobs.length > 0 && <p className="mt-1 text-xs text-slate-500">{PATH_ZONE_ADVISORY_LABEL}</p>}
            {z.reason && <p className="mt-1.5 text-sm text-slate-400">{z.reason}</p>}
            {z.repoGlobs.length > 0 && (
              <p className="mt-2 font-mono text-xs uppercase tracking-[0.18em]" style={{ color: z.breachedRepos.length ? "#ef4444" : "#10b981" }}>
                {z.matchedRepos.length} repo{z.matchedRepos.length === 1 ? "" : "s"} bound ·{" "}
                {z.breachedRepos.length ? `AI attribution observed in ${z.breachedRepos.join(", ")}` : "no AI attribution observed"}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
