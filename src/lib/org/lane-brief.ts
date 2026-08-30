// THE LANE BRIEF — the organization's OWN standard, assembled into the text one remediation lane is
// briefed with, plus the provenance record of what went into it.
//
// WHY IT EXISTS. Until now a lane's prompt was `buildFixPrompt(batch, …)` plus one fixed paragraph:
// Ascent's words about the org's backlog, and nothing of the org's own standard. So the loop applied
// generic best practice, which is what every remediation vendor applies. The differentiator is that
// Ascent *holds* the org's versioned standard — its playbooks, the house pattern mined from its own
// repositories, its procedural memory, its registry skills — and can hand exactly the relevant slice
// of it to the agent, then learn only from what a rescan verified.
//
// PURE. No Prisma, no fetch, no clock. The four reads live in `src/lib/db/lane-brief-read.ts` (the
// `-load.ts` sibling pattern) so `next build` never drags the db layer into a client chunk, and so
// the assembly itself is a table test.
//
// TWO RULES THE WHOLE MODULE ANSWERS TO:
//
//   1. NEVER A SILENT EMPTY SECTION. A section the org does not have is recorded in `omitted` with a
//      reason AND said in words in the brief ("No playbook covers D5 in this organization."). An
//      agent handed a heading with nothing under it reads it as "there is no standard here"; an
//      agent told so explicitly can say so back. The absence is the finding.
//   2. A TRIMMED BRIEF NEVER READS AS A COMPLETE ONE. Truncation is per section, marked in the text
//      (`… (n more, trimmed)`) and recorded in provenance with the byte count.
//
// Ordering is deterministic (dimId, then the source's own rank, then id) so two runs on the same data
// produce byte-identical briefs — a brief that reshuffles between runs makes every A/B comparison of
// two lanes a comparison of two prompts.

import { neutralize } from "@/lib/llm/untrusted";
import type { SkillCategory } from "@/lib/org/skill-categories";

export type BriefSectionKind = "playbook" | "housePattern" | "memory" | "skill" | "evidence";

/** Whole-brief ceiling. A brief past this is a wall of text the session skims rather than follows. */
export const BRIEF_MAX_BYTES = 12_000;

/** Per-section ceilings, in the order the brief renders them. They sum below BRIEF_MAX_BYTES on
 *  purpose: the headings, the absence lines and the report contract need room too. */
export const SECTION_MAX_BYTES: Record<BriefSectionKind, number> = {
  playbook: 4_000,
  housePattern: 3_000,
  memory: 2_500,
  skill: 1_000,
  evidence: 2_000,
};

/**
 * Which dimensions a skill CATEGORY speaks to.
 *
 * Declared HERE rather than in `src/lib/org/skill-categories.ts`, deliberately: the shared taxonomy is
 * a flat seven-value enum with no dimension link, and it is not this lane's module to widen. If a
 * second consumer ever needs the same mapping, that is the moment it moves — not before, because a
 * mapping with one consumer that lives in the shared module is a mapping nobody can change safely.
 */
export const SKILL_CATEGORY_DIMS: Record<SkillCategory, string[]> = {
  "ci-cd": ["D3", "D6"],
  testing: ["D6"],
  security: ["D9"],
  "ai-native": ["D1", "D2"],
  docs: ["D1"],
  workflow: ["D5"],
  other: [],
};

export interface LaneBriefInput {
  org: string;
  repo: string;
  /** The dimensions this lane's batch is aimed at — every section is filtered to them. */
  dimIds: string[];
  playbooks: { id: string; title: string; dimId: string; version: number; summary: string; steps: string[] }[];
  housePattern: { practiceId: string; label: string; dimId: string; lines: string[]; exemplars: string[] }[];
  memories: { id: string; kind: string; content: string; source: string | null }[];
  skills: { id: string; name: string; category: string; summary: string }[];
  evidence: { dimId: string; name: string; score: number; evidence: string[]; gaps: string[] }[];
}

export interface BriefSectionProvenance {
  kind: BriefSectionKind;
  dimIds: string[];
  count: number;
  bytes: number;
  /** Ids of what was quoted — `playbookId@version`, practice ids, memory ids, skill ids, dim ids. */
  refs: string[];
  /** True when the section hit its byte cap and entries were dropped. */
  trimmed: boolean;
}

export interface LaneBriefProvenance {
  v: 1;
  bytes: number;
  sections: BriefSectionProvenance[];
  omitted: { kind: BriefSectionKind; why: string }[];
  /** RESERVED for W2-J2 (#33): the `HousePatternVersion` the quoted pattern came from. Left null by
   *  this lane — a version field filled with a guess is worse than one honestly empty. */
  housePatternVersion: string | null;
}

const byteLen = (s: string): number => Buffer.byteLength(s, "utf8");

