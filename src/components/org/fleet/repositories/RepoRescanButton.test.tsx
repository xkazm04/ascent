// @vitest-environment jsdom
//
// ambiguity-ui 2026-07-16 #5: the leaderboard's disabled controls explained WHY only via `title` on
// a natively-disabled element — removed from the tab order and hover-only, so keyboard/SR users got
// a dead control with no reason. The control now stays focusable (aria-disabled + click guard) and
// exposes the reason through aria-describedby; outcomes are announced (role=alert/status).

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RepoRescanButton } from "./RepoRescanButton";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RepoRescanButton disabled-state accessibility", () => {
  it("a disabled control stays focusable, announces its reason, and never fires the request", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(
      <RepoRescanButton org="acme" fullName="acme/web" disabled disabledHint="GitHub App isn't configured, so the route would 503." />,
    );

    const btn = screen.getByRole("button", { name: "Rescan acme/web" });
    expect(btn).not.toBeDisabled(); // still in the tab order
    expect(btn).toHaveAttribute("aria-disabled", "true");
    // The reason is programmatically associated, not hover-only.
    expect(btn).toHaveAccessibleDescription("GitHub App isn't configured, so the route would 503.");

    fireEvent.click(btn); // guarded no-op
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("announces a failed rescan as an alert", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, body: null, json: async () => ({ error: "boom" }) }),
    );
    render(<RepoRescanButton org="acme" fullName="acme/web" />);
    fireEvent.click(screen.getByRole("button", { name: "Rescan acme/web" }));
    const alert = await waitFor(() => screen.getByRole("alert"));
    expect(alert.textContent).toContain("boom");
  });
});
