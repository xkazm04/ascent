// @vitest-environment jsdom

// The empty stance is one statement. The second sentence is the lede, not a second headline.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { StanceEmpty } from "./StanceEmpty";
import { StanceFrame } from "./StanceFrame";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/db", () => ({
  isDbConfigured: () => true,
  getActiveOrgStance: async () => null,
  getDraftOrgStance: async () => null,
}));
vi.mock("@/lib/org/stance-overview", () => ({ buildStanceOverview: async () => null }));

describe("StanceEmpty", () => {
  it("keeps a single headline and puts the second sentence in the lede", () => {
    render(<StanceEmpty slug="kiro" canEdit />);
    const headings = screen.getAllByRole("heading");
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe("There is no line.");
    expect(screen.getByText(/Every repo is treated the same by every agent/)).toBeTruthy();
    expect(screen.getByText("Checkpoint")).toBeTruthy();
    expect(screen.getByText(/publish v1/)).toBeTruthy();
  });

  it("does not stack a second statement above the empty frame", async () => {
    render(await StanceFrame({ slug: "kiro", canEdit: false }));
    const headings = screen.getAllByRole("heading");
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe("There is no line.");
    expect(screen.queryByRole("heading", { name: /Declared policy/ })).toBeNull();
  });
});
