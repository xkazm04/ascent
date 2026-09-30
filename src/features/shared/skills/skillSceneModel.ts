// Prism shaping for the skills library. Verdicts stay the server's. Unknown stays "not measured", never 0.
import type { CellState, LadderState, LadderStep } from "@/components/kit";
import type { SkillRow } from "@/lib/db";
import { skillCategoryLabel } from "@/lib/org/skill-categories";
import {
  aggregateOutcomes,
  outcomeStatusLabel,
  PAIRING_MAX_DISTANCE_DAYS,
  type OutcomeStatus,
  type SkillOutcome,
} from "@/lib/org/skill-outcomes";
import { usageSummary, type SkillUsage, type SkillUsageState } from "@/lib/org/skill-usage";
import { usageDetail } from "./skillLifecycleViz";

export interface SkillMark {
  state: CellState;
  word: string;
}
export interface SkillFigure {
  label: string;
  value: string;
  tone?: "good" | "watch";
  detail?: string;
}

const DRIFT: Record<SkillUsageState, SkillMark> = {
  active: { state: "met", word: "active" },
  abandoned: { state: "partial", word: "dormant" },
  unused: { state: "missing", word: "never used" },
  new: { state: "partial", word: "new" },
  unmeasured: { state: "unmeasured", word: "not measured" },
};

export function dormancyMark(usage: SkillUsage | undefined): SkillMark {
  if (!usage?.state || !DRIFT[usage.state]) return { state: "unmeasured", word: "not measured" };
  return DRIFT[usage.state];
}

export function adoptedMark(skill: Pick<SkillRow, "adoptionCount">, fleetSize: number): SkillMark {
  if (fleetSize <= 0) return { state: "unmeasured", word: "not measured" };
  if (skill.adoptionCount <= 0) return { state: "missing", word: "not adopted" };
  const share = Math.min(100, Math.round((skill.adoptionCount / fleetSize) * 100));
  return share >= 100 ? { state: "met", word: "adopted" } : { state: "partial", word: `${share}% adopted` };
}

export function copiedMark(skill: Pick<SkillRow, "downloadCount">): SkillMark {
  return skill.downloadCount > 0 ? { state: "met", word: "copied" } : { state: "missing", word: "not copied" };
}

export function ranMark(usage: SkillUsage | undefined): SkillMark {
  if (!usage || usage.state === "unmeasured") return { state: "unmeasured", word: "not measured" };
  return usage.invokes > 0 ? { state: "met", word: "ran" } : { state: "missing", word: "not run" };
}

export function usesWord(usage: SkillUsage | undefined): string {
  if (!usage || usage.state === "unmeasured") return "uses not measured";
  if (usage.useCount === 0) return "no uses";
  return usage.useCount === 1 ? "1 use" : `${usage.useCount} uses`;
}

function stage(mark: SkillMark): LadderState {
  if (mark.state === "unmeasured") return "unmeasured";
  if (mark.state === "missing") return "open";
  return "reached";
}

function visibleUsage(skills: SkillRow[], usage: Record<string, SkillUsage>): Record<string, SkillUsage> {
  const out: Record<string, SkillUsage> = {};
  for (const s of skills) {
    const row = usage[s.id];
    if (row) out[s.id] = row;
  }
  return out;
}

export function skillLadder(skill: SkillRow, usage: SkillUsage | undefined, fleetSize: number): LadderStep[] {
  const adopted = adoptedMark(skill, fleetSize);
  const copied = copiedMark(skill);
  const ran = ranMark(usage);
  const drift = dormancyMark(usage);
  const driftState: LadderState =
    drift.state === "unmeasured" ? "unmeasured" : usage?.state === "active" || usage?.state === "abandoned" ? "current" : "open";
  return [
    { key: "library", label: "In the library", state: "reached", detail: skill.version > 1 ? `v${skill.version}` : "first version" },
    {
      key: "adopted",
      label: "Adopted",
      state: stage(adopted),
      detail: fleetSize <= 0 ? "no repositories" : skill.adoptionCount ? `${skill.adoptionCount} of ${fleetSize}` : `none of ${fleetSize}`,
    },
    { key: "copied", label: "Copied", state: stage(copied), detail: copied.word },
    { key: "ran", label: "Ran", state: stage(ran), detail: ran.state === "unmeasured" ? "not measured" : ran.word },
    { key: "drift", label: "Still in use", state: driftState, detail: usage ? usageDetail(usage) : "not measured" },
  ];
}

