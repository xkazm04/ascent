// @vitest-environment jsdom
//
// The "Drive it to green" band names two artifacts a reader can go and look at: the `.ai/` foundation
// PR and the public gate endpoint. Every identifier is IMPORTED from the module that owns it, and this
// test asserts against those imports, not typed copies: a test hard-coding "ascent/ai-foundation" would
// pass while the branch was renamed underneath it, which is the failure the imports exist to prevent.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FOUNDATION_BRANCH } from "@/lib/standard/types";
import { GATE_API_PATH, GATE_FAIL_STATUS, GATE_PASS_STATUS } from "@/lib/scoring/gate-api";
import { IndexLocal } from "./IndexLocal";

describe("IndexLocal: the iteration path names its artifacts", () => {
  it("names the .ai/ foundation PR by the branch the installer cuts", () => {
    render(<IndexLocal />);
    expect(screen.getByText(/foundation PR/i)).not.toBeNull();
    expect(screen.getByText(FOUNDATION_BRANCH)).not.toBeNull();
  });

  it("names the gate API by its path and its pass/fail statuses", () => {
    const { container } = render(<IndexLocal />);
    expect(screen.getByText(/the gate API/i)).not.toBeNull();
    expect(container.textContent).toContain(`GET ${GATE_API_PATH}/<owner>/<repo>`);
    expect(screen.getByText(String(GATE_PASS_STATUS))).not.toBeNull();
    expect(screen.getByText(String(GATE_FAIL_STATUS))).not.toBeNull();
  });

  it("does not claim the loop calls the gate: the rescan adjudicates a drive", () => {
    const { container } = render(<IndexLocal />);
    expect(container.textContent).toMatch(/adjudicated by its own rescan/i);
  });
});
