// @vitest-environment jsdom
//
// moonshot #35 — the rollout panel's HONEST STATES (its two write doors are pinned in the sibling
// FoundationRolloutPanel.actions.dom.test.tsx, split off for the 200-LOC features cap), asserted on the
// Table, where each axis is a CellMark (a state + a word, so unknown stays visibly unknown):
//   • a never-reported repo shows "—", never "0%", and carries the `unmeasured` mark;
//   • an un-provisioned repo reads "Not provisioned", never "off";
//   • a repo Ascent opened no PR in is "No Ascent PR" (unmeasured), not counted as un-adopted;
//   • both `data-tour` anchors the getting-started checklist declares are actually stamped here.

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
  it("renders — (not 0%) for a never-reported repo, marked unmeasured rather than captioned", () => {
    render(<FoundationRolloutPanel slug="acme" rows={[row({ repo: "acme/app" })]} />);
    expect(screen.queryByText("0%")).toBeNull();
    const conformance = screen.getByRole("table", { name: /Foundation rollout by repository/ }).querySelectorAll("tbody tr")[0].querySelectorAll("td")[3];
    expect(conformance.querySelector('[data-role="cell-mark"]')?.getAttribute("data-state")).toBe("unmeasured");
    expect(conformance.querySelector("span[title]")?.getAttribute("title")).toMatch(/never a zero|absence, never a zero/i);
  });

  it("marks a repo Ascent never opened a PR in unmeasured — not 'zero adopted'", () => {
    render(<FoundationRolloutPanel slug="acme" rows={[row({ repo: "acme/app" })]} />);
    const pr = screen.getByRole("table", { name: /Foundation rollout by repository/ }).querySelectorAll("tbody tr")[0].querySelectorAll("td")[1];
    expect(pr.querySelector('[data-role="cell-mark"]')?.getAttribute("data-state")).toBe("unmeasured");
    expect(pr.textContent).toContain("No Ascent PR");
    // A repo with nothing reported prints no numeral at all.
    expect(screen.getByRole("table", { name: /Foundation rollout by repository/ }).querySelectorAll("tbody tr")[0].querySelectorAll("td")[3].querySelector(".tabular-nums")).toBeNull();
  });

  it("an opened DRAFT PR reads as declared, never as installed", () => {
    render(
      <FoundationRolloutPanel slug="acme" rows={[row({ repo: "acme/app", foundationPrAt: "2026-08-01T00:00:00.000Z" })]} />,
    );
    expect(screen.queryByText(/Installed/)).toBeNull();
    expect(screen.getAllByText(/PR opened/).length).toBeGreaterThan(0);
    expect(screen.getByRole("table", { name: /Foundation rollout by repository/ }).querySelectorAll("tbody tr")[0].querySelectorAll("td")[1].querySelector('[data-role="cell-mark"]')?.getAttribute("data-state")).toBe("partial");
  });

  it("prints a reported conformance beside its mark, where the state permits a value", () => {
    render(<FoundationRolloutPanel slug="acme" rows={[row({ repo: "acme/app", conformance: 82 })]} />);
    const conformance = screen.getByRole("table", { name: /Foundation rollout by repository/ }).querySelectorAll("tbody tr")[0].querySelectorAll("td")[3];
    expect(conformance.querySelector('[data-role="cell-mark"]')?.getAttribute("data-state")).not.toBe("unmeasured");
    expect(conformance.querySelector(".tabular-nums")?.textContent).toBe("82%");
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
