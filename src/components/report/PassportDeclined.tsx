"use client";

// "Declined by choice" strip for the App Readiness Passport hero (0.2.0). These are gaps the repo owner
// has SEEN and deliberately opted out of — they must never read as an unaddressed finding, so they render
// in their own muted, struck-through row with the owner's reason, separate from the live blockers. The
// scores are untouched by a decline: choosing to skip a gap is a decision, not a fix.

import type { AppPassport, ArtifactGrade } from "@/lib/types";
import { GRADE_LABEL } from "@/lib/org/passport-display";
import { Kicker } from "@/components/ui";

export function PassportDeclined({ declined }: { declined: AppPassport["declined"] }) {
  if (!declined?.length) return null;
  return (
    <div className="mt-5" data-testid="passport-declined">
      <Kicker tone="muted" className="mb-1.5">
        Declined by choice
      </Kicker>
      <ul className="flex flex-col gap-1">
        {declined.map((d) => (
          <li key={d.path} className="flex flex-wrap items-baseline gap-x-2 font-mono text-xs text-slate-500">
            <span className="rounded border border-divider bg-surface/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-400">
              declined
            </span>
            <span className="text-slate-300">{d.label}</span>
            {d.reason ? <span className="text-slate-500">— {d.reason}</span> : null}
            {d.blocker ? <span className="text-slate-600 line-through">{d.blocker}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The two graded agent-artifact ladders (0.2.0) as a compact readout, with a migration caveat when the
 *  grade was lifted from a 0.1.0 boolean rather than assessed. */
export function PassportArtifactGrades({ pp }: { pp: AppPassport }) {
  // Passports arrive as stored JSON, and not every blob carries the graded ladders: a row written
  // before 0.2.0 that reached this component without upgradePassport, or a server-supplied permalink
  // payload trimmed to the fields its page needed. Read defensively and render nothing — a missing
  // artifact set must not take the whole report down with it.
  const a = pp.automationReadiness?.artifacts;
  const rows = ([
    ["Memory", a?.memory],
    ["Skills", a?.skills],
  ] as [string, ArtifactGrade | undefined][]).filter((r): r is [string, ArtifactGrade] => Boolean(r[1]));
  if (!rows.length) return null;
  return (
    <div className="mt-5">
      <Kicker tone="muted" className="mb-1.5">
        Agent artifacts
      </Kicker>
      <div className="flex flex-wrap items-center gap-1.5">
        {rows.map(([label, grade]) => (
          <span key={label} className="rounded border border-divider bg-surface/60 px-2 py-0.5 font-mono text-xs text-slate-400">
            {label}: <span className="text-slate-300">{GRADE_LABEL[grade] ?? grade}</span>
          </span>
        ))}
        {pp.migratedFrom ? (
          <span
            className="cursor-help rounded border border-divider px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-slate-600"
            title={`Grades lifted from passport ${pp.migratedFrom} (a stored boolean only proves presence). Re-scan to assess them.`}
          >
            migrated from {pp.migratedFrom}
          </span>
        ) : null}
      </div>
    </div>
  );
}
