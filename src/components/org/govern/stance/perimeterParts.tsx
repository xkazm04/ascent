// Variant B (Perimeter) — the checkpoint, the tier bands, and the sealed zones.
// Co-located sub-components so StancePerimeter.tsx stays the orchestrator and under 300 LOC.
// Server-safe (no hooks/handlers).

import { Kicker } from "@/components/ui";
import { LEVEL_HEX, scoreHex, reportPermalink } from "@/lib/ui";
import type { LevelId } from "@/lib/types";
import { TIER_HEX, TOOL_STATUS_HEX, type AiStanceDoc, type RepoStanceCompliance, type StanceTool } from "./stanceMock";
import { AckMark } from "./stanceShared";

const STATUS_ORDER = ["permitted", "conditional", "forbidden"] as const;
const STATUS_COPY: Record<(typeof STATUS_ORDER)[number], string> = {
  permitted: "Crosses freely",
  conditional: "Crosses with conditions",
  forbidden: "Turned away at the line",
};

/** The checkpoint: what is allowed to cross into the fleet at all, before any tier applies. */
export function CheckpointStrip({ tools }: { tools: StanceTool[] }) {
  return (
    <div className="grid gap-px overflow-hidden rounded-2xl border border-divider bg-divider lg:grid-cols-3">
      {STATUS_ORDER.map((status) => {
        const group = tools.filter((t) => t.status === status);
        const hex = TOOL_STATUS_HEX[status];
        return (
          <div key={status} className="bg-ink p-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-xs uppercase tracking-[0.18em]" style={{ color: hex }}>
                {status}
              </span>
              <span className="font-mono text-lg tabular-nums" style={{ color: hex }}>
                {group.length}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-500">{STATUS_COPY[status]}</p>
            <ul className="mt-3 space-y-2">
              {group.map((t) => (
                <li key={t.id}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-sm text-slate-100">{t.name}</span>
                    <span className="font-mono text-xs tabular-nums text-slate-600">{t.reposUsing} repos</span>
                  </div>
                  <p className="text-sm text-slate-500">{t.note}</p>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** A repo as a node inside a band — carries the facts needed to judge whether it belongs there. */
export function RepoNode({ repo, org }: { repo: RepoStanceCompliance; org: string }) {
  const levelHex = LEVEL_HEX[repo.level as LevelId] ?? "#64748b";
  return (
    <a
      href={reportPermalink(repo.fullName, null, org)}
      className="focus-ring block rounded-lg border border-divider bg-ink/80 px-3 py-2 transition hover:border-accent/60"
      title={repo.fullName}
    >
      <div className="flex items-center gap-2">
        <span className="truncate font-mono text-sm text-slate-100">{repo.name}</span>
        <span className="ml-auto font-mono text-xs tabular-nums" style={{ color: levelHex }}>
          {repo.level}
        </span>
        <span className="font-mono text-xs tabular-nums" style={{ color: scoreHex(repo.overall) }}>
          {repo.overall}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <AckMark ack={repo.ack} showLabel={false} />
        <span className="font-mono text-xs tabular-nums text-slate-500">prov {repo.provenance}%</span>
        {repo.violations > 0 && (
          <span className="ml-auto font-mono text-xs tabular-nums text-danger">{repo.violations} breach</span>
        )}
      </div>
    </a>
  );
}

/**
 * One tier band. The bands stack from open (outermost, T0) to restricted (innermost, T3) and are
 * inset progressively so the page reads as depth into the perimeter, not as four equal cards.
 */
export function PerimeterBand({ doc, tierIndex }: { doc: AiStanceDoc; tierIndex: number }) {
  const tier = doc.tiers[tierIndex];
  if (!tier) return null;
  const hex = TIER_HEX[tier.id];
  const repos = doc.repos.filter((r) => r.tier === tier.id);
  const breaches = repos.reduce((a, r) => a + r.violations, 0);
  return (
    <div style={{ marginLeft: `${tierIndex * 1.25}rem` }}>
      <div className="relative overflow-hidden rounded-2xl border border-divider bg-surface/40">
        <div aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: hex }} />
        <div aria-hidden className="strata absolute inset-0 opacity-[0.35]" />
        <div className="relative p-5 pl-6">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-mono text-2xl tabular-nums" style={{ color: hex }}>
              {tier.id}
            </span>
            <span className="text-lg font-medium text-white">{tier.name}</span>
            <span className="text-sm text-slate-400">{tier.blurb}</span>
            <span className="ml-auto font-mono text-xs uppercase tracking-[0.18em] text-slate-500">
              {repos.length} repos{breaches ? ` · ${breaches} breaches` : ""}
            </span>
          </div>
          <p className="mt-2 max-w-3xl text-base text-slate-200">{tier.review}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {tier.examples.map((e) => (
              <code key={e} className="rounded-full border border-divider px-2 py-0.5 font-mono text-xs text-slate-500">
                {e}
              </code>
            ))}
          </div>
          {repos.length > 0 ? (
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {repos.map((r) => (
                <RepoNode key={r.fullName} repo={r} org={doc.org} />
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

/** The sealed interior: paths no agent may author, and whether the seal has held. */
export function SealedZones({ doc }: { doc: AiStanceDoc }) {
  return (
    <div className="rounded-2xl border border-danger/30 bg-surface/40 p-5">
      <Kicker>Sealed · no AI authorship</Kicker>
      <p className="mt-2 max-w-3xl text-base text-slate-300">
        Inside the perimeter these paths are closed regardless of tier. An agent may read them and open a
        proposal; a commit authored inside one is a stance breach and is reported here.
      </p>
      <ul className="mt-4 grid gap-px overflow-hidden rounded-xl border border-divider bg-divider sm:grid-cols-2">
        {doc.zones.map((z) => (
          <li key={z.id} className="bg-ink p-4">
            <code className="font-mono text-sm text-slate-100">{z.pattern}</code>
            <p className="mt-1.5 text-sm text-slate-400">{z.reason}</p>
            <p className="mt-2 font-mono text-xs uppercase tracking-[0.18em]" style={{ color: z.violations ? "#ef4444" : "#10b981" }}>
              {z.repos.length} repos bound · {z.violations ? `${z.violations} breaches` : "seal holding"}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
