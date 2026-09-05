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
import type { RegistryDispatchStage } from "@/lib/org/knowledge-shape";

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

  return [...header, "", ...rules, "", ...work, "", ...ret, ""].join("\n");
}
