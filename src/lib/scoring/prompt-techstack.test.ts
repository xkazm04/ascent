// Feature 3a — tech-stack prompt enrichment, ON by default since r21. The block is keyed on whether
// LlmScoreInput carries `techStack`; buildScanScoreInput sets it unless the TECH_STACK_PROMPT=0 kill
// switch is thrown, and only when extraction found a language or framework (an all-"unknown" block is
// noise, not evidence). These tests pin: absent techStack → the user message is byte-identical to the
// no-tech prompt; present techStack → a DETECTED TECH STACK block with the stack facts; the default
// scan path sends it; the kill switch restores the old prompt. Plus the env-flag helper.

import { describe, it, expect, afterEach, vi } from "vitest";
import { buildAssessmentPrompt } from "@/lib/scoring/prompt";
import { techStackPromptEnabled } from "@/lib/llm/config";
import type { LlmScoreInput } from "@/lib/llm/provider";
import type { TechStack } from "@/lib/types";
import { buildScanScoreInput } from "@/lib/scan-score-input";
import { RUBRIC_CORPUS, RUBRIC_NOW, type RubricFixture } from "@/lib/maturity/rubric-corpus";

const base: LlmScoreInput = {
  repo: { owner: "o", name: "r", url: "", stars: 0, forks: 0, defaultBranch: "main", primaryLanguage: "TypeScript" },
  signals: [],
  files: [],
  commitSample: [],
  archetype: "org",
};

const stack: TechStack = {
  languages: ["TypeScript", "Python"],
  frameworks: ["Next.js", "FastAPI"],
  roles: ["frontend", "backend"],
  backendLanguage: "Python",
  confidence: 0.8,
};

describe("buildAssessmentPrompt — gated tech block", () => {
  it("omits the block (byte-identical user message) when techStack is absent", () => {
    const without = buildAssessmentPrompt(base).user;
    const undef = buildAssessmentPrompt({ ...base, techStack: undefined }).user;
    expect(without).toBe(undef);
    expect(without).not.toContain("DETECTED TECH STACK");
  });

  it("adds the DETECTED TECH STACK block with the stack facts when present", () => {
    const user = buildAssessmentPrompt({ ...base, techStack: stack }).user;
    expect(user).toContain("DETECTED TECH STACK");
    expect(user).toContain("TypeScript, Python");
    expect(user).toContain("Next.js, FastAPI");
    expect(user).toContain("backend: Python");
  });

  it("the system prompt is unchanged by the tech block (stays cacheable)", () => {
    expect(buildAssessmentPrompt({ ...base, techStack: stack }).system).toBe(buildAssessmentPrompt(base).system);
  });
});

describe("techStackPromptEnabled", () => {
  const original = process.env.TECH_STACK_PROMPT;
  afterEach(() => {
    if (original === undefined) delete process.env.TECH_STACK_PROMPT;
    else process.env.TECH_STACK_PROMPT = original;
  });
  it("defaults to ON when unset or empty", () => {
    delete process.env.TECH_STACK_PROMPT;
    expect(techStackPromptEnabled()).toBe(true);
    process.env.TECH_STACK_PROMPT = "";
    expect(techStackPromptEnabled()).toBe(true);
    process.env.TECH_STACK_PROMPT = "  ";
    expect(techStackPromptEnabled()).toBe(true);
  });
  it("guard: stays on for 1/true", () => {
    process.env.TECH_STACK_PROMPT = "1";
    expect(techStackPromptEnabled()).toBe(true);
    process.env.TECH_STACK_PROMPT = "true";
    expect(techStackPromptEnabled()).toBe(true);
  });
  it("the kill switch turns it off: 0 / false / off / no, any case", () => {
    for (const v of ["0", "false", "off", "no", " FALSE ", "Off"]) {
      process.env.TECH_STACK_PROMPT = v;
      expect(techStackPromptEnabled(), v).toBe(false);
    }
  });
});

// The default scan path: what buildScanScoreInput hands the prompt builder, driven on a corpus fixture.
async function scanUserPrompt(fixture: RubricFixture): Promise<{ user: string; sent: boolean }> {
  const phase = await buildScanScoreInput({
    snapshot: fixture.snapshot,
    prStats: fixture.prStats,
    governance: fixture.governance,
    securityPosture: fixture.securityPosture,
    securityExposure: fixture.securityExposure,
    now: RUBRIC_NOW,
  });
  return { user: buildAssessmentPrompt(phase.scoreInput).user, sent: phase.scoreInput.techStack !== undefined };
}

describe("buildScanScoreInput — the detected stack reaches the prompt by default", () => {
  const fullHouse = RUBRIC_CORPUS.find((f) => f.id === "full-house")!;
  afterEach(() => vi.unstubAllEnvs());

  it("unset env: the default scan prompt carries DETECTED TECH STACK", async () => {
    vi.stubEnv("TECH_STACK_PROMPT", "");
    const { user, sent } = await scanUserPrompt(fullHouse);
    expect(sent).toBe(true);
    expect(user).toContain("DETECTED TECH STACK");
    expect(user).toContain("- Languages: TypeScript");
  });

  it("TECH_STACK_PROMPT=0 restores the prompt without the block", async () => {
    vi.stubEnv("TECH_STACK_PROMPT", "0");
    const { user, sent } = await scanUserPrompt(fullHouse);
    expect(sent).toBe(false);
    expect(user).not.toContain("DETECTED TECH STACK");
  });

  it("guard: a stack with no language and no framework is not sent (an all-unknown block is noise)", async () => {
    vi.stubEnv("TECH_STACK_PROMPT", "");
    const bare = RUBRIC_CORPUS.find((f) => f.id === "bare")!;
    const blind = { ...bare, snapshot: { ...bare.snapshot, meta: { ...bare.snapshot.meta, primaryLanguage: null } } };
    const { user, sent } = await scanUserPrompt(blind);
    expect(sent).toBe(false);
    expect(user).not.toContain("DETECTED TECH STACK");
  });
});
