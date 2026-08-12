// AI_POLICY.md renderer (W3) — turn the org's PUBLISHED stance into the committed artifact a repo
// carries, opened as a draft PR through the same machinery Practices uses (openArtifactDraftPr).
// Pure and deterministic (no LLM, no IO), sibling of buildArtifact in practice-artifact.ts.
//
// The filename is deliberately AI_POLICY.md: the D1 detector already rewards a committed
// `ai[-_]policy` file ("Found an AI-usage policy/guide", src/lib/analyze/index.ts), so adopting the
// stance measurably lifts the exact dimension that scores AI guidance — the loop closes itself.
//
// HONESTY: the artifact renders path-scoped no-AI zones under the same advisory label the UI uses
// (PATH_ZONE_ADVISORY_LABEL) and describes provenance requirements as what a change "must carry",
// never as something Ascent enforces.

import type { ArtifactSpec, RepoContext } from "@/lib/practice-artifact";
import { safeText } from "@/lib/practice-artifact";
import { PATH_ZONE_ADVISORY_LABEL } from "@/lib/org/stance";
import { publicBaseUrl } from "@/lib/site";
import type { AiStance, AutonomyTierId } from "@/lib/types";

/** Repo-relative path — MUST keep matching D1's `ai[-_]policy` reward regex (pinned by test). */
export const STANCE_ARTIFACT_PATH = "AI_POLICY.md";

const TIER_NAMES: Record<AutonomyTierId, string> = {
  T0: "T0 · Observe-only",
  T1: "T1 · Tests, docs, refactors",
  T2: "T2 · Features with review",
  T3: "T3 · Scheduled autonomous",
};

function list(items: string[], empty: string): string {
  return items.length ? items.map((t) => `- ${safeText(t)}`).join("\n") : `- _${empty}_`;
}

/**
 * Build the AI_POLICY.md draft-PR artifact from a published stance. `version`/`publishedAt` stamp
 * WHICH revision the file states, so a repo's committed copy is auditable against the org history.
 */
export function buildStanceArtifact(
  stance: AiStance,
  meta: { org: string; version: number; publishedAt?: string | null },
  ctx: RepoContext,
): ArtifactSpec {
  const org = safeText(meta.org);
  const fullName = safeText(ctx.fullName);

  const zones = stance.noAiZones
    .map((z) => {
      const lines: string[] = [];
      for (const g of z.repoGlobs) lines.push(`- Repo scope: \`${safeText(g)}\``);
      for (const g of z.pathGlobs) lines.push(`- Path scope: \`${safeText(g)}\` — ${PATH_ZONE_ADVISORY_LABEL}`);
      if (z.reason) lines.push(`  - Why: ${safeText(z.reason)}`);
      return lines.join("\n");
    })
    .join("\n");

  const tiers = stance.reviewTiers
    .map((t) => `- **${TIER_NAMES[t.tier]}** — ${safeText(t.review)}`)
    .join("\n");

  const provenance: string[] = [];
  if (stance.provenance.requireTrailer) {
    provenance.push(
      "- Every AI-assisted commit carries an attribution trailer (e.g. `Co-Authored-By:` / `Assisted-By:` naming the tool).",
    );
  }
  if (stance.provenance.requireHumanApproval) {
    provenance.push("- Every AI-attributed pull request has an approving HUMAN review before merge.");
  }

  const body = `# AI policy — ${org}

> Org stance **v${meta.version}**${meta.publishedAt ? `, effective ${safeText(meta.publishedAt)}` : ""}. This file is the
> committed copy of the organization's published AI stance; the org dashboard reads adoption and
> observed attribution against it. Compliance readouts compare what is DECLARED here with what git
> attribution shows — nothing in this file is enforced by tooling on its own.

## 1. Permitted tools

AI tools/agents approved for use on this organization's code:

${list(stance.permittedTools, "No tool allowlist declared yet.")}

## 2. Permitted models

${list(stance.permittedModels, "No model allowlist declared yet.")}

## 3. No-AI zones

Repos and paths closed to AI authorship. An agent may read them and open a proposal; a change
authored inside one contradicts this stance.

${zones || "- _No zones declared._"}

## 4. Review tiers

Review requirements by autonomy tier (each repo's tier is derived from its readiness passport):

${tiers || "- _No tier-specific review requirements declared._"}

## 5. Provenance

What an AI-assisted change must carry so the history stays honest about how it was produced:

${provenance.join("\n") || "- _No provenance requirements declared._"}
`;

  const base = publicBaseUrl();
  const attribution = base
    ? `Published from the [${org} governance dashboard](${base}/org/${encodeURIComponent(meta.org)}?tab=governance) via Ascent.`
    : "Published from the org governance dashboard via Ascent.";

  return {
    practiceId: "ai-stance",
    path: STANCE_ARTIFACT_PATH,
    body,
    commitMessage: `chore: adopt the org AI policy v${meta.version} (via Ascent)`,
    branch: "ascent/ai-stance",
    prTitle: `Adopt the org AI policy (v${meta.version})`,
    prBody: `This draft commits the organization's published AI stance **v${meta.version}** into \`${fullName}\` as \`${STANCE_ARTIFACT_PATH}\`.

It states the permitted tools/models, the no-AI zones, the review tier requirements, and the
provenance a change must carry. Merging it also counts as this repo's written adoption of the
stance — acknowledge the version on the governance dashboard to complete the loop.

${attribution}`,
  };
}
