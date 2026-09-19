// @vitest-environment jsdom
//
// THE DIMENSION BAND, in the DOM. The pure fold is pinned in outcomeSheetGroups.test.ts; what this
// file pins is the bargain the sheet strikes with the reader:
//
//   • a band of two or more gaps is COLLAPSED on arrival — the hundred-row wall is what the band
//     exists to end, so a sheet that opened expanded would have changed nothing;
//   • its cells carry a COUNT per run, which is what a reader is owed in exchange for the hidden
//     headlines;
//   • the rows are one click away, and clicking one band opens only that band;
//   • a band of ONE is not a band: its gap row renders directly, exactly as before.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { OutcomeSheet } from "./OutcomeSheet";
import { cell, fixture } from "./outcome.fixture";
import type { GapRow } from "./outcomeGapRows";
import type { OutcomeMatrix } from "./outcomeMatrix";

afterEach(cleanup);

const gap = (headline: string, dimId: GapRow["dimId"]): GapRow => ({
  headline,
  dimId,
  kind: "hardened",
  covers: [headline],
  evidence: null,
  state: "committed",
  laneId: "lane-acme/one",
});

/** One repo, two runs: three D9 gaps (a band) and one D5 gap (not a band). */
const banded: OutcomeMatrix = {
  columns: fixture.columns.slice(1),
  groups: [
    {
      repo: "acme/one",
      lift: 4,
      cells: {
        "run-2": cell({
          runId: "run-2",
          repo: "acme/one",
          commits: 2,
          verdict: { kind: "attributable", delta: 4 },
          rows: [gap("Pinned the action SHAs", "D9"), gap("Added a SAST workflow", "D9")],
        }),
        "run-3": cell({
          runId: "run-3",
          repo: "acme/one",
          commits: 1,
          verdict: { kind: "attributable", delta: 3 },
          rows: [gap("Scoped the workflow token", "D9"), gap("Wrote the setup section", "D5")],
        }),
      },
    },
  ],
  latestId: "run-3",
  totals: { lift: 4, runs: 2, gaps: 4, repos: 1 },
};

const sheet = () => render(<OutcomeSheet matrix={banded} slug="acme" selectedId="run-3" onOpen={vi.fn()} />);

describe("the sheet's dimension bands", () => {
  it("collapses a band of three gaps and names it once, with the gap count", () => {
    sheet();
    const band = screen.getByTestId("outcome-band");
    expect(band.textContent).toContain("D9 · Security");
    expect(band.textContent).toContain("3 gaps");
    expect(band.getAttribute("aria-expanded")).toBe("false");
    // The headlines are genuinely not on the page — the band is a level of detail, not a style.
    expect(screen.queryByRole("rowheader", { name: /Pinned the action SHAs/ })).toBeNull();
  });

  it("carries a per-run COUNT of the band's gaps that run touched — the trade for the hidden rows", () => {
    sheet();
    const row = screen.getByTestId("outcome-band").closest("tr")!;
    const cells = row.querySelectorAll("td");
    expect(cells[0]!.textContent).toContain("2");
    expect(cells[0]!.textContent).toContain("2 done");
    expect(cells[1]!.textContent).toContain("1");
  });

  it("opens only the band that was clicked, and reveals its rows", () => {
    sheet();
    fireEvent.click(screen.getByTestId("outcome-band"));
    expect(screen.getByTestId("outcome-band").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("rowheader", { name: /Pinned the action SHAs/ })).toBeTruthy();
    expect(screen.getByRole("rowheader", { name: /Scoped the workflow token/ })).toBeTruthy();
  });

  it("does NOT band a lone gap — one row keeps its own row, unbanded and visible on arrival", () => {
    sheet();
    // D5 has exactly one gap, so there is exactly ONE band on the page (D9's) and D5's row is drawn.
    expect(screen.getAllByTestId("outcome-band")).toHaveLength(1);
    expect(screen.getByRole("rowheader", { name: /Wrote the setup section/ })).toBeTruthy();
  });

  it("leaves a run that touched nothing in the band with an empty cell, never a zero", () => {
    const untouched: OutcomeMatrix = {
      ...banded,
      groups: [
        {
          repo: "acme/one",
          lift: null,
          cells: {
            "run-3": cell({
              runId: "run-3",
              repo: "acme/one",
              commits: 1,
              rows: [gap("Pinned the action SHAs", "D9"), gap("Added a SAST workflow", "D9")],
            }),
          },
        },
      ],
    };
    render(<OutcomeSheet matrix={untouched} slug="acme" selectedId="run-3" onOpen={vi.fn()} />);
    const cells = screen.getByTestId("outcome-band").closest("tr")!.querySelectorAll("td");
    expect(cells[0]!.textContent).toBe("");
    expect(within(cells[1]! as HTMLElement).getByText("2")).toBeTruthy();
  });
});
