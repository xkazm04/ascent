// The BRIEF a registry dispatch hands to a coding agent Ascent does not watch — spark
// knowledge-base-rebuild, WP2.
//
// Shaped by the registry's `remediation-handoff` golden path (single-artifact-prompt-construction):
// one codebase per artifact, the stable id VERBATIM, a rules block, and the return contract stated
// as a rule rather than a footnote. Everything the agent will know is in this text — there is no
// callback, no session log, and no way to answer a question after the hand-off.
//
// PURE AND DETERMINISTIC. Same input → byte-identical output: no clock, no random id, no model in
// the construction path. That is what lets a brief be digested (`briefDigest`), diffed between two
// generations, and unit-tested — the only test available for a consumer outside this process. The
// dispatch id arrives as INPUT; this module never mints one.
//
// The return path is the codebase itself: Ascent learns a dispatch is done by sweeping the repo's
// committed `.ai/registry-map.json`, never from anything the agent reports. The `Ascent-Dispatch`
// trailer makes the PR traceable to its row; the sweep does not depend on it.

import { createHash } from "node:crypto";
import type { KnowledgeContextRow, KnowledgeView, RegistryDispatchStage } from "@/lib/org/knowledge-shape";

/** One picked subject's subscribed contexts — `KnowledgeCell.contextRows` for (subject × repo), in
 *  the fold's order (worst state first, then name), plus the subject's revision line when known. */
export interface BriefSubjectContexts {
  slug: string;
  revision: number | null;
  changedAt: string | null;
  contextRows: KnowledgeContextRow[];
}

/** The repo's context churn as the last sweep saw it (`KnowledgeRepo`), for a `map` brief. */
export interface BriefRepoChurn {
  orphaned: number;
  arrived: number;
  renamed: number;
  contextMapRevision: string | null;
  repoContextMapRevision: string | null;
  mapBehind: boolean;
}

/** The commit-trailer key the brief asks for. One definition, shared by every reader. */
export const DISPATCH_TRAILER_KEY = "Ascent-Dispatch";

/** The most subjects one `conform` brief names — one `/conform` call each is one session's budget. */
export const MAX_CONFORM_SUBJECTS = 12;

export interface RegistryBriefInput {
  /** Carried verbatim into the artifact so the agent can cite it. */
  dispatchId: string;
  /** "owner/name". */
  repoFullName: string;
  defaultBranch: string;
  stage: RegistryDispatchStage;
  /** Conform only; slugs VERBATIM, in the order given. */
  subjects: string[];
  /** e.g. "acme/ai-registry", "../ai-registry". */
  registry: { fullName: string; localHint: string };
  /** The repo's manifest domains; [] when unknown. */
  domains: string[];
  /** Conform only: the picked subjects' subscribed contexts. Omitted = the section is omitted
   *  (a caller without the matrix at hand composes the same brief it always did). */
  subjectContexts?: BriefSubjectContexts[];
  /** Map only: the repo's churn and the two context-map revisions. Omitted = the section is omitted. */
  repo?: BriefRepoChurn;
}

/**
 * The matrix half of a brief's inputs, read off the tab's own view so the brief names exactly the
 * rows the composer showed. Null view (loader failed) → both omitted: the brief degrades to the
 * shape it had before the relation existed, never to an empty section that claims "no contexts".
 */
export function briefInputsFromView(
  view: Pick<KnowledgeView, "subjects" | "repos" | "cells"> | null | undefined,
  repositoryId: string,
  subjects: string[],
): Pick<RegistryBriefInput, "subjectContexts" | "repo"> {
  if (!view) return {};
  const repo = view.repos.find((r) => r.repositoryId === repositoryId);
  const subjectContexts: BriefSubjectContexts[] = [];
  for (const slug of subjects) {
    const subject = view.subjects.find((s) => s.slug === slug);
    const cell = view.cells.find((c) => c.repositoryId === repositoryId && c.subject === slug);
    if (!subject) continue;
    subjectContexts.push({ slug, revision: subject.revision, changedAt: subject.changedAt, contextRows: cell?.contextRows ?? [] });
  }
  return {
    ...(subjectContexts.length ? { subjectContexts } : {}),
    ...(repo
      ? {
          repo: {
            orphaned: repo.orphaned,
            arrived: repo.arrived,
            renamed: repo.renamed,
            contextMapRevision: repo.contextMapRevision,
            repoContextMapRevision: repo.repoContextMapRevision,
            mapBehind: repo.mapBehind,
          },
        }
      : {}),
  };
}

