"use client";

// The open skill replaces the list: back, previous, next, Esc.
import { EscBack, LevelNav } from "@/components/kit";
import type { SkillAdoption, SkillRow } from "@/lib/db";
import type { SkillOutcome } from "@/lib/org/skill-outcomes";
import type { SkillUsage } from "@/lib/org/skill-usage";
import { SkillSceneBodyV2 } from "./SkillSceneBody.v2";
import { shortName } from "./skillSceneModel";

export function SkillSceneV2({
  slug,
  skill,
  onBack,
  onPrev,
  onNext,
  prevLabel,
  nextLabel,
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
  skill: SkillRow | null;
  onBack: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  prevLabel?: string;
  nextLabel?: string;
  usage: SkillUsage | undefined;
  outcomes: SkillOutcome[] | undefined;
  adoption: SkillAdoption | undefined;
  repoOptions: string[];
  isAdmin: boolean;
  onArchive: () => void;
  registryBase: string | null;
  fleetSize: number;
}) {
  return (
    <div data-role="skill-scene">
      <EscBack onBack={onBack} />
      <LevelNav
        trail={[{ label: "Skills" }, { label: skill ? shortName(skill.name, 48) : "Not in this list" }]}
        back={{ label: "All skills", onClick: onBack }}
        prev={onPrev && prevLabel ? { label: prevLabel, onClick: onPrev } : undefined}
        next={onNext && nextLabel ? { label: nextLabel, onClick: onNext } : undefined}
      />
      {!skill ? (
        <p className="mt-4 type-body text-slate-400">This skill is not in the current list. It may be filtered out or archived.</p>
      ) : (
        <SkillSceneBodyV2
          slug={slug}
          skill={skill}
          usage={usage}
          outcomes={outcomes}
          adoption={adoption}
          repoOptions={repoOptions}
          canArchive={isAdmin}
          onArchive={onArchive}
          registryBase={registryBase}
          fleetSize={fleetSize}
        />
      )}
    </div>
  );
}
