// @vitest-environment jsdom
//
// getOrgRollup counts a repo last scanned before the window start in the fleet average;
// getOrgMovers does not. ScopeFilterBar is the disclosure: the caption must appear when a
// period window is active and must not appear for all-time. Queries are unchanged; this
// pins the copy that matches the org-rollup.ts header.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ROLLUP_MOVERS_CAPTION, ScopeFilterBar } from "./ScopeFilterBar";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/org/acme",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const empty = {
  segments: [] as { id: string; name: string; color: string; repoCount: number }[],
  segmentId: null,
  techGroups: [] as { key: string; label: string; repoCount: number }[],
  activeStack: null,
};

const segments = [{ id: "s1", name: "Platform", color: "#3b9eff", repoCount: 4 }];

describe("ScopeFilterBar — rollup vs movers caption", () => {
  it("names the org-rollup header split when a window is active", () => {
    render(<ScopeFilterBar {...empty} window={{ start: new Date("2026-01-01T00:00:00Z") }} />);
    const note = screen.getByRole("note");
    expect(note).toHaveAttribute("data-testid", "rollup-movers-caption");
    expect(note.textContent).toBe(ROLLUP_MOVERS_CAPTION);
    expect(note.textContent).toMatch(/still count in the fleet average/);
    expect(note.textContent).toMatch(/do not appear in movers/);
  });

  it("omits the caption for all-time (start is null) — there is no in-period split", () => {
    render(<ScopeFilterBar {...empty} window={{ start: null }} segments={segments} />);
    expect(screen.queryByTestId("rollup-movers-caption")).toBeNull();
  });

  it("omits the caption when no window is passed", () => {
    render(<ScopeFilterBar {...empty} segments={segments} />);
    expect(screen.queryByTestId("rollup-movers-caption")).toBeNull();
  });

  it("still gates the bar away when nothing would render and the window is inactive", () => {
    const { container } = render(<ScopeFilterBar {...empty} window={{ start: null }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps the caption under the selectors when both a window and a filter are active", () => {
    render(<ScopeFilterBar {...empty} segments={segments} window={{ start: new Date("2026-03-01T00:00:00Z") }} />);
    expect(screen.getByRole("note").textContent).toBe(ROLLUP_MOVERS_CAPTION);
    expect(screen.getByRole("button", { name: /Platform/ })).toBeInTheDocument();
  });
});