/** `sha256:` + the first 16 hex chars of the text's SHA-256 — the ledger's `briefDigest`. */
export function briefDigest(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16)}`;
}

const STAGE_TITLE: Record<RegistryDispatchStage, string> = {
  populate: "populate the context map",
  map: "build the registry map",
  conform: "judge the named subjects",
};

/** The repository name — what the registry's bridge conventionally uses as the project slug. */
const projectName = (fullName: string): string => fullName.split("/").pop() || fullName;

function doThis(input: RegistryBriefInput): string[] {
  const name = projectName(input.repoFullName);
  const build = `node ${input.registry.localHint}/scripts/build-registry-map.mjs --project ${name}`;
  const domainsNote =
    input.domains.length > 0
      ? `Make sure \`.ai/manifest.yaml\` declares \`knowledge.domains\` — this repo's are: ${input.domains.join(", ")}.`
      : "Make sure `.ai/manifest.yaml` declares `knowledge.domains` (the registry bundles this repo consumes).";
  switch (input.stage) {
    case "populate":
      return [
        "1. Run `/project-populate contexts` (the registry skill) to write `context-map.json` — one entry per context, as the skill shapes it.",
        `2. Run \`${build}\` to write \`.ai/registry-map.json\` (\`${name}\` is the project slug the registry's bridge uses for this repo — usually the repository name).`,
        "3. Commit both files.",
      ];
    case "map":
      return [
        `1. ${domainsNote}`,
        `2. Run \`${build}\` to write \`.ai/registry-map.json\` (\`${name}\` is the project slug the registry's bridge uses for this repo — usually the repository name).`,
        "3. Commit `.ai/registry-map.json`.",
      ];
    case "conform":
      return [
        `Run \`/conform\` once per subject below (budget: ${input.subjects.length} — one call each, in this order):`,
        ...input.subjects.map((slug) => `- \`/conform --subject ${slug}\``),
        "",
        "Each verdict is written IN PLACE into `.ai/registry-map.json`: `state` (conformant / deviation / not-applicable), a one-line `evidence` with `file:line`, `evaluatedAt`, and `evaluatedAgainst` (the subject digest the verdict was judged against).",
        "Then commit the map.",
      ];
  }
}

/** `- <name> (<group>) — <state>[, stale][, judged at r<n>][, new]` — one line per subscribed context. */
function contextLine(row: KnowledgeContextRow): string {
  const where = row.group ? `${row.name} (${row.group})` : row.name;
  const facts = [row.state, ...(row.stale ? ["stale"] : []), ...(row.judgedRevision !== null ? [`judged at r${row.judgedRevision}`] : []), ...(row.arrived ? ["new"] : [])];
  return `- ${where} — ${facts.join(", ")}`;
}

/**
 * `## Subscribed contexts` — conform only, one block per picked subject IN THE ORDER PICKED, the
 * rows in the fold's order (worst first). The subject line carries `r<revision> · <changedAt>`
 * when the index knows them, so the agent can see "judged at r12, now r14" rather than only "stale".
 * A subject the caller gave no rows for is still listed: the agent must know it has nothing to
 * subscribe to yet, which is a different fact from "the section was not composed".
 */
