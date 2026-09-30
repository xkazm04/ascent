// Declared no-AI zones. A contradiction is a glyph and the repo names, not a red count.
import { HairlineGrid, SectionHead } from "@/components/kit";
import { PATH_ZONE_ADVISORY_LABEL } from "@/lib/org/stance";
import type { StanceZoneView } from "@/lib/org/stance-overview";

const SEALED_HINT =
  "A sealed zone is a declared no-AI zone. The readout compares the declaration with observed git attribution, " +
  "reports contradictions, and never enforces the seal. It is unrelated to the control ledger's chained tamper-evidence above.";

export function SealedV2({ zones }: { zones: StanceZoneView[] }) {
  if (zones.length === 0) return null;
  return (
    <section className="mt-8" aria-label="Sealed zones">
      <SectionHead eyebrow="Sealed" title="No AI authorship" named="declared." lede={SEALED_HINT} />
      <HairlineGrid className="mt-4 sm:grid-cols-2">
        {zones.map((z, i) => {
          const breached = z.breachedRepos.length > 0;
          return (
            <div key={i} className="bg-ink p-4">
              {z.repoGlobs.length > 0 && <div className="font-mono text-slate-100">{z.repoGlobs.join(", ")}</div>}
              {z.pathGlobs.length > 0 && (
                <p className="mt-1 font-mono text-slate-300">
                  {z.pathGlobs.join(", ")} <span className="font-sans text-slate-400">advisory</span>
                </p>
              )}
              {z.pathGlobs.length > 0 && <p className="mt-1 type-body-sm text-slate-400">{PATH_ZONE_ADVISORY_LABEL}</p>}
              {z.reason && <p className="mt-1.5 type-body-sm text-slate-400">{z.reason}</p>}
              {z.repoGlobs.length > 0 && (
                <p className="mt-2 type-body-sm text-slate-200">
                  <span aria-hidden className="mr-1">
                    {breached ? "▲" : "✓"}
                  </span>
                  {z.matchedRepos.length} repo{z.matchedRepos.length === 1 ? "" : "s"} bound.{" "}
                  {breached
                    ? `AI attribution observed in ${z.breachedRepos.join(", ")}`
                    : "No AI attribution observed."}
                </p>
              )}
            </div>
          );
        })}
      </HairlineGrid>
    </section>
  );
}
