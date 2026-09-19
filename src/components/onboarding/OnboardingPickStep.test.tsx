// @vitest-environment jsdom
//
// Pins first-run-onboarding-wizard #3: the Pick step (step 1) must carry a `data-step-heading` focus
// target like the Select and Scan steps, so returning to step 1 (Back / Scan another) lands focus on
// the step heading instead of dropping it to <body> for keyboard/SR users. useOnboardingFlow focuses
// `[data-step-heading]` on every phase change; without one here that focus call was a silent no-op.

import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { DEMO_ORG_SLUG } from "@/lib/site";
import { PickStep, pickTryChips } from "./OnboardingPickStep";

function renderPick() {
  return render(
    <PickStep
      installations={[]}
      suggestedOrgs={[]}
      org=""
      setOrg={() => {}}
      loading={false}
      error={null}
      onLoadInstallation={() => {}}
      onSubmit={() => {}}
      onPickOrg={() => {}}
    />,
  );
}

describe("OnboardingPickStep step-heading focus target (ONB #3)", () => {
  it("renders a focusable [data-step-heading], matching the other steps", () => {
    const { container } = renderPick();
    const heading = container.querySelector<HTMLElement>("[data-step-heading]");
    expect(heading).not.toBeNull();
    // h2, not h1: the page-level h1 lives in onboarding/page.tsx — a step-level h1 put two h1s in
    // the document at once (ambiguity-ui-scan-2026-07-16 first-run-onboarding-wizard #4).
    expect(heading!.tagName).toBe("H2");
    expect(heading).toHaveAttribute("tabindex", "-1");
    expect(heading).toHaveTextContent("Choose a source");
  });

  it("actually accepts focus when the flow moves focus to it on a step change", () => {
    const { container } = renderPick();
    const heading = container.querySelector<HTMLElement>("[data-step-heading]")!;
    heading.focus();
    expect(document.activeElement).toBe(heading);
  });
});

describe("OnboardingPickStep try-chips follow DEMO_ORG_SLUG", () => {
  it("leads with the demo slug and fills two distinct well-known publics", () => {
    expect(pickTryChips(DEMO_ORG_SLUG)[0]).toBe(DEMO_ORG_SLUG);
    expect(pickTryChips("vercel")).toEqual(["vercel", "anthropics", "openai"]);
    expect(pickTryChips("anthropics")).toEqual(["anthropics", "vercel", "openai"]);
    expect(pickTryChips("openai")).toEqual(["openai", "vercel", "anthropics"]);
    expect(pickTryChips("acme")).toEqual(["acme", "vercel", "anthropics"]);
  });

  it("renders those chips in order on the pick form", () => {
    renderPick();
    const expected = pickTryChips(DEMO_ORG_SLUG);
    const tryRow = screen.getByText("try:").closest("div");
    expect(tryRow).not.toBeNull();
    const chips = within(tryRow!).getAllByRole("button").map((b) => b.textContent);
    expect(chips[0]).toBe(DEMO_ORG_SLUG);
    expect(chips).toEqual(expected);
  });
});