function subscribedContexts(input: RegistryBriefInput): string[] {
  if (input.stage !== "conform" || !input.subjectContexts) return [];
  const bySlug = new Map(input.subjectContexts.map((s) => [s.slug, s]));
  const out = ["## Subscribed contexts", ""];
  for (const slug of input.subjects) {
    const s = bySlug.get(slug);
    const meta = s && s.revision !== null ? ` — r${s.revision}${s.changedAt ? ` · ${s.changedAt}` : ""}` : "";
    out.push(`### ${slug}${meta}`);
    if (!s || s.contextRows.length === 0) out.push("- (no subscribed contexts in the map)");
    else for (const row of s.contextRows) out.push(contextLine(row));
    out.push("");
  }
  out.pop();
  return out;
}

/**
 * `## Context map` — map only. The churn counts always (0 is a count the sweep read); the two
 * revisions only when the map is BEHIND, because that is the only time they are an instruction.
 */
function contextMapNote(input: RegistryBriefInput): string[] {
  if (input.stage !== "map" || !input.repo) return [];
  const r = input.repo;
  const out = ["## Context map", "", `- Orphaned verdicts: ${r.orphaned} · arrived contexts: ${r.arrived} · renamed contexts: ${r.renamed}`];
  if (r.mapBehind) {
    out.push(
      `- The context map moved after the registry map was built: the map was built from revision \`${r.contextMapRevision}\`, \`context-map.json\` is now \`${r.repoContextMapRevision}\`. Rebuilding the map re-subscribes every context.`,
    );
  }
  return out;
}

/**
 * Build the hand-off artifact. Pure: the same input produces the same text, byte for byte.
 */
export function buildRegistryBrief(input: RegistryBriefInput): string {
  const subjects = input.stage === "conform" ? input.subjects : [];
  const header = [
    `# Registry dispatch — ${STAGE_TITLE[input.stage]} for ${input.repoFullName}`,
    "",
    `Dispatch id: \`${input.dispatchId}\``,
    `Repository: ${input.repoFullName} (default branch \`${input.defaultBranch}\`)`,
    `Registry: ${input.registry.fullName} — local checkout at \`${input.registry.localHint}\` (as \`.ai/manifest.yaml\` → \`registry.local\` names it)`,
    `Stage: ${input.stage}`,
    ...(input.domains.length > 0 ? [`Domains: ${input.domains.join(", ")}`] : []),
    ...(subjects.length > 0 ? [`Subjects (${subjects.length}): ${subjects.join(", ")}`] : []),
    "",
    "This is one repository's registry stage, handed off by Ascent. Ascent will not see this session; everything it can tell you is in this document, and it learns the outcome only from what you commit.",
  ];

  const rules = [
    "## Working rules",
    "",
    "- Read this repository's own `AGENTS.md` / `CLAUDE.md` first and follow them over anything here.",
    `- Branch first. Never commit to \`${input.defaultBranch}\` directly.`,
    "- Make the smallest real change that completes the stage. Do not edit files merely to satisfy a checker.",
    "- The standard does not bend to the code: where the repo falls short, that is a deviation to record with its reason — never silent, never an argument for lowering the standard.",
    "- Skip what does not apply and say why, per item.",
    "- Never edit a guard test to make a gate pass.",
  ];

  const work = ["## Do this", "", ...doThis(input)];

  const ret = [
    "## Return contract",
    "",
    `- Commit on your branch and open a pull request to \`${input.defaultBranch}\`.`,
    "- Ascent detects completion by sweeping the committed `.ai/registry-map.json` after the PR merges. Do not report back any other way — there is no channel for it.",
    `- Add the trailer \`${DISPATCH_TRAILER_KEY}: ${input.dispatchId}\` to every commit of this work, so the PR is traceable to this dispatch. The sweep does not depend on it; the trailer is for people reading history.`,
    "- End with a per-item summary: done, skipped (with the reason), or needs a human.",
  ];

  const contexts = subscribedContexts(input);
  const churn = contextMapNote(input);
  return [
    ...header,
    "",
    ...rules,
    "",
    ...work,
    ...(contexts.length ? ["", ...contexts] : []),
    ...(churn.length ? ["", ...churn] : []),
    "",
    ...ret,
    "",
  ].join("\n");
}
