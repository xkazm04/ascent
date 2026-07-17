// @vitest-environment jsdom
//
// Pins connect-repo-selection #1 (ambiguity-ui-scan-2026-07-16): the trust-critical "Where your
// code goes" disclosure must state the REAL ingest budget. It previously hand-coded "≤32 files"
// while the actual budget was MAX_FILES=50 (+ a reserved workflow quota) — an underclaiming
// privacy notice. The copy now interpolates MAX_FILES itself, so this test fails if the number
// is ever hand-copied again and drifts from the constant.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MAX_FILES } from "@/lib/github/source";
import { ConnectPrivacyNotice } from "./PrivacyNotice";

vi.mock("@/lib/llm", () => ({
  resolveProviderChoice: () => "gemini",
  hasLlmKey: () => true,
}));

describe("ConnectPrivacyNotice — file-budget disclosure", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("states the real MAX_FILES budget, derived from the source constant", () => {
    render(<ConnectPrivacyNotice />);
    const copy = screen.getByText(/budgeted sample/i).textContent ?? "";
    expect(copy).toContain(`≤${MAX_FILES} files`);
    // The reserved workflow quota exceeds MAX_FILES, so the disclosure must not present
    // the number as the total ceiling.
    expect(copy).toMatch(/plus CI workflow files/i);
    // Guard against the stale hand-copied figure reappearing.
    expect(copy).not.toContain("32 files");
  });
});
