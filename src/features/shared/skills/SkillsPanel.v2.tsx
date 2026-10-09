"use client";

// Prism library. The same useSkillsLibrary hook owns filters and archive. Which skill is open is the URL hash.
import { Frame, Masthead, SectionHead } from "@/components/kit";
import { unmirroredRegistryUsage, type SkillUsage } from "@/lib/org/skill-usage";
import type { SkillOutcome } from "@/lib/org/skill-outcomes";
import type { SkillAdoption, SkillRow } from "@/lib/db";
import { useSkillsLibrary } from "./useSkillsLibrary";
import { useSkillScene } from "./useSkillScene";
import { SkillsFilterV2 } from "./SkillsFilter.v2";
import { SkillsLifecycleV2 } from "./SkillsLifecycle.v2";
import { SkillRetireSweep } from "./SkillRetireSweep";
import { SkillsListError, SkillsTruncatedLine } from "./SkillsListNotes";
import { SkillsLibraryEmptyV2 } from "./SkillsLibraryEmpty.v2";
import { SkillsRowsV2 } from "./SkillsRows.v2";
import { SkillsUnmirroredV2 } from "./SkillsUnmirrored.v2";
import { skillFigures } from "./skillSceneModel";

export function SkillsPanelV2({
  slug,
  initial,
  categories,
  adoption,
  usage,
  outcomes,
  repoOptions,
  isAdmin,
  registryBase,
  initialTruncated = false,
}: {
  slug: string;
  initial: SkillRow[];
  categories: readonly string[];
  adoption: Record<string, SkillAdoption>;
  usage: Record<string, SkillUsage>;
  outcomes: Record<string, SkillOutcome[]>;
  repoOptions: string[];
  isAdmin: boolean;
  registryBase: string | null;
  initialTruncated?: boolean;
}) {
  const s = useSkillsLibrary({ slug, initial, initialTruncated });
  const [sceneId, setScene] = useSkillScene();
  const filtered = Boolean(s.search || s.category);
  const figures = skillFigures(s.skills, usage, repoOptions.length);

  function archive(id: string) {
    void s.archive(id);
    if (sceneId === id) setScene(null);
  }

  return (
    <>
      <Masthead
        eyebrow="Shared skills"
        statement="What the org"
        named="reuses"
        pattern="spectral"
        lede="Skills arrive from the linked registry, or from a CLI push. This page reads the library. It does not author a skill."
        figures={figures.map((f) => ({ label: f.label, value: f.value, tone: f.tone, detail: f.detail }))}
      />
      <Frame aria-label="Skills library" className="mt-2">
        {sceneId ? (
          <SkillsRowsV2
            slug={slug}
            skills={s.skills}
            sceneId={sceneId}
            onOpen={setScene}
            usage={usage}
            outcomes={outcomes}
            adoption={adoption}
            repoOptions={repoOptions}
            isAdmin={isAdmin}
            onArchive={archive}
            registryBase={registryBase}
            fleetSize={repoOptions.length}
          />
        ) : (
          <>
            <SectionHead
              eyebrow="Library"
              title="Skills in"
              named="this org"
              lede={filtered ? `Showing ${s.skills.length} of ${initial.length}` : `${s.skills.length} skills, ${repoOptions.length} repos`}
            />
            <SkillsLifecycleV2 skills={s.skills} usage={usage} fleetSize={repoOptions.length} />
            {/* The same sweep as the classic panel: one implementation, so the two themes cannot
                disagree about which skills are prune candidates. */}
            <SkillRetireSweep
              skills={s.skills}
              usage={usage}
              adoption={adoption}
              isAdmin={isAdmin}
              sweep={s.sweep}
            />
            <SkillsUnmirroredV2 rows={unmirroredRegistryUsage(usage)} />
            <SkillsFilterV2
              search={s.search}
              setSearch={s.setSearch}
              category={s.category}
              setCategory={s.setCategory}
              sort={s.sort}
              setSort={s.setSort}
              categories={categories}
            />
            {s.listError ? (
              <div className="mt-4">
                <SkillsListError message={s.listError} />
              </div>
            ) : s.skills.length === 0 ? (
              <SkillsLibraryEmptyV2 loading={s.loading} filtered={filtered} />
            ) : (
              <SkillsRowsV2
                slug={slug}
                skills={s.skills}
                sceneId={null}
                onOpen={setScene}
                usage={usage}
                outcomes={outcomes}
                adoption={adoption}
                repoOptions={repoOptions}
                isAdmin={isAdmin}
                onArchive={archive}
                registryBase={registryBase}
                fleetSize={repoOptions.length}
              />
            )}
            {s.truncated && !s.listError && <SkillsTruncatedLine count={s.skills.length} />}
          </>
        )}
      </Frame>
      {s.error && (
        <p role="alert" className="mt-3 type-body-sm text-slate-100">
          <span aria-hidden>! </span>
          {s.error}
        </p>
      )}
    </>
  );
}
