// Fleet lifecycle as a ladder: glyph, word and lightness. Unknown is "not measured", not a zero share.
// Each caveat explains an unmeasured step. A counted step already states its own number.
import { Caption, Ladder } from "@/components/kit";
import type { SkillRow } from "@/lib/db";
import type { SkillUsage } from "@/lib/org/skill-usage";
import { ADOPTED_CAPTION, fleetLadder, RAN_CAPTION } from "./skillSceneModel";

export function SkillsLifecycleV2({
  skills,
  usage,
  fleetSize,
}: {
  skills: SkillRow[];
  usage: Record<string, SkillUsage>;
  fleetSize: number;
}) {
  if (skills.length === 0) return null;
  const steps = fleetLadder(skills, usage, fleetSize);
  const adoptedUnmeasured = steps.find((s) => s.key === "adopted")?.state === "unmeasured";
  const ranUnmeasured = steps.find((s) => s.key === "ran")?.state === "unmeasured";
  return (
    <div className="mt-6">
      <Ladder label="Skill lifecycle" steps={steps} />
      {adoptedUnmeasured && <Caption className="mt-3">{ADOPTED_CAPTION}</Caption>}
      {ranUnmeasured && <Caption className={adoptedUnmeasured ? "mt-1" : "mt-3"}>{RAN_CAPTION}</Caption>}
    </div>
  );
}
