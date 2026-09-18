"use client";

// Org Skills Library (Feature 2) — the browsable catalog: a server-filtered table (search + category +
// sort) over the org's reusable skills, each row expanding to a SkillCard (copy/download/adopt). Admins
// get archive. Mirrors PlaybooksPanel; adds the scalable filter bar + the Name·Category·Status·
// Adoptions·Uses table. Filtering happens on the server (?category=&search=&sort=) so the list stays
// cheap as the catalog grows.
//
// No author form: skills arrive from the linked registry (or a CLI push), never from a dashboard
// textarea (2026-09-17). State/effects live in useSkillsLibrary.ts; the table region lives in
// SkillsLibraryTable.tsx — both extracted to keep this file under the 200-LOC cap.

import { Card, SectionHeader } from "@/components/org/shared/ui";
import { SkillsFilterBar } from "@/features/shared/skills/SkillsFilterBar";
import { SkillsLibraryTable } from "@/features/shared/skills/SkillsLibraryTable";
import { SkillsLifecycle } from "@/features/shared/skills/SkillsLifecycle";
import { useSkillsLibrary } from "@/features/shared/skills/useSkillsLibrary";
import { unmirroredRegistryUsage, type SkillUsage } from "@/lib/org/skill-usage";
import type { SkillOutcome } from "@/lib/org/skill-outcomes";
import type { SkillAdoption, SkillRow } from "@/lib/db";

export function SkillsPanel({
  slug,
  initial,
  categories,
  adoption,
  usage,
  outcomes,
  repoOptions,
  isAdmin,
  registryBase,
}: {
  slug: string;
  initial: SkillRow[];
  categories: readonly string[];
  adoption: Record<string, SkillAdoption>;
  /** Server-computed dormancy verdict per skill id (src/lib/org/skill-usage.ts). */
  usage: Record<string, SkillUsage>;
  /** Server-computed adoption→outcome deltas per skill id (src/lib/org/skill-outcomes.ts). */
  outcomes: Record<string, SkillOutcome[]>;
  repoOptions: string[];
  isAdmin: boolean;
  /** `https://github.com/<owner>/<repo>/blob/<branch>` when a registry is mapped, else null. Non-null
   *  is what turns the per-row origin markers on: with nothing mapped, "hosted" is not news. */
  registryBase: string | null;
}) {
  const s = useSkillsLibrary({ slug, initial });
  // Sink B samples whose name is not an OrgSkill: kept (not dropped) so a fleet running unmirrored
  // skills is still visible here. Ranked by invoke volume; they never appear as library rows.
  const unmirrored = unmirroredRegistryUsage(usage);

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="Skills Library"
        // Scope, not meaning. The definition is the graphic below it, the value claim moved to the
        // empty state, and the two CTA instructions live on the CTAs (see SkillCard).
        description={`${s.skills.length} skills · ${repoOptions.length} repos`}
      />

      {/* First sight below the header is a shape, not a filter bar. */}
      <SkillsLifecycle skills={s.skills} usage={usage} fleetSize={repoOptions.length} />

      {unmirrored.length > 0 && (
        <div
          data-unmirrored-registry-usage
          className="mt-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4"
        >
          <p
            className="type-label tracking-[0.16em] text-slate-500"
            title="Sink B samples whose skill name is not an OrgSkill in this org. The registry ran them; dropping the counts would hide that. They do not vote on whether this library's own skills are unmeasured."
          >
            Registry usage not in this library
          </p>
          <ul className="mt-1 space-y-0.5">
            {unmirrored.map((row) => (
              <li key={row.name} data-skill={row.name} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate type-mono-sm text-slate-400" title={row.name}>
                  {row.name}
                </span>
                <span data-count className="type-mono-sm tabular-nums text-slate-200">
                  {row.invokes.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <SkillsFilterBar
        search={s.search}
        setSearch={s.setSearch}
        category={s.category}
        setCategory={s.setCategory}
        sort={s.sort}
        setSort={s.setSort}
        categories={categories}
      />

      {/* data-tour: the onboarding companion's "make the fix repeatable" spotlight. */}
      <div data-tour="skills-registry" className="mt-4">
        <SkillsLibraryTable
          slug={slug}
          skills={s.skills}
          loading={s.loading}
          filtered={Boolean(s.search || s.category)}
          expanded={s.expanded}
          setExpanded={s.setExpanded}
          adoption={adoption}
          usage={usage}
          outcomes={outcomes}
          repoOptions={repoOptions}
          isAdmin={isAdmin}
          archive={s.archive}
          registryBase={registryBase}
        />
      </div>

      {s.error && <p className="mt-2 type-body-sm text-orange-300">{s.error}</p>}
    </Card>
  );
}
