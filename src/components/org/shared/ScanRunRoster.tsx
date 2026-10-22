"use client";

// The end of a fleet scan as a roster: every failed or skipped repo NAMED, grouped by the fix it
// needs, each group carrying that fix's one action (retry the failures / add credits / reconnect the
// App on Integrations / nothing - wait). Props-only and hook-free; "use client" for the retry click. It renders inside the client
// OrgScanButton, which owns the roster (useOrgScanButton) and passes `onRetry`.

import Link from "next/link";
import { rosterGroups, type RosterAction, type RosterGroup, type ScanRunRoster as Roster } from "./scanRunRosterModel";

/** Named rows shown per group before the rest collapse into a count. */
const SHOWN = 6;

function GroupAction({ action, onRetry, busy }: { action: RosterAction; onRetry: () => void; busy: boolean }) {
  if (action.kind === "retry") {
    return (
      <button
        type="button"
        onClick={() => {
          if (!busy) onRetry();
        }}
        aria-disabled={busy || undefined}
        className={`focus-ring rounded-md border border-slate-700 px-2 py-1 type-mono-sm text-slate-200 transition ${
          busy ? "cursor-not-allowed opacity-50" : "hover:border-accent hover:text-white"
        }`}
      >
        {action.label}
      </button>
    );
  }
  const label = action.kind === "credits" ? "See credit packs" : "Reconnect on Integrations";
  return (
    <Link href={action.href} className="focus-ring type-mono-sm text-accent transition hover:text-white">
      {label} →
    </Link>
  );
}

function Group({ group, onRetry, busy }: { group: RosterGroup; onRetry: () => void; busy: boolean }) {
  const shown = group.entries.slice(0, SHOWN);
  const rest = group.count - shown.length;
  return (
    <li className="flex flex-col items-end gap-1">
      <p className={`type-body-sm ${group.key === "failed" ? "text-warn" : "text-slate-300"}`}>{group.title}</p>
      {shown.length > 0 && (
        <ul className="flex flex-col items-end gap-0.5">
          {shown.map((e) => (
            <li key={e.repo} className="flex max-w-80 items-baseline gap-2 type-mono-sm">
              <span className="text-slate-200">{e.repo}</span>
              {e.note && <span className="truncate text-slate-500" title={e.note}>{e.note}</span>}
            </li>
          ))}
        </ul>
      )}
      {/* Up-front credit skips arrive as a count with no names: the title already says how many. */}
      {rest > 0 && shown.length > 0 && <p className="type-mono-sm text-slate-500">and {rest} more</p>}
      {group.action && <GroupAction action={group.action} onRetry={onRetry} busy={busy} />}
    </li>
  );
}

export function ScanRunRoster({ org, roster, onRetry, busy = false }: { org: string; roster: Roster; onRetry: () => void; busy?: boolean }) {
  const groups = rosterGroups(roster, org);
  if (groups.length === 0) return null;
  return (
    <ul aria-label="Scan run outcome" className="flex flex-col items-end gap-2">
      {groups.map((g) => (
        <Group key={g.key} group={g} onRetry={onRetry} busy={busy} />
      ))}
    </ul>
  );
}
