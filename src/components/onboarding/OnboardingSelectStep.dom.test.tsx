// @vitest-environment jsdom
//
// first-run-onboarding-wizard #6: the primary "Scan" CTA is disabled when nothing is selected, but it used
// to give NO reason — the user was left staring at a dead button. This pins that the disabled state now
// explains WHY (title tooltip + an aria-describedby'd visible hint), and that the reason disappears once a
// repo is selected and the button becomes actionable.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SelectStep } from "./OnboardingSelectStep";
import type { OrgRepo } from "./types";

const noop = () => {};
const REPOS: OrgRepo[] = [
  { fullName: "acme/api", private: false, language: "TypeScript", stars: 12, pushedAt: null },
  { fullName: "acme/web", private: true, language: "TypeScript", stars: 4, pushedAt: null },
];

function renderStep(selected: Set<string>) {
  return render(
    <SelectStep
      repos={REPOS}
      selected={selected}
      loading={false}
      sourceLabel=""
      sourceInstallId={null}
      credit={null}
      maxSelect={10}
      onToggle={noop}
      onSelectTop={noop}
      onClear={noop}
      onScan={noop}
      onBack={noop}
    />,
  );
}

describe("Onboarding Scan button surfaces its disabled reason", () => {
  it("explains why Scan is disabled when nothing is selected", () => {
    renderStep(new Set());
    const scan = screen.getByRole("button", { name: /^Scan 0 repos$/ });
    expect(scan).toBeDisabled();
    // Reason exposed to mouse (title) AND to keyboard/SR users (aria-describedby → visible hint).
    expect(scan).toHaveAttribute("title", "Select at least one repository above to scan");
    expect(scan).toHaveAttribute("aria-describedby", "scan-disabled-reason");
    const hint = document.getElementById("scan-disabled-reason");
    expect(hint?.textContent).toContain("Select at least one repository");
  });

  it("drops the reason and enables Scan once a repo is selected", () => {
    renderStep(new Set(["acme/api"]));
    const scan = screen.getByRole("button", { name: /^Scan 1 repo$/ });
    expect(scan).not.toBeDisabled();
    expect(scan).not.toHaveAttribute("title");
    expect(scan).not.toHaveAttribute("aria-describedby");
    expect(document.getElementById("scan-disabled-reason")).toBeNull();
  });
});
