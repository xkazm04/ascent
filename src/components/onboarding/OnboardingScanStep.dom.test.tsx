// @vitest-environment jsdom
//
// The invite-teammate failure must be ANNOUNCED (role="alert") and use the shared danger token, not a
// one-off orange that diverges from every other error surface in the wizard. A screen-reader user who
// mistypes a handle otherwise gets no feedback that the invite failed.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ScanStep } from "./OnboardingScanStep";

afterEach(() => vi.restoreAllMocks());

const noop = () => {};

describe("OnboardingScanStep preview banner cause (first-run-onboarding-wizard 2026-07-16 #1)", () => {
  const base = {
    phase: "done" as const,
    rows: {},
    error: null,
    announce: "",
    onCancel: noop,
    onViewDashboard: noop,
    onScanAnother: noop,
  };

  it("explains a credit-read failure honestly — no charge, retry — instead of 'install the GitHub App'", () => {
    // A transient /api/org/credits failure fail-closes to a preview; the old banner told an
    // App-installed, credit-holding org to "install the GitHub App" — a misdiagnosis with no retry hint.
    render(<ScanStep {...base} preview previewCause="credit_unknown" />);
    const banner = screen.getByText(/couldn't verify your credit balance/i);
    expect(banner.textContent).toMatch(/no credits were\s+used/i);
    expect(banner.textContent).toMatch(/retry/i);
    expect(banner.textContent).not.toMatch(/install the GitHub App/i);
  });

  it("keeps the standard preview copy when the preview was NOT caused by a failed credit read", () => {
    render(<ScanStep {...base} preview />);
    expect(screen.getByText(/install the GitHub App/i)).toBeInTheDocument();
    expect(screen.queryByText(/couldn't verify your credit balance/i)).toBeNull();
  });

  it("shows the live-upgrade handoff (W6b preview-then-upgrade) instead of the install/top-up recovery", () => {
    render(<ScanStep {...base} preview upgradePlanned />);
    const banner = screen.getByText(/live scan is queued/i).closest("p")!;
    expect(banner.textContent).toMatch(/preview/i);
    expect(banner.textContent).not.toMatch(/install the GitHub App/i);
    // The primary CTA carries the handoff — the live scan starts on the dashboard.
    expect(screen.getByRole("button", { name: /open dashboard \(live scan starts there\)/i })).toBeInTheDocument();
  });
});

describe("OnboardingScanStep invite error (announced + danger token)", () => {
  it("renders the invite failure in an alert region so it is announced", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Couldn't add that teammate." }) }),
    );

    render(
      <ScanStep
        phase="done"
        rows={{}}
        error={null}
        announce=""
        onCancel={noop}
        onViewDashboard={noop}
        onScanAnother={noop}
        inviteOrg="acme"
      />,
    );

    fireEvent.change(screen.getByLabelText("Teammate's GitHub handle"), { target: { value: "octocat" } });
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));

    const alert = await waitFor(() => screen.getByRole("alert"));
    expect(alert.textContent).toContain("Couldn't add that teammate.");
    // Uses the shared danger token, not the divergent orange.
    expect(alert.className).toContain("text-danger-soft");
    expect(alert.className).not.toContain("text-orange-300");

    // ambiguity-ui #5: the invite input must follow PickForm's error contract — programmatic
    // association (aria-invalid + aria-describedby → the alert's id) and focus returned to the
    // input, so SR/keyboard users tabbing back hear the failure instead of nothing.
    const input = screen.getByLabelText("Teammate's GitHub handle");
    expect(alert.id).toBe("invite-error");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "invite-error");
    await waitFor(() => expect(document.activeElement).toBe(input));
    // And the shared focus-ring treatment, like every other control in the wizard.
    expect(input.className).toContain("focus-ring");
    expect(screen.getByRole("button", { name: "Invite" }).className).toContain("focus-ring");
  });
});
