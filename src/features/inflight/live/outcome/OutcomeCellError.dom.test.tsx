// @vitest-environment jsdom
//
// A LANE FAILURE IS A MARK, AND THE ACCOUNT IS A CLICK AWAY. The engine writes sixty-word errors on
// purpose — they name the cycle, the stage in flight, and what is now orphaned — and the sheet used to
// print them inline in a 168px column, where one FORCE-FAILED lane buried every other repository's
// verdict. What is pinned here is that the trade is not a loss: the mark is a real button whose
// accessible name says WHAT failed, and the dialog carries the whole string, unclipped.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OutcomeCellError } from "./OutcomeCellError";
import { errorHeadline } from "./outcomeText";

afterEach(cleanup);

const FORCE_FAILED =
  "Cycle 1 was FORCE-FAILED: it exceeded its 90 min deadline while no stage in particular was in flight, so the lane was cut loose rather than left holding the run. Whatever that call was doing is orphaned; nothing it may still produce is committed, rescanned or delivered.";

describe("errorHeadline", () => {
  it("takes the lead clause — what happened — and leaves what it means to the dialog", () => {
    expect(errorHeadline(FORCE_FAILED)).toBe("Cycle 1 was FORCE-FAILED");
  });

  it("falls back to the first sentence when there is no colon", () => {
    expect(errorHeadline("The agent exited non-zero. Nothing was committed.")).toBe("The agent exited non-zero");
  });

  it("clips a single unbroken sentence rather than printing a paragraph", () => {
    const long = "x".repeat(200);
    expect(errorHeadline(long).length).toBeLessThanOrEqual(72);
    expect(errorHeadline(long)).toContain("…");
  });
});

describe("the cell's error mark", () => {
  it("draws a mark, not the paragraph — and names the failure in its accessible name", () => {
    render(<OutcomeCellError error={FORCE_FAILED} repo="acme/one" stage="verify" />);
    expect(screen.queryByText(/is orphaned/)).toBeNull();
    const button = screen.getByRole("button", { name: /acme\/one: Cycle 1 was FORCE-FAILED/ });
    expect(button).toBeTruthy();
  });

  it("opens a dialog carrying the WHOLE error, and the stage the lane was cut at", () => {
    render(<OutcomeCellError error={FORCE_FAILED} repo="acme/one" stage="verify" />);
    fireEvent.click(screen.getByTestId("cell-error"));
    expect(screen.getByRole("dialog", { name: /Lane failure on acme\/one/ })).toBeTruthy();
    expect(screen.getByText(FORCE_FAILED)).toBeTruthy();
    expect(screen.getByText(/cut at verify/)).toBeTruthy();
  });
});
