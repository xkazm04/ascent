// AI_POLICY.md renderer (W3). The two load-bearing contracts: (1) the artifact filename keeps
// matching the D1 detector's `ai[-_]policy` reward regex — the whole point of the apply-PR is that
// adopting the stance lifts the dimension that scores AI guidance; (2) the rendered document stays
// honest (advisory label on path zones, no enforcement claims) and injection-safe (repo-supplied
// text is neutralized the same way practice artifacts are).

import { describe, expect, it } from "vitest";
import { buildStanceArtifact, STANCE_ARTIFACT_PATH } from "./stance-artifact";
import { PATH_ZONE_ADVISORY_LABEL } from "./stance";
import type { AiStance } from "@/lib/types";

// The EXACT regex D1 uses (src/lib/analyze/index.ts) against lowercased tree paths.
const D1_AI_POLICY_REGEX = /(^|\/)(ai[-_]policy|ai[-_]tools|ai[-_]contributing|using[-_]ai)\.mdx?$/;

const stance: AiStance = {
  permittedTools: ["Claude Code", "Copilot"],
  permittedModels: ["claude-opus"],
  noAiZones: [
    { repoGlobs: ["acme/billing-*"], pathGlobs: ["prisma/migrations/**"], reason: "PCI scope" },
  ],
  reviewTiers: [
    { tier: "T0", review: "Normal review." },
    { tier: "T2", review: "Two approvals, one from the module owner." },
  ],
  provenance: { requireTrailer: true, requireHumanApproval: true },
};

const ctx = { fullName: "acme/api", name: "api" };
const meta = { org: "acme", version: 3, publishedAt: "2026-08-12" };

describe("buildStanceArtifact", () => {
  it("emits AI_POLICY.md — a path the D1 detector's ai[-_]policy reward matches (lowercased)", () => {
    const a = buildStanceArtifact(stance, meta, ctx);
    expect(a.path).toBe(STANCE_ARTIFACT_PATH);
    expect(D1_AI_POLICY_REGEX.test(a.path.toLowerCase())).toBe(true);
  });

  it("renders every stance section and stamps the version", () => {
    const a = buildStanceArtifact(stance, meta, ctx);
    expect(a.body).toContain("v3");
    expect(a.body).toContain("Claude Code");
    expect(a.body).toContain("claude-opus");
    expect(a.body).toContain("acme/billing-*");
    expect(a.body).toContain("Two approvals, one from the module owner.");
    expect(a.body).toContain("Co-Authored-By");
    expect(a.body).toContain("approving HUMAN review");
    expect(a.prTitle).toContain("v3");
    expect(a.commitMessage).toContain("v3");
    expect(a.branch).toBe("ascent/ai-stance");
  });

  it("labels path-scoped zones with the shared advisory sentence and never claims enforcement", () => {
    const a = buildStanceArtifact(stance, meta, ctx);
    expect(a.body).toContain(PATH_ZONE_ADVISORY_LABEL);
    // "nothing in this file is enforced by tooling" is the one permitted use of the word.
    expect(a.body.toLowerCase()).not.toMatch(/ascent enforces|is enforced by ascent/);
    expect(a.body).toContain("nothing in this file is enforced by tooling on its own");
  });

  it("neutralizes markdown-breaking characters in org/stance-supplied text", () => {
    const hostile: AiStance = {
      ...stance,
      permittedTools: ["Claude`</div><script>x"],
      noAiZones: [{ repoGlobs: ["acme/x"], pathGlobs: [], reason: "a`b<c>d" }],
    };
    const a = buildStanceArtifact(hostile, { ...meta, org: "ac<me>" }, ctx);
    expect(a.body).not.toContain("<script>");
    expect(a.body).not.toContain("<c>");
    expect(a.body).not.toContain("ac<me>");
  });

  it("degrades to explicit placeholders when sections are empty (never silent omission)", () => {
    const minimal: AiStance = {
      permittedTools: [],
      permittedModels: [],
      noAiZones: [],
      reviewTiers: [],
      provenance: { requireTrailer: true, requireHumanApproval: false },
    };
    const a = buildStanceArtifact(minimal, meta, ctx);
    expect(a.body).toContain("No tool allowlist declared yet.");
    expect(a.body).toContain("No zones declared.");
    expect(a.body).toContain("No tier-specific review requirements declared.");
  });
});
