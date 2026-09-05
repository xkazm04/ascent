// @vitest-environment jsdom
//
// The Impact Ledger's honesty rules, pinned at the RENDER layer.
//
// org-impact.test.ts already pins the model (null-not-zero, verified-only, sign-aware). These are the
// assertions that matter to a reader: that the panel actually SHOWS an em dash instead of a confident
// zero, that "awaiting rescan" is stated rather than dropped, and that a regression appears with its
// sign instead of being absorbed into a positive headline. A model that is right and a panel that
// rounds it off is the failure mode this file exists to prevent.

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ImpactLedger } from "./ImpactLedger";
import { buildImpactLedger, type ImpactPrInput } from "@/lib/db/org-impact";

const pr = (over: Partial<ImpactPrInput> = {}): ImpactPrInput => ({
  repoFullName: "acme/web",
  dimId: "D1",
  practiceId: "agent-guidance",
  prNumber: 1,
  prUrl: "https://github.com/acme/web/pull/1",
  mergedAt: new Date("2026-08-01T00:00:00Z"),
  impactDim: 6,
  impactOverall: 2,
  verifiedScanId: "scan_1",
  ...over,
});

const draw = (prs: ImpactPrInput[]) =>
  render(<ImpactLedger slug="acme" ledger={buildImpactLedger(prs)} periodTitle="Last 90 days" />);

/**
 * The tile whose label is `label`, so an assertion can't accidentally match a neighbouring number.
 * `Tile` renders `<div class="bg-ink …"><Stat/></div>`, and Stat's label is a nested div — so scope
 * to the tile wrapper, not to the label's own element.
 */
function tile(label: string): HTMLElement {
  const node = screen.getByText(label).closest("div.bg-ink");
  if (!node) throw new Error(`no tile for ${label}`);
  return node as HTMLElement;
}

describe("ImpactLedger", () => {
  it("renders an empty state that points at the loop, not a wall of zeroes", () => {
    draw([]);
    expect(screen.getByText(/No improvement PRs merged/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Live" }).getAttribute("href")).toBe("/org/acme?tab=live");
    // The tiles must not render at all — "0 points bought" is a claim the data does not support.
    expect(screen.queryByText("Points bought")).toBeNull();
  });

  // RULE 2 at the render layer: nothing verified must print an em dash and a reason, never "0".
  it("prints an em dash — not a zero — when nothing has been re-scanned", () => {
    draw([pr({ verifiedScanId: null, impactDim: null, impactOverall: null })]);
    expect(within(tile("Points bought")).getByText("—")).toBeTruthy();
    expect(within(tile("Points bought")).getByText(/nothing re-scanned yet/i)).toBeTruthy();
  });

  // RULE 1: a merge without a rescan is named in the field notes, not silently dropped.
  it("states how many merges are still awaiting a rescan", () => {
    draw([pr(), pr({ prNumber: 2, verifiedScanId: null, impactDim: null })]);
    expect(screen.getByText(/1 merged PR is still awaiting a rescan/i)).toBeTruthy();
    expect(within(tile("Points bought")).getByText("+6")).toBeTruthy(); // only the verified row
    expect(screen.getByText("awaiting rescan")).toBeTruthy(); // the row's own status cell
  });

  // RULE 3 (UAT DANA-L1-010): a regression keeps its sign and gets its own tile.
  it("shows a regression with its sign instead of absorbing it into the headline", () => {
    draw([pr({ impactDim: 8 }), pr({ prNumber: 2, impactDim: -3 })]);
    expect(within(tile("Points bought")).getByText("+5")).toBeTruthy();
    expect(within(tile("Regressions")).getByText("1")).toBeTruthy();
    expect(screen.getByText("-3")).toBeTruthy();
  });

  it("prints a net-negative period rather than hiding it", () => {
    draw([pr({ impactDim: -4 })]);
    expect(within(tile("Points bought")).getByText("-4")).toBeTruthy();
  });

  // A verified row with no baseline is disclosed as a limit, not counted as a zero contribution.
  it("discloses re-scanned merges that have no baseline to compare against", () => {
    draw([pr({ impactDim: null, impactOverall: null })]);
    expect(screen.getByText(/no baseline scan to compare against/i)).toBeTruthy();
    expect(within(tile("Points bought")).getByText("—")).toBeTruthy();
  });

  it("never sums per-repo overall movement, and says so", () => {
    draw([pr({ repoFullName: "acme/web", impactOverall: 3 }), pr({ repoFullName: "acme/api", prNumber: 2, impactOverall: 4 })]);
    expect(screen.getByText(/never summed/i)).toBeTruthy();
    // 7 would be the forbidden cross-repo total; the per-row values stand on their own.
    expect(screen.queryByText("+7")).toBeNull();
  });

  it("links each row to its PR and its repo", () => {
    draw([pr()]);
    expect(screen.getByRole("link", { name: /agent guidance/i }).getAttribute("href")).toBe(
      "https://github.com/acme/web/pull/1",
    );
    expect(screen.getByRole("link", { name: "web" }).getAttribute("href")).toBe("https://github.com/acme/web");
  });
});

// Direction 3 — the table declared SIX headers (Repository | Bought | Dim delta | Repo overall |
// Source | Status) and each row emitted FIVE cells, so every verified/awaiting badge rendered under
// "Source" and the "Status" column stood empty for every row. On a receipt, a value sitting under
// the wrong heading is worse than no value at all.
describe("ImpactLedger — every row fills every column it declares", () => {
  it("emits one cell per header, with the badge under Status and the surface under Source", () => {
    draw([pr({ source: "practice-pr" })]);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent?.trim());
    expect(headers).toEqual(["Repository", "Bought", "Dim delta", "Repo overall", "Source", "Status"]);

    const row = screen.getAllByRole("row")[1]!;
    const cells = within(row).getAllByRole("cell");
    expect(cells.length).toBe(headers.length);
    expect(cells[4]!.textContent).toContain("practice");
    expect(cells[5]!.textContent).toContain("verified");
  });

  it("names a loop lane's row as a loop lane, and an unverified row as awaiting rescan", () => {
    draw([pr({ source: "loop", loopLaneId: "lane_1", verifiedScanId: null })]);
    const row = screen.getAllByRole("row")[1]!;
    const cells = within(row).getAllByRole("cell");
    expect(cells[4]!.textContent).toContain("loop lane");
    expect(cells[5]!.textContent).toContain("awaiting rescan");
  });
});
