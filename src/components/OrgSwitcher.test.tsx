// @vitest-environment jsdom
//
// members-access-control #7: a failed org switch (POST /api/org/active rejected, or a network throw) used
// to be silently swallowed — the menu just closed and nothing changed, a dead click with no feedback. This
// pins that a rejected switch now surfaces a VISIBLE, announced (role="alert") error.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
  usePathname: () => "/usage",
}));

import { OrgSwitcher } from "./OrgSwitcher";

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("OrgSwitcher failed switch is visible", () => {
  it("surfaces an announced error when the switch is rejected", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));

    render(<OrgSwitcher orgs={["public", "acme"]} active="public" />);

    fireEvent.click(screen.getByRole("button", { name: /org/i }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /acme/i }));

    const alert = await waitFor(() => screen.getByRole("alert"));
    expect(alert.textContent).toContain("Couldn't switch to acme");
    // A rejected switch must not fake success by navigating.
    expect(push).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("clears a stale error banner when the menu is reopened", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    render(<OrgSwitcher orgs={["public", "acme"]} active="public" />);

    fireEvent.click(screen.getByRole("button", { name: /org/i }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /acme/i }));
    await waitFor(() => screen.getByRole("alert"));

    // Reopening the menu resets the failure banner.
    fireEvent.click(screen.getByRole("button", { name: /org/i }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