/** Clean one piece of untrusted text: memory content and mined lines are written by an org's members
 *  and by its agents, so they reach a prompt through the same neutralizer repo excerpts do. */
const clean = (s: string, max: number): string => neutralize(s).replace(/\s+/g, " ").trim().slice(0, max);

/**
 * Take entries until the section's byte cap, then stop and say how many were dropped.
 *
 * Returns the kept lines plus the dropped count, so the caller can render the marker AND record
 * `trimmed` in provenance — the two must never disagree.
 */
function capped(lines: readonly string[], max: number): { kept: string[]; dropped: number } {
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    const cost = byteLen(line) + 1;
    if (used + cost > max) break;
    kept.push(line);
    used += cost;
  }
  return { kept, dropped: lines.length - kept.length };
}

/** One rendered section, or null when there was nothing to render. */
interface Rendered {
  kind: BriefSectionKind;
  heading: string;
  lines: string[];
  refs: string[];
  dimIds: string[];
  dropped: number;
}

function renderPlaybooks(input: LaneBriefInput): Rendered {
  const rows = input.playbooks
    .filter((p) => input.dimIds.includes(p.dimId))
    .sort((a, b) => a.dimId.localeCompare(b.dimId) || a.id.localeCompare(b.id));
  const lines = rows.map((p) => {
    const steps = p.steps.map((s, i) => `   ${i + 1}. ${clean(s, 300)}`).join("\n");
    // The VERSION is named, not just the title: a playbook is a versioned artifact and "which
    // version did the agent see" is the question a disputed close turns on.
    return `- ${p.title} (playbook ${p.id} v${p.version}, ${p.dimId})\n   ${clean(p.summary, 400)}\n${steps}`;
  });
  const cap = capped(lines, SECTION_MAX_BYTES.playbook);
  return {
    kind: "playbook",
    heading: "ACTIVE PLAYBOOKS — this organization's own steps for these dimensions",
    lines: cap.kept,
    refs: rows.slice(0, cap.kept.length).map((p) => `${p.id}@${p.version}`),
    dimIds: [...new Set(rows.map((p) => p.dimId))],
    dropped: cap.dropped,
  };
}

function renderHousePattern(input: LaneBriefInput): Rendered {
  const rows = input.housePattern
    .filter((h) => input.dimIds.includes(h.dimId))
    .sort((a, b) => a.dimId.localeCompare(b.dimId) || a.practiceId.localeCompare(b.practiceId));
  const lines = rows.map(
    (h) =>
      // The exemplar count is load-bearing: a pattern mined from one repository is a habit, and one
      // mined from six is a house style. The agent is entitled to weigh them differently.
      `- ${h.label} (${h.practiceId}, ${h.dimId}) — mined from ${h.exemplars.length} repo(s): ${h.exemplars.slice(0, 6).join(", ")}\n${h.lines
        .slice(0, 12)
        .map((l) => `   ${clean(l, 200)}`)
        .join("\n")}`,
  );
  const cap = capped(lines, SECTION_MAX_BYTES.housePattern);
  return {
    kind: "housePattern",
    heading: "HOUSE PATTERN — how this organization already does it, mined from its own repositories",
    lines: cap.kept,
    refs: rows.slice(0, cap.kept.length).map((h) => h.practiceId),
    dimIds: [...new Set(rows.map((h) => h.dimId))],
    dropped: cap.dropped,
  };
}

function renderMemories(input: LaneBriefInput): Rendered {
  // Order is the RECALL's, kept as given: the caller has already ranked these by agreement/recency,
  // and re-sorting here would throw that ranking away. Determinism comes from the recall being
  // deterministic for a given input, which is the property the brief's byte-identity test pins.
  const rows = input.memories;
  const lines = rows.map((m) => `- (${m.kind}${m.source ? ` · ${m.source}` : ""}) ${clean(m.content, 600)}`);
  const cap = capped(lines, SECTION_MAX_BYTES.memory);
  return {
    kind: "memory",
    heading: "ORG MEMORY — decisions and procedures this organization has already recorded",
    lines: cap.kept,
    refs: rows.slice(0, cap.kept.length).map((m) => m.id),
    dimIds: [],
    dropped: cap.dropped,
  };
}

function renderSkills(input: LaneBriefInput): Rendered {
  const rows = input.skills
    .filter((s) => (SKILL_CATEGORY_DIMS[s.category as SkillCategory] ?? []).some((d) => input.dimIds.includes(d)))
    .sort((a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id));
  const lines = rows.map((s) => `- ${s.name} (${s.category}) — ${clean(s.summary, 200)}`);
  const cap = capped(lines, SECTION_MAX_BYTES.skill);
  return {
    kind: "skill",
    heading: "REGISTRY SKILLS this organization maintains for this work",
    lines: cap.kept,
    refs: rows.slice(0, cap.kept.length).map((s) => s.id),
    dimIds: [...new Set(rows.flatMap((s) => SKILL_CATEGORY_DIMS[s.category as SkillCategory] ?? []))],
    dropped: cap.dropped,
  };
}