export function fleetLadder(skills: SkillRow[], usage: Record<string, SkillUsage>, fleetSize: number): LadderStep[] {
  const n = skills.length;
  const summary = usageSummary(visibleUsage(skills, usage));
  const known = summary.total > 0;
  const blind = !known || summary.unmeasured === summary.total;
  const adopted = skills.filter((s) => s.adoptionCount > 0).length;
  const copied = skills.filter((s) => s.downloadCount > 0).length;
  const ran = skills.filter((s) => {
    const row = usage[s.id];
    return Boolean(row && row.state !== "unmeasured" && row.invokes > 0);
  }).length;
  const ranState: LadderState = blind ? "unmeasured" : ran > 0 ? "reached" : "open";
  const driftState: LadderState = blind ? "unmeasured" : summary.abandoned > 0 ? "current" : summary.active > 0 ? "reached" : "open";
  return [
    { key: "library", label: "In the library", state: n > 0 ? "reached" : "open", detail: `${n} skills` },
    {
      key: "adopted",
      label: "Adopted",
      state: fleetSize <= 0 ? "unmeasured" : adopted > 0 ? "reached" : "open",
      detail: fleetSize <= 0 ? "no repositories" : adopted ? `${adopted} of ${n}` : `none of ${n}`,
    },
    { key: "copied", label: "Copied", state: copied > 0 ? "reached" : "open", detail: copied ? `${copied} of ${n}` : `none of ${n}` },
    { key: "ran", label: "Ran", state: ranState, detail: blind ? "not measured" : ran ? `${ran} of ${n}` : `none of ${n}` },
    {
      key: "drift",
      label: "Still in use",
      state: driftState,
      detail: blind ? "not measured" : `${summary.active || "no"} active, ${summary.abandoned || "no"} dormant`,
    },
  ];
}

export function skillFigures(skills: SkillRow[], usage: Record<string, SkillUsage>, repoCount: number): SkillFigure[] {
  const summary = usageSummary(visibleUsage(skills, usage));
  const figures: SkillFigure[] = [
    { label: "Skills", value: String(skills.length) },
    { label: "Repos", value: String(repoCount) },
  ];
  if (summary.total === 0 || summary.unmeasured === summary.total) {
    figures.push({ label: "Use", value: "not measured", detail: "No skill event has been recorded" });
    return figures;
  }
  figures.push({ label: "Active", value: String(summary.active), tone: summary.active > 0 ? "good" : undefined });
  figures.push({
    label: "Dormant",
    value: String(summary.abandoned),
    tone: summary.abandoned > 0 ? "watch" : undefined,
    detail: "Tried, then quiet",
  });
  if (summary.unmeasured > 0) figures.push({ label: "Not measured", value: String(summary.unmeasured) });
  return figures;
}

export function skillRowDetail(skill: SkillRow, usage: SkillUsage | undefined, fleetSize: number): string {
  const category = skill.category ? skillCategoryLabel(skill.category) : "Uncategorized";
  const known = Boolean(usage && usage.state !== "unmeasured");
  const bits = [category, adoptedMark(skill, fleetSize).word, copiedMark(skill).word, ranMark(usage).word];
  if (known && usage) bits.push(usageDetail(usage), usesWord(usage));
  else bits.push("not measured");
  if (skill.version > 1) bits.push(`v${skill.version}, edited ${skill.updatedAt.slice(0, 10)}`);
  if (skill.origin === "registry") bits.push("registry");
  return bits.join(", ");
}

export function outcomeMark(status: OutcomeStatus): SkillMark {
  if (status === "measured") return { state: "met", word: "measured" };
  if (status === "no-before-scan" || status === "no-after-scan") return { state: "missing", word: outcomeStatusLabel(status) };
  return { state: "unmeasured", word: outcomeStatusLabel(status) };
}

export function outcomeHeadline(outcomes: SkillOutcome[]): string {
  const a = aggregateOutcomes(outcomes);
  const head = a.meanDelta === null ? "No comparable before/after pair" : `${a.meanDelta > 0 ? "+" : ""}${a.meanDelta} pts mean`;
  const gaps: string[] = [];
  if (a.byStatus["no-after-scan"]) gaps.push(`${a.byStatus["no-after-scan"]} with no scan since adoption`);
  if (a.byStatus["no-before-scan"]) gaps.push(`${a.byStatus["no-before-scan"]} with no scan before it`);
  const instrument = a.byStatus["instrument-unknown"] + a.byStatus["instrument-mismatch"];
  if (instrument) gaps.push(`${instrument} not comparable across rubric versions`);
  const extra = gaps.length ? ` ${gaps.join(", ")}.` : "";
  return `${head}. ${a.measured} of ${a.total} adoptions measured.${extra}`;
}

export function anchorNote(anchor: SkillOutcome["anchor"]): string {
  return anchor === "adoption" ? "Anchored at the adoption a person recorded." : "No adoption was recorded. Anchored at the first reported run.";
}

export function wideWindowNote(o: SkillOutcome): string | null {
  if (o.withinPairingBound !== false) return null;
  return `Wide window: more than ${PAIRING_MAX_DISTANCE_DAYS} days from the adoption (${o.beforeGapDays ?? "unknown"}d before, ${o.afterGapDays ?? "unknown"}d after). Other work can dominate that window.`;
}

export function shortName(name: string, max = 24): string {
  return name.length > max ? `${name.slice(0, max)}…` : name;
}

export const ADOPTED_CAPTION =
  "Adopted is the share of this org's repositories that recorded taking the skill on. With no repositories in the fleet there is no denominator, so the step is not measured rather than a share of nothing.";

export const RAN_CAPTION =
  "A skill runs through the Skill hook, the MCP tool path, or a CI job. Where this org has never emitted a skill event of any kind, Ran is not measured: nothing is known about whether it ran, which is not the same as knowing it never did.";

export const USES_CAPTION =
  "All-time volume: sink A (events API: copies, downloads, hook, CI and MCP invokes) plus sink B (registry usage/ over each contributor's declared window). Distinct from the Registry tab's 30d invoke rate.";
