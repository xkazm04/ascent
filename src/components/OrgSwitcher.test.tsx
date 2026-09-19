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

// ambiguity-ui 2026-07-16 #4: the trigger declares aria-haspopup="menu" and the popup
// role="menu"/"menuitemradio", which promises AT users the ARIA menu keyboard contract: focus moves
// into the menu on open (onto the checked item), ArrowUp/ArrowDown roam with wrap, Home/End jump,
// and Escape closes AND restores focus to the trigger. These previously shipped as roles-only.
describe("OrgSwitcher menu keyboard contract", () => {
  function openMenu() {
    render(<OrgSwitcher orgs={["public", "acme", "globex"]} active="acme" />);
    fireEvent.click(screen.getByRole("button", { name: /org/i }));
    return screen.getAllByRole("menuitemradio");
  }

  it("moves focus onto the checked item when the menu opens", async () => {
    const items = openMenu();
    const checked = items.find((el) => el.getAttribute("aria-checked") === "true")!;
    await waitFor(() => expect(checked).toHaveFocus());
  });

  it("ArrowDown/ArrowUp roam (with wrap) and Home/End jump", async () => {
    const items = openMenu();
    const menu = screen.getByRole("menu");
    await waitFor(() => expect(items[1]).toHaveFocus()); // "acme" is checked
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(items[2]).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" }); // wraps
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowUp" }); // wraps back
    expect(items[2]).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Home" });
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(menu, { key: "End" });
    expect(items[2]).toHaveFocus();
  });

  it("Escape closes the menu and restores focus to the trigger", async () => {
    openMenu();
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: /org/i })).toHaveFocus());
  });

  it("Tab closes the menu instead of leaving it visually open while focus walks away", () => {
    openMenu();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Tab" });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
