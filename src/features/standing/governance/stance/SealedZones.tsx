// The sealed interior of the perimeter (W3, real data) — extracted from perimeterParts.tsx so every
// file stays under the 200-LOC cap (AGENTS.md). Server-safe. Path-scoped zones carry the advisory
// label verbatim; the readout compares the declaration with observed attribution, it never enforces.

import { Kicker } from "@/components/ui";
import { Legend, StateSwatch, WhyChip, stateTitle } from "@/components/org/viz";
import { PATH_ZONE_ADVISORY_LABEL } from "@/lib/org/stance";
import type { StanceZoneView } from "@/lib/org/stance-overview";

/** MC-B10, demoted (D + F): on this tab SEALED means a declared no-AI zone and nothing else. The
 *  control ledger's tamper-evidence one scroll above says "chained"; the two are unrelated. */
const SEALED_HINT =
  "A sealed zone is a DECLARED no-AI zone: the readout compares the declaration with observed git attribution, " +
  "reports contradictions, and never enforces the seal. It is unrelated to the control ledger's \"chained\" " +
  "tamper-evidence above.";

/** The sealed interior: declared no-AI zones, and whether observed attribution contradicts them. */
export function SealedZones({ zones }: { zones: StanceZoneView[] }) {
  if (zones.length === 0) return null;
  // Encoded, not asserted (§2.4): a zone nothing contradicts is `declared` — dashed, on paper only.
  // A zone with AI attribution observed inside it is a `measured` contradiction.
  const breached = zones.some((z) => z.breachedRepos.length > 0);
  return (
    <div className="rounded-2xl border border-danger/30 bg-surface/40 p-5">
      <div className="flex items-center gap-1.5">
        <Kicker>Sealed · no AI authorship declared</Kicker>
        <WhyChip label="what sealed means here" hint={SEALED_HINT} />
      </div>
      <Legend className="mt-2" states={breached ? ["declared", "measured"] : ["declared"]} />
      <ul className="mt-4 grid gap-px overflow-hidden rounded-xl border border-divider bg-divider sm:grid-cols-2">
        {zones.map((z, i) => (
          <li key={i} className="bg-ink p-4">
            <span
              className="mb-1.5 inline-block"
              title={stateTitle(z.breachedRepos.length ? "measured" : "declared", "Sealed zone")}
            >
              <StateSwatch state={z.breachedRepos.length ? "measured" : "declared"} size={12} />
            </span>
            {z.repoGlobs.length > 0 && (
              <div className="type-mono-sm text-slate-100">{z.repoGlobs.join(", ")}</div>
            )}
            {z.pathGlobs.length > 0 && (
              <div className="mt-1 type-mono-sm text-slate-300">
                {z.pathGlobs.join(", ")}{" "}
                <span className="font-sans type-micro text-slate-500" title={PATH_ZONE_ADVISORY_LABEL}>
                  · advisory
                </span>
              </div>
            )}
            {z.pathGlobs.length > 0 && <p className="mt-1 type-micro text-slate-500">{PATH_ZONE_ADVISORY_LABEL}</p>}
            {z.reason && <p className="mt-1.5 type-body-sm text-slate-400">{z.reason}</p>}
            {z.repoGlobs.length > 0 && (
              <p className="mt-2 font-mono type-micro uppercase tracking-[0.18em]" style={{ color: z.breachedRepos.length ? "#ef4444" : "#10b981" }}>
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
