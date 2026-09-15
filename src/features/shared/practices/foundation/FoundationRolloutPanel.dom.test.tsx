// @vitest-environment jsdom
//
// moonshot #35 — the rollout panel's HONEST STATES (its two write doors are pinned in the sibling
// FoundationRolloutPanel.actions.dom.test.tsx, split off for the 200-LOC features cap):
//   • a never-reported repo shows "—", never "0%", and carries the `missing` void mark;
//   • an un-provisioned repo reads "Not provisioned", never "off";
//   • a repo Ascent opened no PR in is hatched, not counted as un-adopted;
//   • both `data-tour` anchors the getting-started checklist declares are actually stamped here.
//
// /org redesign (docs/ORG-UX-REDESIGN.md §2): the legend PARAGRAPH that used to carry the two
// absence caveats is gone, so the assertions below now pin the ENCODING that replaced it — the kit's
// state marks, whose `rendersValue` is false and which therefore cannot print a number at all.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { FoundationRolloutPanel } from "./FoundationRolloutPanel";
import type { FoundationRolloutRow } from "@/lib/db/org-foundation";

const row = (over: Partial<FoundationRolloutRow> & { repo: string }): FoundationRolloutRow => ({
  foundationPrAt: null,
  reportBackAt: null,
  conformance: null,
  conformanceAt: null,
  ...over,
});

afterEach(() => vi.restoreAllMocks());
beforeEach(() => vi.clearAllMocks());

describe("honest empties", () => {
  it("renders — (not 0%) for a never-reported repo, marked as a void rather than captioned", () => {
    render(<FoundationRolloutPanel slug="acme" rows={[row({ repo: "acme/app" })]} />);
    const cells = screen.getAllByRole("cell");
    expect(cells.some((c) => c.textContent?.trim() === "—")).toBe(true);
    expect(screen.queryByText("0%")).toBeNull();
    // The demoted caveat, encoded: the void's own accessible name carries "never a zero".
    expect(screen.getAllByLabelText(/No measurement/).length).toBeGreaterThan(0);
  });

  it("hatches a repo Ascent never opened a PR in — not-judged, not 'zero adopted'", () => {
    render(<FoundationRolloutPanel slug="acme" rows={[row({ repo: "acme/app" })]} />);
    // The grid cell and the table cell speak the same vocabulary.
    expect(screen.getAllByLabelText(/Not judged/).length).toBeGreaterThan(0);
    const grid = screen.getByRole("img", { name: /Foundation rollout by repository/ });
    expect(grid.querySelector('[data-cell="acme/app:PR"]')?.getAttribute("data-state")).toBe("not-judged");
    // A hatched or void cell can never carry a numeral (rendersValue === false).
    expect(grid.querySelectorAll("[data-score]").length).toBe(0);
  });

  it("an opened DRAFT PR reads as declared, never as installed", () => {
    render(
      <FoundationRolloutPanel slug="acme" rows={[row({ repo: "acme/app", foundationPrAt: "2026-08-01T00:00:00.000Z" })]} />,
    );
    expect(screen.queryByText(/Installed/)).toBeNull();
    expect(screen.getAllByText(/PR opened/).length).toBeGreaterThan(0);
    const grid = screen.getByRole("img", { name: /Foundation rollout by repository/ });
    expect(grid.querySelector('[data-cell="acme/app:PR"]')?.getAttribute("data-state")).toBe("declared");
  });

  it("prints a reported conformance in the grid, where the state permits a value", () => {
    render(<FoundationRolloutPanel slug="acme" rows={[row({ repo: "acme/app", conformance: 82 })]} />);
    const grid = screen.getByRole("img", { name: /Foundation rollout by repository/ });
    expect(grid.querySelector('[data-cell="acme/app:Conformance"]')?.getAttribute("data-state")).toBe("measured");
    expect(grid.querySelector("[data-score]")?.textContent).toBe("82");
  });

  it("a genuine 0% report renders as 0%, not as —", () => {
    render(
      <FoundationRolloutPanel slug="acme" rows={[row({ repo: "acme/app", conformance: 0, conformanceAt: "2026-08-01T00:00:00.000Z" })]} />,
    );
    expect(screen.getByText("0%")).toBeTruthy();
  });

  it("reads 'Not provisioned' / 'No Ascent PR' rather than leaving the cells blank", () => {
    render(<FoundationRolloutPanel slug="acme" rows={[row({ repo: "acme/app" })]} />);
    const cells = screen.getAllByRole("cell").map((c) => c.textContent);
    expect(cells.some((t) => t?.includes("Not provisioned"))).toBe(true);
    expect(cells.some((t) => t?.includes("No Ascent PR"))).toBe(true);
  });

  it("renders nothing at all when the org has no repos", () => {
    const { container } = render(<FoundationRolloutPanel slug="acme" rows={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("tour anchors", () => {
  it("stamps both anchors the getting-started checklist declares", () => {
    const { container } = render(<FoundationRolloutPanel slug="acme" rows={[row({ repo: "acme/app" })]} />);
    expect(container.querySelector('[data-tour="foundation-rollout"]')).toBeTruthy();
    expect(container.querySelector('[data-tour="conformance-reported"]')).toBeTruthy();
  });
});
