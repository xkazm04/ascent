"use client";

// One team's main row + its expandable detail row — extracted from TeamsMatrix so the matrix's own
// JSX stays under the 200-LOC cap (AGENTS.md).

import type { TeamRollup } from "@/lib/db";
import { TeamsMatrixDetail } from "./TeamsMatrixDetail";
import { teamAnchorId } from "./teamsShared";

export function TeamsMatrixRow({
  team,
  open,
  onToggle,
  leader,
  colCount,
  deltaLabel,
  children,
}: {
  team: TeamRollup;
  open: boolean;
  onToggle: (slug: string) => void;
  leader: boolean;
  colCount: number;
  deltaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <tr id={teamAnchorId(team.slug)} className="scroll-mt-24 text-slate-300">
        <td className="px-4 py-2">
          <button
            type="button"
            onClick={() => onToggle(team.slug)}
            aria-expanded={open}
            className="focus-ring flex items-center gap-2 rounded text-left font-mono text-sm text-white transition hover:text-accent"
          >
            <span aria-hidden className={`text-slate-500 transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
            {team.slug}
            {leader && <span title="Most institutional AI knowledge">🧠</span>}
          </button>
        </td>
        <td
          className="px-2 py-2 text-right font-mono tabular-nums text-slate-400"
          title={`${team.repoCount} scanned of ${team.totalOwned} owned · primary owner of ${team.defaultOwnerCount}`}
        >
          {team.repoCount}
          {team.totalOwned > team.repoCount && <span className="text-slate-600">/{team.totalOwned}</span>}
        </td>
        {children}
      </tr>
      {open && (
        <tr>
          <td colSpan={colCount} className="px-4 pb-4 pt-1">
            <TeamsMatrixDetail team={team} deltaLabel={deltaLabel} />
          </td>
        </tr>
      )}
    </>
  );
}
