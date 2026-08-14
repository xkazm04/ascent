"use client";

// Org Skills Library (Feature 2) — the browsable catalog: a server-filtered table (search + category +
// sort) over the org's reusable skills, each row expanding to a SkillCard (copy/download/adopt). Authors
// (members on a Team+ plan) get the create form; admins get archive. Mirrors PlaybooksPanel; adds the
// scalable filter bar + the Name·Category·Adoptions·Downloads table. Filtering happens on the server
// (?category=&search=&sort=) so the list stays cheap as the catalog grows.
//
// State/effects live in useSkillsLibrary.ts; the table region lives in SkillsLibraryTable.tsx — both
// extracted to keep this file under the 200-LOC .tsx cap (docs/ORG-TABS-REFACTOR.md §3).

import { Card, SectionHeader } from "@/components/org/shared/ui";
import { SkillsFilterBar } from "@/components/org/library/skills/SkillsFilterBar";
import { SkillsAuthorForm } from "@/components/org/library/skills/SkillsAuthorForm";
import { SkillsLibraryTable } from "@/components/org/library/skills/SkillsLibraryTable";
import { useSkillsLibrary } from "@/components/org/library/skills/useSkillsLibrary";
import type { SkillUsage } from "@/lib/org/skill-usage";
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
  canAuthor,
  isAdmin,
  planAllowed,
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
  canAuthor: boolean;
  isAdmin: boolean;
  planAllowed: boolean;
}) {
  const s = useSkillsLibrary({ slug, initial });

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="Skills Library"
        description="Your org's reusable Claude/LLM skills: author once, the whole team discovers and reuses them. Copy a skill into Claude Code, or download it as a SKILL.md."
      />

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
        />
      </div>

      <SkillsAuthorForm
        canAuthor={canAuthor}
        planAllowed={planAllowed}
        categories={categories}
        name={s.name}
        setName={s.setName}
        formCategory={s.formCategory}
        setFormCategory={s.setFormCategory}
        description={s.description}
        setDescription={s.setDescription}
        content={s.content}
        setContent={s.setContent}
        tagsText={s.tagsText}
        setTagsText={s.setTagsText}
        busy={s.busy}
        create={s.create}
        applyTemplate={s.applyTemplate}
      />
      {s.error && <p className="mt-2 text-sm text-orange-300">{s.error}</p>}
    </Card>
  );
}