function renderEvidence(input: LaneBriefInput): Rendered {
  const rows = input.evidence
    .filter((e) => input.dimIds.includes(e.dimId))
    .sort((a, b) => a.dimId.localeCompare(b.dimId));
  const lines = rows.map(
    (e) =>
      `- ${e.dimId} ${e.name} — scored ${e.score}\n   observed: ${e.evidence.slice(0, 4).map((x) => clean(x, 160)).join("; ") || "nothing recorded"}\n   missing: ${e.gaps.slice(0, 4).map((x) => clean(x, 160)).join("; ") || "nothing recorded"}`,
  );
  const cap = capped(lines, SECTION_MAX_BYTES.evidence);
  return {
    kind: "evidence",
    heading: "WHAT THE LAST SCAN ACTUALLY SAW in this repository",
    lines: cap.kept,
    refs: rows.slice(0, cap.kept.length).map((e) => e.dimId),
    dimIds: rows.map((e) => e.dimId),
    dropped: cap.dropped,
  };
}

/** The words an empty section is stated in. Never a bare heading, never silence. */
const ABSENCE: Record<BriefSectionKind, (dims: string) => string> = {
  playbook: (d) => `No playbook in this organization covers ${d}. There is no house procedure to follow here — use the repository's own conventions and say so in your report.`,
  housePattern: (d) => `No house pattern has been mined for ${d}: not enough of this organization's repositories do it yet. You are setting the precedent, not matching one.`,
  memory: () => "This organization has recorded no procedural memory for this repository.",
  skill: (d) => `This organization maintains no registry skill for ${d}.`,
  evidence: (d) => `No stored scan evidence for ${d} — the last scan did not record what it saw for these dimensions.`,
};

/**
 * Assemble the brief. Pure and total: every input shape degrades to an honest absence line, so there
 * is no input for which this returns a brief that overstates what the organization has.
 */
export function buildLaneBrief(input: LaneBriefInput): { text: string; provenance: LaneBriefProvenance } {
  const dims = [...new Set(input.dimIds)].sort();
  const dimLabel = dims.length > 0 ? dims.join(", ") : "these dimensions";
  const rendered = [
    renderPlaybooks(input),
    renderHousePattern(input),
    renderMemories(input),
    renderSkills(input),
    renderEvidence({ ...input, dimIds: dims }),
  ];

  const parts: string[] = [];
  const sections: BriefSectionProvenance[] = [];
  const omitted: { kind: BriefSectionKind; why: string }[] = [];

  for (const r of rendered) {
    if (r.lines.length === 0) {
      // "none" rather than a silent gap — the brief SAYS the standard is absent, in words.
      omitted.push({ kind: r.kind, why: "none" });
      parts.push(`${r.heading}\n${ABSENCE[r.kind](dimLabel)}`);
      continue;
    }
    const body = r.dropped > 0 ? `${r.lines.join("\n")}\n… (${r.dropped} more, trimmed)` : r.lines.join("\n");
    const block = `${r.heading}\n${body}`;
    parts.push(block);
    sections.push({
      kind: r.kind,
      dimIds: r.dimIds,
      count: r.lines.length,
      bytes: byteLen(block),
      refs: r.refs,
      trimmed: r.dropped > 0,
    });
  }

  let text = parts.join("\n\n");
  if (byteLen(text) > BRIEF_MAX_BYTES) {
    // A whole-brief overflow can only happen when several sections each sit just under their own cap.
    // Cutting says so rather than ending mid-sentence and reading as a complete standard.
    text = `${text.slice(0, BRIEF_MAX_BYTES)}\n… (brief trimmed to ${BRIEF_MAX_BYTES} bytes)`;
  }
  return { text, provenance: { v: 1, bytes: byteLen(text), sections, omitted, housePatternVersion: null } };
}

/** One line for a human: what went into the brief, and what the org simply did not have. */
export function briefSummaryLine(p: LaneBriefProvenance): string {
  const named: Record<BriefSectionKind, (n: number) => string> = {
    playbook: (n) => `${n} playbook${n === 1 ? "" : "s"}`,
    housePattern: (n) => `house pattern from ${n} practice${n === 1 ? "" : "s"}`,
    memory: (n) => `${n} memor${n === 1 ? "y" : "ies"}`,
    skill: (n) => `${n} skill${n === 1 ? "" : "s"}`,
    evidence: (n) => `evidence for ${n} dimension${n === 1 ? "" : "s"}`,
  };
  const have = p.sections.map((s) => named[s.kind](s.count));
  const none = p.omitted.map((o) => `no ${o.kind === "housePattern" ? "house pattern" : o.kind}`);
  return [...have, ...none, `${(p.bytes / 1000).toFixed(1)} KB`].join(" · ");
}
