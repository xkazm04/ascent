// Perimeter sub-components (W3, real data) — the checkpoint, the tier bands, and the sealed zones.
// Co-located so StancePerimeter.tsx stays the orchestrator and under 300 LOC. Server-safe except
// the imported AckButton (its own "use client" island).
//
// Tier bands are fed by each repo's REAL autonomy tier from the SHARED resolver
// (passport-autonomy.ts via the stored passport) — never a local tier derivation. Provenance % is
// the W2 trailer-grounded aiTrailerRate. Everything is declared-vs-observed; path-scoped zones
// carry the advisory label verbatim.

import { Kicker } from "@/components/ui";
import { LEVEL_HEX, scoreHex, reportPermalink } from "@/lib/ui";
import type { LevelId, AiStance, AutonomyTierId } from "@/lib/types";
import { PATH_ZONE_ADVISORY_LABEL, type RepoStanceCompliance } from "@/lib/org/stance";
import type { StanceZoneView, UndeclaredTool } from "@/lib/org/stance-overview";
import { AckMark, TIER_HEX, TIER_META } from "./stanceShared";
import { AckButton } from "./AckButton";

/** The checkpoint: what the stance permits to cross into org code, and what was OBSERVED crossing
 *  anyway (PR attribution) without being declared. */
export function CheckpointStrip({ stance, undeclared }: { stance: AiStance; undeclared: UndeclaredTool[] }) {
  const cols: { key: string; title: string; hex: string; copy: string; items: { label: string; note?: string }[] }[] = [
    {
      key: "tools",
      title: "permitted tools",
      hex: "#10b981",
      copy: "Agents and assistants approved for org code.",
      items: stance.permittedTools.map((t) => ({ label: t })),
    },
    {
      key: "models",
      title: "permitted models",
      hex: "#10b981",
      copy: "Model families approved to touch org code.",
      items: stance.permittedModels.map((m) => ({ label: m })),
    },
    {
      key: "undeclared",
      title: "observed · undeclared",
      hex: undeclared.length ? "#ef4444" : "#16a34a",
      copy: "Tools seen in PR attribution that the stance never permitted — declared vs observed, not enforced.",
      items: undeclared.map((u) => ({ label: u.name, note: `${u.repos.length} repo${u.repos.length === 1 ? "" : "s"}` })),
    },
  ];
  return (
    <div className="grid gap-px overflow-hidden rounded-2xl border border-divider bg-divider lg:grid-cols-3">
      {cols.map((col) => (
        <div key={col.key} className="bg-ink p-4">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-xs uppercase tracking-[0.18em]" style={{ color: col.hex }}>
              {col.title}
            </span>
            <span className="font-mono text-lg tabular-nums" style={{ color: col.hex }}>
              {col.items.length}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">{col.copy}</p>
          <ul className="mt-3 space-y-1.5">
            {col.items.map((it) => (
              <li key={it.label} className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-sm text-slate-100">{it.label}</span>
                {it.note && <span className="font-mono text-xs tabular-nums text-slate-600">{it.note}</span>}
              </li>
            ))}
            {col.items.length === 0 && (
              <li className="text-sm text-slate-600">{col.key === "undeclared" ? "Nothing undeclared observed." : "None declared."}</li>
            )}
          </ul>
        </div>
      ))}
    </div>
  );
}

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
        These repos have no readiness passport on their latest scan, so no autonomy band can honestly be assigned —
        re-scan to place them.
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {repos.map((r) => (
          <RepoNode key={r.fullName} repo={r} org={org} version={version} canAck={canAck} />
        ))}
      </div>
    </div>
  );
}

/** The sealed interior: declared no-AI zones, and whether observed attribution contradicts them. */
export function SealedZones({ zones }: { zones: StanceZoneView[] }) {
  if (zones.length === 0) return null;
  return (
    <div className="rounded-2xl border border-danger/30 bg-surface/40 p-5">
      <Kicker>Sealed · no AI authorship declared</Kicker>
      <p className="mt-2 max-w-3xl text-base text-slate-300">
        Inside the perimeter these repos and paths are declared closed regardless of tier. The readout below compares
        the declaration with OBSERVED git attribution — it reports contradictions, it does not enforce the seal.
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
