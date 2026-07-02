"use client";

// Expanded-row detail for one team in the TeamsMatrix — the drill-down behind the row's aggregates:
// ownership/posture meta, movement, dimension shape, the owned repos linked to their reports, and
// (population permitting — CHAMPION_MIN_POP) the team's AI champions. Flat layout on purpose: it
// lives inside a table row, not another card.

import Link from "next/link";
import type { TeamRollup } from "@/lib/db";
import { deltaHex, fmtDelta, postureLabel } from "@/components/org/ui";
import { CHAMPION_MIN_POP } from "@/components/org/champions";
import { scoreHex } from "@/lib/ui";

/** Cap the owned-repos pill list so a broad CODEOWNERS owner can't render hundreds of pills. */
const OWNED_REPO_CAP = 12;

export function TeamsMatrixDetail({ team }: { team: TeamRollup }) {
  return (
    // sticky left + capped width keep the detail inside the visible scrollport — the row's cell spans
    // the full (horizontally scrollable) table width, which can be wider than the viewport.
    <div className="sticky left-4 max-w-3xl space-y-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-sm text-slate-500">
        <span className="text-slate-400">{postureLabel(team.posture)}</span>
        <span>
          {team.repoCount} scanned / {team.totalOwned} owned
          {team.defaultOwnerCount > 0 && ` · primary owner of ${team.defaultOwnerCount}`}
        </span>
        <span>
          {team.contributors} contributor{team.contributors === 1 ? "" : "s"} ({team.aiContributors} AI-active)
        </span>
        {team.comparedRepos > 0 && (
          <span>
            <span style={{ color: deltaHex(team.avgDelta) }}>{fmtDelta(team.avgDelta)}</span> avg since last scan · ▲
            {team.improving} ▼{team.declining} of {team.comparedRepos} rescanned
          </span>
        )}
        {team.strongest && (
          <span>
            strongest {team.strongest.label}{" "}
            <span style={{ color: scoreHex(team.strongest.avg) }}>{team.strongest.avg}</span>
          </span>
        )}
        {team.weakest && team.weakest.dimId !== team.strongest?.dimId && (
          <span>
            could grow {team.weakest.label}{" "}
            <span style={{ color: scoreHex(team.weakest.avg) }}>{team.weakest.avg}</span>
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-sm uppercase tracking-widest text-slate-600">Repos</span>
        {team.repos.slice(0, OWNED_REPO_CAP).map((r) => (
          <Link
            key={r.fullName}
            href={`/report/${r.fullName}`}
            className="focus-ring rounded border border-slate-700 px-1.5 py-0.5 font-mono text-sm text-slate-400 transition hover:border-accent hover:text-white"
            title={`${r.fullName} · overall ${r.overall}${r.isDefaultOwner ? " · primary owner" : ""} — open report`}
          >
            {r.isDefaultOwner && <span className="mr-1 text-slate-600">★</span>}
            {r.name}
            <span className="ml-1" style={{ color: scoreHex(r.overall) }}>{r.overall}</span>
          </Link>
        ))}
        {team.repos.length > OWNED_REPO_CAP && (
          <span className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-sm text-slate-500">
            +{team.repos.length - OWNED_REPO_CAP} more
          </span>
        )}
      </div>

      {team.contributors >= CHAMPION_MIN_POP && team.champions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-sm uppercase tracking-widest text-slate-600">AI champions</span>
          {team.champions.map((c) => (
            <span
              key={c.login}
              className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-sm text-accent"
              title={`${c.aiCommits} AI commits · ${c.aiShare}% of their commits AI-attributed`}
            >
              {c.login} · {c.aiShare}%
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
