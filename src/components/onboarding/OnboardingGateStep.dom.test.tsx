// @vitest-environment jsdom
//
// The gate is the only sign-in affordance in the whole wizard, so two things are load-bearing: the
// CTA must exist for whichever auth backend the deployment runs, and its `next` must return the user
// TO THE WIZARD (/onboarding) — where the RESUME_KEY snapshot rebuilds their selection.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GateStep } from "./OnboardingGateStep";

describe("OnboardingGateStep", () => {
  it("offers a GitHub sign-in that returns to /onboarding, and promises the selection is kept", () => {
    render(
      <GateStep gate={{ kind: "signin", org: "vercel" }} auth="github" selectedCount={3} onBack={() => {}} />,
    );
    const cta = screen.getByRole("link", { name: /sign in with github/i });
    expect(cta.getAttribute("href")).toBe(`/api/auth/login?next=${encodeURIComponent("/onboarding")}`);
    expect(screen.getByText(/3/)).toBeInTheDocument();
    expect(document.body.textContent).toMatch(/bring you straight back/i);
  });

  it("explains a no-access refusal without quoting the API, and points at the App install", () => {
    render(
      <GateStep gate={{ kind: "no-access", org: "netflix" }} auth="supabase" selectedCount={2} onBack={() => {}} />,
    );
    expect(screen.getByRole("link", { name: /connect the github app/i })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Sign in to manage this organization/i);
    expect(document.body.textContent).toMatch(/isn't a member of/i);
  });

  it("says so plainly when no auth backend is configured instead of rendering a dead button", () => {
    render(<GateStep gate={{ kind: "signin", org: "vercel" }} auth={null} selectedCount={1} onBack={() => {}} />);
    expect(screen.queryByRole("link", { name: /sign in with github/i })).toBeNull();
    expect(document.body.textContent).toMatch(/isn't configured on this deployment/i);
  });

  it("hands the user back to their selection", () => {
    const onBack = vi.fn();
    render(<GateStep gate={{ kind: "signin", org: "vercel" }} auth="github" selectedCount={1} onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: /back to repositories/i }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
