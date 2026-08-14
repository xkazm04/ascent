"use client";

// One leaderboard row — extracted out of RepoLeaderboard.tsx so that file stays under the 200-LOC cap
// (AGENTS.md).

import Link from "next/link";
import { ScheduleSelect } from "./ScheduleSelect";
import { RepoRescanButton } from "./RepoRescanButton";
import { TechBadges } from "./TechBadges";
import { Sparkline } from "./Sparkline";
import { sum } from "./RepoLeaderboardParts";
import { LEVEL_CLASSES, fmtCompact, scoreHex } from "@/lib/ui";
import type { LevelId } from "@/lib/types";
import type { LeaderRow } from "./useRepoLeaderboard";

export function RepoLeaderboardRow({
  r,
  slug,
  schedulable,
  hasSegments,
  selected,
  onToggle,
}: {
  r: LeaderRow;
  slug: string;
  schedulable: boolean;
  hasSegments: boolean;
  selected: boolean;
  onToggle: (fullName: string) => void;
}) {
  const l = r.latest;
  const a = r.activity;
  const rlc = l ? LEVEL_CLASSES[l.level as LevelId] : null;
  return (
    <tr className="text-slate-300">
      <td className="px-3 py-2">
        {hasSegments && (
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggle(r.fullName)}
            aria-label={`Select ${r.fullName}`}
            className="accent-accent"
          />
        )}
      </td>
      <td className="px-4 py-2">
        {/* Title links to the repo's STORED report (server-rendered permalink, no re-scan) —
            not /report?repo= which kicks off the live scan flow. Only linked once there's a
            persisted scan to show; a never-scanned repo renders inert (its permalink would be a
            cold-scan confirm gate, not a report) and is reached via the row's ↻ Rescan button. */}
        {l ? (
          <Link
            href={`/report/${r.fullName}`}
            title={`View ${r.fullName}'s latest report`}
            className="font-mono text-sm text-white hover:text-accent"
          >
            {r.fullName}
          </Link>
        ) : (
          <span title={`${r.fullName} (not scanned yet)`} className="font-mono text-sm text-slate-400">
            {r.fullName}
          </span>
        )}
        {r.lastScanStatus === "error" && (
          <span
            title={r.lastScanError ?? "The most recent scan attempt failed."}
            className="ml-2 rounded border border-danger/40 bg-danger/10 px-1.5 py-0.5 font-mono text-sm text-danger-soft"
          >
            ⚠ scan failed
          </span>
        )}
        {r.aiConformance != null && (
          <span
            title="`.ai/` standard conformance reported by this repo's doctor (node .ai/doctor.mjs --json)"
            className="ml-2 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-sm"
            style={{ color: scoreHex(r.aiConformance) }}
          >
            .ai {r.aiConformance}%
          </span>
        )}
        <TechBadges stack={r.techStack} />
      </td>
      <td className="px-3 py-2">
        {l && rlc ? <span className={`font-mono text-sm ${rlc.text}`}>{l.level}</span> : <span className="text-slate-600">—</span>}
      </td>
      {/* Commits — trailing weekly sparkline + total over the ~1-month window (real, from GitHub
          commit_activity). The number is the period total, matching the column's sort key. */}
      <td className="px-3 py-2">
        {a && a.commitsWeekly.length > 0 ? (
          <span className="flex items-center gap-2">
            <Sparkline values={a.commitsWeekly} ariaLabel={`${r.name} weekly commits, past ${a.commitsWeekly.length} weeks`} />
            <span
              className="font-mono text-sm tabular-nums text-slate-400"
              title={`${sum(a.commitsWeekly).toLocaleString()} commits over the past ${a.commitsWeekly.length} weeks (from GitHub)`}
            >
              {sum(a.commitsWeekly).toLocaleString()}
            </span>
          </span>
        ) : (
          <span className="text-slate-600">—</span>
        )}
      </td>
      {/* PRs — merged across the analyzed window (repo-wide total in the tooltip). */}
      <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400">
        {a ? <span title={`${a.prsTotal.toLocaleString()} total PRs`}>{a.prsMerged.toLocaleString()}</span> : "—"}
      </td>
      {/* LoC Δ — lines changed (additions + deletions) across the analyzed PR window. */}
      <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400">
        {a && a.locChanged > 0 ? <span title={`${a.locChanged.toLocaleString()} lines changed`}>{fmtCompact(a.locChanged)}</span> : "—"}
      </td>
      <td className="px-3 py-2 text-sm text-slate-500">{l ? l.scannedAt.slice(0, 10) : "not scanned"}</td>
      <td className="px-3 py-2">
        <ScheduleSelect
          org={slug}
          fullName={r.fullName}
          schedule={r.scanSchedule}
          disabled={!schedulable}
          disabledHint="Autoscan scheduling requires the GitHub App."
        />
      </td>
      <td className="px-3 py-2">
        {r.watched ? (
          <RepoRescanButton org={slug} fullName={r.fullName} disabled={!schedulable} disabledHint="Rescanning requires the GitHub App." />
        ) : (
          <span className="text-slate-600">—</span>
        )}
      </td>
    </tr>
  );
}
