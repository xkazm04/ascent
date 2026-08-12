// One repo's autonomy clearance, rendered as a credential. Sub-component of AutonomyClearance
// (variant A) — extracted so the orchestrator stays well under the 300-LOC rule.
//
// The card reads top-to-bottom like a badge: WHO (repo + purpose), WHAT IS GRANTED (the tier stamp
// and its plain-language grant), ON WHAT AUTHORITY (the five gate conditions with their evidence),
// and WHAT WOULD RAISE IT (the countersignature line).

import Link from "next/link";
import { Surface, Kicker } from "@/components/ui";
import { Meter } from "@/components/org/shared/ui";
import { scoreHex, reportPermalink, timeAgo } from "@/lib/ui";
import { TIER_META, tierHex, type RepoAutonomy } from "./autonomyModel";
import { GateDot, SourcePin, TierRail } from "./autonomyShared";

export function ClearanceCard({ repo }: { repo: RepoAutonomy }) {
  const meta = TIER_META[repo.tier];
  const next = repo.nextTier != null ? TIER_META[repo.nextTier] : null;
  const hex = tierHex(repo.tier);

  return (
    <Surface className="flex flex-col gap-4 p-5">
      {/* Bearer */}
      <div className="flex items-start justify-between gap-3 border-b border-divider pb-3">
        <div className="min-w-0">
          <Link href={reportPermalink(repo.fullName)} className="font-mono text-base text-white hover:text-accent">
            {repo.name}
          </Link>
          <p className="mt-1 line-clamp-2 text-sm text-slate-400">{repo.purpose || "No stated purpose."}</p>
        </div>
        {/* The stamp: a ruled clearance seal, tinted on the climb ramp. */}
        <div
          className="shrink-0 rounded-lg border px-3 py-2 text-center"
          style={{ borderColor: hex, backgroundColor: `${hex}14` }}
        >
          <div className="font-mono text-2xl tabular-nums font-medium" style={{ color: hex }}>
            {meta.code}
          </div>
          <Kicker tone="muted" className="mt-0.5">
            cleared
          </Kicker>
        </div>
      </div>

      {/* Grant */}
      <div>
        <Kicker tone="muted">Granted</Kicker>
        <TierRail tier={repo.tier} className="mt-1.5" />
        <p className="mt-1.5 text-base text-slate-100">{meta.grant}</p>
        <p className="mt-1 text-sm text-slate-400">{meta.blurb}</p>
      </div>

      {/* Conditions */}
      <div>
        <Kicker tone="muted">Conditions of clearance</Kicker>
        <ul className="mt-2 space-y-1.5">
          {repo.gates.map((g) => (
            <li key={g.id} className="flex items-start gap-2 text-sm">
              <GateDot score={g.score} status={g.status} />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-xs uppercase tracking-[0.18em] text-slate-400">{g.short}</span>
                  <SourcePin source={g.source} />
                  <span className="font-mono text-xs tabular-nums" style={{ color: scoreHex(g.score) }}>
                    {g.score}
                  </span>
                </span>
                <span className="block text-slate-400">{g.evidence}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Countersignature */}
      <div className="mt-auto border-t border-divider pt-3">
        {next ? (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <Kicker tone="muted">
                To countersign {next.code} · {next.label}
              </Kicker>
              <span className="font-mono text-xs tabular-nums text-slate-400">{repo.nextProgress}%</span>
            </div>
            <Meter
              value={repo.nextProgress}
              color={tierHex(next.id)}
              className="mt-2"
              size="sm"
              ariaLabel={`${repo.name} progress toward ${next.code}`}
            />
            <p className="mt-2 text-sm text-slate-200">
              {repo.blocking[0]?.action ?? "All conditions met — raise the clearance."}
            </p>
            {repo.blocking.length > 1 && (
              <p className="mt-1 font-mono text-xs uppercase tracking-[0.18em] text-slate-500">
                + {repo.blocking.length - 1} further condition{repo.blocking.length - 1 === 1 ? "" : "s"}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm" style={{ color: hex }}>
            Top clearance held — this repo can run agents unattended.
          </p>
        )}
        <p className="mt-3 font-mono text-xs uppercase tracking-[0.18em] text-slate-600">
          issued {repo.lastScanAt ? timeAgo(repo.lastScanAt) : "—"} · confidence {Math.round(repo.confidence * 100)}%
          {repo.engine === "mock" ? " · placeholder scan" : ""}
        </p>
      </div>
    </Surface>
  );
}
