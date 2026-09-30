"use client";

// One skill, open: lifecycle ladder, the body, actions, adoption and outcomes.
import { Caption, CellMark, Chip, ChipRow, Ladder, Panel } from "@/components/kit";
import { skillCategoryLabel } from "@/lib/org/skill-categories";
import { skillEventSourceLabel } from "@/lib/org/skill-event-source";
import type { SkillAdoption, SkillRow } from "@/lib/db";
import type { SkillOutcome } from "@/lib/org/skill-outcomes";
import type { SkillUsage } from "@/lib/org/skill-usage";
import { SkillActionsV2 } from "./SkillActions.v2";
import { SkillAdoptV2 } from "./SkillAdopt.v2";
import { SkillOutcomesV2 } from "./SkillOutcomes.v2";
import { SkillTraceV2 } from "./SkillTrace.v2";
import { dormancyMark, skillLadder, USES_CAPTION, usesWord } from "./skillSceneModel";

function focusNode(node: HTMLDivElement | null) {
  node?.focus();
}

export function SkillSceneBodyV2({
  slug,
  skill: s,
  usage,
  outcomes,
  adoption,
  repoOptions,
  canArchive,
  onArchive,
  registryBase,
  fleetSize,
}: {
  slug: string;
  skill: SkillRow;
  usage: SkillUsage | undefined;
  outcomes: SkillOutcome[] | undefined;
  adoption: SkillAdoption | undefined;
  repoOptions: string[];
  canArchive: boolean;
  onArchive: () => void;
  registryBase: string | null;
  fleetSize: number;
}) {
  const mark = dormancyMark(usage);
  const category = s.category ? skillCategoryLabel(s.category) : "Uncategorized";
  return (
    <div key={s.id} ref={focusNode} tabIndex={-1} className="mt-4 outline-none">
      <Panel aria-label={s.name}>
        <ChipRow>
          <Chip tone="neutral">{category}</Chip>
          {registryBase && <Chip tone="neutral">{s.origin === "registry" ? "registry" : "hosted"}</Chip>}
          {s.version > 1 && <Chip tone="neutral">v{s.version}</Chip>}
          <CellMark state={mark.state}>{mark.word}</CellMark>
        </ChipRow>
        {s.version > 1 && <Caption className="mt-2">Last edited {s.updatedAt.slice(0, 10)}.</Caption>}
        <div className="mt-4">
          <Ladder label={`${s.name} lifecycle`} steps={skillLadder(s, usage, fleetSize)} />
        </div>
        {s.description && <p className="mt-4 type-body text-slate-200">{s.description}</p>}
        {s.tags.length > 0 && (
          <ChipRow className="mt-3">
            {s.tags.map((t) => (
              <Chip key={t} tone="neutral">
                #{t}
              </Chip>
            ))}
          </ChipRow>
        )}
        <details className="mt-4">
          <summary className="cursor-pointer type-body-sm text-slate-200">Preview skill</summary>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap border-t border-divider pt-3 type-caption text-slate-200">
            {s.content}
          </pre>
        </details>
        <Caption className="mt-3">
          {usesWord(usage)}
          {usage && usage.state !== "unmeasured" && usage.invokes > 0 ? `, ${usage.invokes.toLocaleString()} ran` : ""}
          {usage?.lastUsedAt ? `. Last report: ${skillEventSourceLabel(usage.lastUsedSource ?? null)}.` : ""}
        </Caption>
        <Caption>{USES_CAPTION}</Caption>
        {usage?.lastUsedAt && (
          <Caption>Reporting client of the last recorded event. Unattributed is a gap, not a guess.</Caption>
        )}
        <SkillActionsV2 skill={s} canArchive={canArchive} onArchive={onArchive} registryBase={registryBase} />
        {s.origin === "registry" && <SkillTraceV2 slug={slug} skill={s.name} />}
        <SkillOutcomesV2 outcomes={outcomes} />
        <SkillAdoptV2 skillId={s.id} adoption={adoption} repoOptions={repoOptions} />
      </Panel>
    </div>
  );
}
