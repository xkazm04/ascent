// Perimeter sub-components (W3, real data) — the checkpoint, the tier bands, and the sealed zones.
// Co-located so StancePerimeter.tsx stays the orchestrator and under 300 LOC. Server-safe except
// the imported AckButton (its own "use client" island).
//
// Tier bands are fed by each repo's REAL autonomy tier from the SHARED resolver
// (passport-autonomy.ts via the stored passport) — never a local tier derivation. Provenance % is
// the W2 trailer-grounded aiTrailerRate. Everything is declared-vs-observed; path-scoped zones
// carry the advisory label verbatim.
//
// The checkpoint and the sealed zones now live in their own co-located files (200-LOC cap) and are
// re-exported here, so this module stays the one import site for the whole perimeter.

import { Kicker } from "@/components/ui";
import { LEVEL_HEX, scoreHex, reportPermalink } from "@/lib/ui";
import type { LevelId, AutonomyTierId } from "@/lib/types";
import type { RepoStanceCompliance } from "@/lib/org/stance";
import { AckMark, TIER_HEX, TIER_META } from "./stanceShared";
import { AckButton } from "./AckButton";

export { CheckpointStrip } from "./CheckpointStrip";
export { SealedZones } from "./SealedZones";

/** A repo as a node inside a band — real level/overall, ack state, trailer provenance, findings. */
export function RepoNode({
  repo,
  org,
  version,
  canAck,
}: {
  repo: RepoStanceCompliance;
  org: string;
  version: number;
  canAck: boolean;
}) {
  const levelHex = LEVEL_HEX[repo.level as LevelId] ?? "#64748b";
  const findings = repo.findings.filter((f) => !f.advisory);
  return (
    <div
      className="rounded-lg border border-divider bg-ink/80 px-3 py-2 transition hover:border-accent/60"
      title={findings.map((f) => f.message).join("\n") || repo.fullName}
    >
      <div className="flex items-center gap-2">
        <a href={reportPermalink(repo.fullName, null, org)} className="focus-ring truncate font-mono text-sm text-slate-100 hover:text-white">
          {repo.name}
        </a>
        <span className="ml-auto font-mono text-xs tabular-nums" style={{ color: levelHex }}>
          {repo.level}
        </span>
        <span className="font-mono text-xs tabular-nums" style={{ color: scoreHex(repo.overall) }}>
          {repo.overall}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <AckMark ack={repo.ack} ackedVersion={repo.ackedVersion} showLabel={false} />
        {repo.provenancePct != null && (
          <span className="font-mono text-xs tabular-nums text-slate-500">prov {repo.provenancePct}%</span>
        )}
        {findings.length > 0 && (
          <span className="font-mono text-xs tabular-nums text-danger">
            {findings.length} finding{findings.length === 1 ? "" : "s"}
          </span>
        )}
        {canAck && repo.ack !== "current" && (
          <span className="ml-auto">
            <AckButton org={org} repo={repo.fullName} version={version} />
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * One tier band. The bands stack from open (outermost, T0) to restricted (innermost, T3) and are
 * inset progressively so the page reads as depth into the perimeter. `review` is the stance's
 * declared requirement for the band (absent = the stance takes no position for this tier).
 */
export function PerimeterBand({
  tier,
  review,
  repos,
  org,
  version,
  canAck,
  tierIndex,
}: {
  tier: AutonomyTierId;
  review: string | null;
  repos: RepoStanceCompliance[];
  org: string;
  version: number;
  canAck: boolean;
  tierIndex: number;
}) {
  const hex = TIER_HEX[tier];
  const meta = TIER_META[tier];
  const findings = repos.reduce((a, r) => a + r.findings.filter((f) => !f.advisory).length, 0);
  return (
    <div style={{ marginLeft: `${tierIndex * 1.25}rem` }}>
      <div className="relative overflow-hidden rounded-2xl border border-divider bg-surface/40">
        <div aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: hex }} />
        <div className="relative p-5 pl-6">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-mono text-2xl tabular-nums" style={{ color: hex }}>
              {tier}
            </span>
            <span className="text-lg font-medium text-white">{meta.name}</span>
            <span className="text-sm text-slate-400">{meta.blurb}</span>
            <span className="ml-auto font-mono text-xs uppercase tracking-[0.18em] text-slate-500">
              {repos.length} repos{findings ? ` · ${findings} findings` : ""}
            </span>
          </div>
          <p className="mt-2 max-w-3xl text-base text-slate-200">
            {review ?? <span className="text-slate-500">No review requirement declared for this tier.</span>}
          </p>
          {repos.length > 0 ? (
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {repos.map((r) => (
                <RepoNode key={r.fullName} repo={r} org={org} version={version} canAck={canAck} />
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">No repo currently sits in this band.</p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Repos whose latest scan carries no passport: the tier is NOT assessed — said plainly, never
 *  defaulted into a band. A re-scan assigns them honestly. */
export function UnassessedRepos({
  repos,
  org,
  version,
  canAck,
}: {
  repos: RepoStanceCompliance[];
  org: string;
  version: number;
  canAck: boolean;
}) {
  if (repos.length === 0) return null;
  return (
    <div className="rounded-2xl border border-dashed border-divider bg-surface/20 p-5">
      <Kicker tone="muted">Tier not assessed</Kicker>
      <p className="mt-2 max-w-3xl text-sm text-slate-400">
        These repos have no readiness passport on their latest scan, so no autonomy band can honestly be assigned.
        Re-scan to place them.
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {repos.map((r) => (
          <RepoNode key={r.fullName} repo={r} org={org} version={version} canAck={canAck} />
        ))}
      </div>
    </div>
  );
}
