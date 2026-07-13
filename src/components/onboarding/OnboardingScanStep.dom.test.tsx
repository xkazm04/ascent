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
        checklistSteps={[]}
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
  });
});
