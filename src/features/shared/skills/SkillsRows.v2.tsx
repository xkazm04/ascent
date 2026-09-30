"use client";

// Press a row to open that skill as a level. Previous and next walk the filtered list.
import { Caption, CellMark, HairlineList, ListRow } from "@/components/kit";
import type { SkillAdoption, SkillRow } from "@/lib/db";
import type { SkillOutcome } from "@/lib/org/skill-outcomes";
import type { SkillUsage } from "@/lib/org/skill-usage";
import { SkillSceneV2 } from "./SkillScene.v2";
import { dormancyMark, shortName, skillRowDetail, USES_CAPTION } from "./skillSceneModel";

export function SkillsRowsV2({
  slug,
  skills,
  sceneId,
  onOpen,
  usage,
  outcomes,
  adoption,
  repoOptions,
  isAdmin,
  onArchive,
  registryBase,
  fleetSize,
}: {
  slug: string;
  skills: SkillRow[];
  sceneId: string | null;
  onOpen: (id: string | null) => void;
  usage: Record<string, SkillUsage>;
  outcomes: Record<string, SkillOutcome[]>;
  adoption: Record<string, SkillAdoption>;
  repoOptions: string[];
  isAdmin: boolean;
  onArchive: (id: string) => void;
  registryBase: string | null;
  fleetSize: number;
}) {
  if (sceneId) {
    const idx = skills.findIndex((s) => s.id === sceneId);
    const skill = idx >= 0 ? skills[idx]! : null;
    const prev = idx > 0 ? skills[idx - 1] : undefined;
    const next = idx >= 0 && idx < skills.length - 1 ? skills[idx + 1] : undefined;
    return (
      <SkillSceneV2
        slug={slug}
        skill={skill}
        onBack={() => onOpen(null)}
        onPrev={prev ? () => onOpen(prev.id) : undefined}
        onNext={next ? () => onOpen(next.id) : undefined}
        prevLabel={prev ? shortName(prev.name) : undefined}
        nextLabel={next ? shortName(next.name) : undefined}
        usage={skill ? usage[skill.id] : undefined}
        outcomes={skill ? outcomes[skill.id] : undefined}
        adoption={skill ? adoption[skill.id] : undefined}
        repoOptions={repoOptions}
        isAdmin={isAdmin}
        onArchive={() => skill && onArchive(skill.id)}
        registryBase={registryBase}
        fleetSize={fleetSize}
      />
    );
  }

  return (
    <div data-tour="skills-registry" className="mt-5">
      <div data-uses-window="all-time" data-uses-sinks="A B">
        <Caption>{USES_CAPTION}</Caption>
      </div>
      <HairlineList className="mt-3" aria-label="Skills">
        {skills.map((s) => {
          const mark = dormancyMark(usage[s.id]);
          return (
            <ListRow
              key={s.id}
              onPress={() => onOpen(s.id)}
              title={s.name}
              detail={
                <>
                  {skillRowDetail(s, usage[s.id], fleetSize)}{" "}
                  <CellMark state={mark.state}>{mark.word}</CellMark>
                </>
              }
            />
          );
        })}
      </HairlineList>
    </div>
  );
}
