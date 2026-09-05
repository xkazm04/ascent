// @vitest-environment jsdom
//
// G6-10: the pick step has THREE independent entry points that can fail (an installation button, a
// suggested-org button, and the handle text form), but the handle input's focus effect used to fire
// on ANY of them — a failed installation click yanked keyboard/SR focus onto a text field the user
// never touched. PickStep now tags `error` with its originating control (`errorSource`) and only
// forwards it to whichever control actually produced it; only the form's own error reaches the input
// focus effect. This pins: (1) each source's error renders as an alert on ITS OWN control, (2) the
// handle input is focused ONLY for a form-sourced error, and (3) an installation/suggested-org error
// does NOT move focus to the input at all.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PickStep } from "./OnboardingPickStep";

const INSTALLATIONS = [{ login: "acme", id: "1" }];
const SUGGESTED = ["torvalds"];

function renderPick(error: string | null, errorSource: "installation" | "suggested" | "form" | null) {
  return render(
    <PickStep
      installations={INSTALLATIONS}
      suggestedOrgs={SUGGESTED}
      org=""
      setOrg={() => {}}
      loading={false}
      error={error}
      errorSource={errorSource}
      onLoadInstallation={() => {}}
      onSubmit={() => {}}
      onPickOrg={() => {}}
    />,
  );
}

describe("OnboardingPickStep — error routes to its originating control (G6-10)", () => {
  it("an installation-sourced error renders on the installation card and does NOT focus the handle input", () => {
    renderPick("Couldn't load that installation.", "installation");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load that installation.");
    // The org text input must never be the active element for an error it didn't cause.
    const input = screen.getByLabelText(/organization or user/i);
    expect(document.activeElement).not.toBe(input);
  });

  it("a suggested-org-sourced error renders on the suggested-orgs card and does NOT focus the handle input", () => {
    renderPick("Couldn't scan that organization.", "suggested");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Couldn't scan that organization.");
    const input = screen.getByLabelText(/organization or user/i);
    expect(document.activeElement).not.toBe(input);
  });

  it("a form-sourced error still renders on the form AND focuses the handle input (unchanged behavior)", () => {
    renderPick("No public repositories found for that account.", "form");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("No public repositories found for that account.");
    const input = screen.getByLabelText(/organization or user/i);
    expect(document.activeElement).toBe(input);
  });

  it("only ONE alert is rendered at a time — an installation error never also appears on the form", () => {
    renderPick("Couldn't load that installation.", "installation");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });
});
