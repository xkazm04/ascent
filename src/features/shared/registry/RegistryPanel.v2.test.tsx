// @vitest-environment jsdom
// States the seeded org does not show: the connect form, a fault, hosted marks, a blocked viewer.

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

import { fixtureRegistryView } from "@/lib/org/registry-view.fixture";
import { RegistryPanelV2 } from "./RegistryPanel.v2";

function draw(demo: string) {
  return render(<RegistryPanelV2 view={fixtureRegistryView("acme", demo)!} slug="acme" />);
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("RegistryPanelV2", () => {
  it("offers setup on an unmapped registry and does not count artifacts", () => {
    draw("unmapped");
    expect(screen.getByTestId("setup-mode")).toBeTruthy();
    expect(screen.queryByText("Artifact counts")).toBeNull();
  });

  it("draws the ladder for an indexed registry without status hues", () => {
    const { container } = draw("indexed");
    expect(container.querySelector("[data-kit='ladder']")).toBeTruthy();
    expect(screen.queryByTestId("setup-mode")).toBeNull();
    expect(container.innerHTML).not.toMatch(/text-warn|text-emerald|text-amber|text-rose/);
  });

  it("says an index fault once, as an alert", () => {
    draw("error");
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.textContent).toMatch(/frontmatter missing/);
  });

  it("marks hosted migration as hosted, not a score", () => {
    draw("hosted");
    expect(screen.getAllByText("hosted")).toHaveLength(3);
  });

  it("withholds create when the viewer cannot write", () => {
    draw("no-permission");
    expect(screen.getByText(/You are reading this registry/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Create / })).toBeNull();
  });

  it("names each migration state", () => {
    draw("migrating");
    expect(screen.getByText("merged")).toBeTruthy();
    expect(screen.getByText("PR open")).toBeTruthy();
    expect(screen.getByText("not started")).toBeTruthy();
  });

  it("opens a step in place", async () => {
    draw("indexed");
    fireEvent.click(screen.getByRole("button", { name: /Choose the registry/ }));
    await waitFor(() => expect(screen.getByRole("navigation", { name: "Level" })).toBeTruthy());
    expect(window.location.hash).toBe("#step-choose");
  });
});
