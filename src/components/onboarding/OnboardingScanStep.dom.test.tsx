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

// Direction 9 — the wizard never stated a duration, and every unsettled row said "scanning…", so a
// six-repo live run looked like six stalled scans with no end in sight. That is the seam that makes
// people refresh, and refreshing is how runs used to get duplicated.
describe("OnboardingScanStep time expectation + in-flight rows (Direction 9)", () => {
  const rowsFor = (names: string[]) =>
    Object.fromEntries(names.map((repo) => [repo, { repo }])) as Record<string, { repo: string }>;

  const scanning = {
    phase: "scanning" as const,
    rows: rowsFor(["a/one", "a/two", "a/three", "a/four", "a/five", "a/six"]),
    error: null,
    announce: "",
    onCancel: noop,
    onViewDashboard: noop,
    onScanAnother: noop,
  };

  it("states a ceiling for a live run, scaled by the route's real concurrency (not serial)", () => {
    render(<ScanStep {...scanning} preview={false} />);
    // 6 repos over 4 lanes = 2 waves x the slowest-provider estimate. Serial would have said 36 min.
    expect(screen.getByText(/Up to about 12 minutes for 6 repositories, 4 at a time\./)).toBeInTheDocument();
  });

  it("states the fast, honest number for a mock preview run", () => {
    render(<ScanStep {...scanning} preview />);
    expect(screen.getByText(/Usually under 2 minutes for 6 repositories, 4 at a time./)).toBeInTheDocument();
    expect(screen.queryByText(/Up to about/)).toBeNull();
  });

  it("hides the expectation on the reconnected surface and on the done screen", () => {
    const { unmount } = render(
      <ScanStep {...scanning} preview={false} reattach={{ status: "polling", pending: 3, total: 6 }} />,
    );
    expect(document.querySelector("[data-scan-expectation]")).toBeNull();
    // The reconnected notice is the one that owns this state.
    expect(screen.getByText(/Reconnected/)).toBeInTheDocument();
    unmount();

    render(<ScanStep {...scanning} phase="done" preview={false} />);
    expect(document.querySelector("[data-scan-expectation]")).toBeNull();
  });

  it("distinguishes the rows in a scan lane from the ones still queued", () => {
    render(<ScanStep {...scanning} preview={false} />);
    // SCAN_CONCURRENCY (4) lanes: the first four unsettled rows are in flight, the rest are waiting.
    expect(screen.getAllByText("scanning now")).toHaveLength(4);
    expect(screen.getAllByText("queued")).toHaveLength(2);
    // The old undivided label is gone for a streamed run.
    expect(screen.queryByText("scanning…")).toBeNull();
  });

  it("keeps the live indicator out of a reduced-motion session", () => {
    const { container } = render(<ScanStep {...scanning} preview={false} />);
    const dots = container.querySelectorAll("span.bg-accent.rounded-full");
    expect(dots.length).toBeGreaterThan(0);
    for (const dot of dots) {
      expect(dot.className).toContain("motion-safe:animate-pulse");
      expect(dot.className).not.toMatch(/(^|\s)animate-pulse/);
    }
  });

  it("does not claim an ordering for a RE-ATTACHED run, whose poll gives none", () => {
    render(<ScanStep {...scanning} preview={false} reattach={{ status: "polling", pending: 6, total: 6 }} />);
    expect(screen.queryByText("queued")).toBeNull();
    expect(screen.queryByText("scanning now")).toBeNull();
    expect(screen.getAllByText("scanning…")).toHaveLength(6);
  });

  it("leaves the progress bar's a11y posture untouched", () => {
    render(<ScanStep {...scanning} preview={false} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "0");
    expect(bar).toHaveAttribute("aria-label", "Scan progress: 0 of 6 repositories");
  });
});
