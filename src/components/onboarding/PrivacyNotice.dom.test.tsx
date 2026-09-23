// @vitest-environment jsdom
//
// Pins connect-repo-selection #1 (ambiguity-ui-scan-2026-07-16): the trust-critical "Where your
// code goes" disclosure must state the REAL ingest budget. It previously hand-coded "≤32 files"
// while the actual budget was MAX_FILES=50 (+ a reserved workflow quota) — an underclaiming
// privacy notice. The copy now interpolates MAX_FILES itself, so this test fails if the number
// is ever hand-copied again and drifts from the constant.
//
// It also pins WHERE the notice learns the `auto` destination: from the provider registry's one auto
// ladder (autoProviderName), not from a third hand-kept copy of it.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MAX_FILES } from "@/lib/github/source";
import { autoProviderName } from "@/lib/llm/registry";
import { ScanPrivacyNotice } from "./PrivacyNotice";

const H = vi.hoisted(() => ({ choice: "gemini", key: true }));
vi.mock("@/lib/llm", () => ({
  resolveProviderChoice: () => H.choice,
  hasLlmKey: () => H.key,
}));
// The REAL registry, with its ladder wrapped in a spy so the test can see it is the one consulted.
vi.mock("@/lib/llm/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm/registry")>();
  return { ...actual, autoProviderName: vi.fn(actual.autoProviderName) };
});

describe("ScanPrivacyNotice — file-budget disclosure", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    H.choice = "gemini";
    H.key = true;
  });

  it("states the real MAX_FILES budget, derived from the source constant", () => {
    render(<ScanPrivacyNotice />);
    const copy = screen.getByText(/budgeted sample/i).textContent ?? "";
    expect(copy).toContain(`≤${MAX_FILES} files`);
    // The reserved workflow quota exceeds MAX_FILES, so the disclosure must not present
    // the number as the total ceiling.
    expect(copy).toMatch(/plus CI workflow files/i);
    // Guard against the stale hand-copied figure reappearing.
    expect(copy).not.toContain("32 files");
  });

  it("`auto` with local knobs states the local destination, read through the registry's ladder", () => {
    H.choice = "auto";
    H.key = false;
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GOOGLE_API_KEY", "");
    vi.stubEnv("LOCAL_LLM_BASE_URL", "http://localhost:11434/v1");
    vi.stubEnv("LOCAL_LLM_MODEL", "qwen2.5-coder:14b");
    render(<ScanPrivacyNotice />);
    const copy = screen.getByText(/budgeted sample/i).textContent ?? "";
    expect(copy).toContain("your own LLM server at LOCAL_LLM_BASE_URL");
    expect(autoProviderName).toHaveBeenCalled();
  });

  it("guard: an explicit keyless gemini selection still discloses mock", () => {
    H.choice = "gemini";
    H.key = false;
    render(<ScanPrivacyNotice />);
    expect(screen.getByText(/budgeted sample/i).textContent).toContain("nowhere: scoring is fully local");
    expect(screen.getByText(/Active inference provider/).textContent).toContain("mock");
  });
});
