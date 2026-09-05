// Option B (Feature 3a) — gated tech-stack prompt enrichment. The block is keyed on whether
// LlmScoreInput carries `techStack` (scan.ts only sets it when TECH_STACK_PROMPT is on). These tests
// drive buildAssessmentPrompt directly to pin: absent techStack → the user message is byte-identical to
// the no-tech prompt (zero calibration risk); present techStack → a DETECTED TECH STACK block appears
// with the stack facts. Plus the env-flag helper.

import { describe, it, expect, afterEach } from "vitest";
import { buildAssessmentPrompt } from "@/lib/scoring/prompt";
import { techStackPromptEnabled } from "@/lib/llm/config";
import type { LlmScoreInput } from "@/lib/llm/provider";
import type { TechStack } from "@/lib/types";

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
  it("defaults to off; on for 1/true", () => {
    delete process.env.TECH_STACK_PROMPT;
    expect(techStackPromptEnabled()).toBe(false);
    process.env.TECH_STACK_PROMPT = "1";
    expect(techStackPromptEnabled()).toBe(true);
    process.env.TECH_STACK_PROMPT = "true";
    expect(techStackPromptEnabled()).toBe(true);
    process.env.TECH_STACK_PROMPT = "no";
    expect(techStackPromptEnabled()).toBe(false);
  });
});
