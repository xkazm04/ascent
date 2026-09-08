"use client";

// The Skills tab's first sight: a skill's life drawn, not described.
//
// Two figures over the same ranked set of skills. LEFT — reuse across the fleet: adopted (a share of
// repos, the one genuine 0..100 here, so the one column that prints a number), copied, run. RIGHT —
// use over time: the interval a skill was reached for, and then the silence, where a void ("nothing
// was recorded here") and a hatch ("nothing has ever been measured in this org") are different
// pictures rather than the same amber word.
//
// Every encoding comes from @/components/org/viz. Nothing here re-defines a hatch, a dash or a label.

import { Kicker } from "@/components/ui";
import { Legend, MatrixGrid, StateTrack, WhyChip, type VizState } from "@/components/org/viz";
import { REUSE_AXES, reuseRows } from "@/features/shared/skills/skillLifecycleViz";
import { dormancyLanes } from "@/features/shared/skills/skillDormancyTrack";
import type { SkillUsage } from "@/lib/org/skill-usage";
import type { SkillRow } from "@/lib/db";

/** The demoted A2 caveat behind the Ran column and the quiet end of every lane. */
export const RAN_HINT =
  "A skill runs through the Skill hook, the MCP tool path or a CI job. Where this org has never emitted a skill event of any kind, the column is hatched: nothing is known about whether it ran, which is not the same as knowing it never did.";
export const ADOPTED_HINT =
  "Adopted is the share of this org's repositories that recorded taking the skill on. With no repositories in the fleet there is no denominator, so the cell is hatched rather than showing a share of nothing.";

function Figure({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <figure className="min-w-0">
      <figcaption className="mb-1.5 flex items-center gap-1.5">
        <Kicker tone="muted" as="span">
          {label}
        </Kicker>
        <WhyChip hint={hint} label={label} />
      </figcaption>
      {children}
    </figure>
  );
}

export function SkillsLifecycle({
  skills,
  usage,
  fleetSize,
}: {
  skills: SkillRow[];
  /** Server-computed usage per skill id. Empty for a library nothing has reported against. */
  usage: Record<string, SkillUsage>;
  /** Repositories in the org — the denominator the Adopted share is taken against. */
  fleetSize: number;
}) {
  // Nothing to draw is the table's empty state's job, not a chart of zero rows.
  if (skills.length === 0) return null;

  const rows = reuseRows(skills, usage, fleetSize);
  // No clock call in render: the window's right edge is recovered from the usage rows themselves
  // (see `observedAt`), so the server's picture and the hydrated one are the same picture.
  const track = dormancyLanes(skills, usage);

  const present = new Set<VizState>();
  for (const r of rows) for (const c of r.cells) present.add(c.state);
  for (const r of track.rows) for (const s of r.segments) present.add(s.state);

  const hidden = skills.length - rows.length;

  return (
    <section className="mt-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
      <div className="grid gap-5 sm:grid-cols-2">
        <Figure label="Reuse across the fleet" hint={ADOPTED_HINT}>
          <MatrixGrid axes={[...REUSE_AXES]} rows={rows} title="Reuse per skill" />
        </Figure>
        {track.rows.length > 0 ? (
          <Figure label="Use over time" hint={RAN_HINT}>
            <StateTrack
              rows={track.rows}
              start={track.start}
              end={track.end}
              ticks={track.ticks}
              title="Skill use over time"
            />
          </Figure>
        ) : (
          // Not an empty chart: no usage row exists for any listed skill, which is a fact about the
          // read, not about the skills. Said once, where the picture would have been.
          <Figure label="Use over time" hint={RAN_HINT}>
            <p className="type-body-sm text-slate-500">
              No usage has been computed for these skills yet — install the invoke hook
              (<code className="type-mono-sm">ascent-skills hooks install</code>) or copy a skill to
              start the record.
            </p>
          </Figure>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-2.5">
        <Legend states={[...present]} />
        {hidden > 0 && (
          <span className="type-caption text-slate-600">
            top {rows.length} of {skills.length} by reach
          </span>
        )}
      </div>
    </section>
  );
}
