// @vitest-environment jsdom
//
// THE DELIVERY DIAL. Three things are load-bearing and each has cost somebody something:
//
//   1. all three modes are offered, and `branch` is what the dial sits on — the default has to be the
//      one that writes nothing outside the loop's own branches;
//   2. the labels say what the mode does to the OPERATOR'S MACHINE. "Land in my current branch" is the
//      one that merges into a real working copy, and a picker that called it "land" would be naming an
//      implementation rather than a consequence;
//   3. `pr` is DISABLED, with its reason in the option itself, when the deployment has no GitHub App —
//      the mode is honestly unavailable rather than offered and then refused on submit.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CockpitRunControls } from "./CockpitRunControls";
import { INITIAL_DIALS, type RunDials } from "./useRunDials";

const renderControls = (over: Partial<RunDials> = {}, prAvailable = true) => {
  const onChange = vi.fn();
  render(
    <CockpitRunControls dims={[{ id: "D9", label: "Security" }]} dials={{ ...INITIAL_DIALS, ...over }} onChange={onChange} prAvailable={prAvailable} />,
  );
  return { onChange, select: screen.getByTestId("cockpit-delivery") as HTMLSelectElement };
};

describe("the delivery dial", () => {
  it("offers all three modes and starts on the branch default", () => {
    const { select } = renderControls();
    expect([...select.options].map((o) => o.value)).toEqual(["branch", "land", "pr"]);
    expect(select.value).toBe("branch");
  });

  it("labels each mode by what it does to the operator's machine", () => {
    const { select } = renderControls();
    const text = [...select.options].map((o) => o.textContent ?? "");
    expect(text[0]).toContain("Leave on a branch");
    expect(text[1]).toContain("my current branch");
    expect(text[2]).toContain("Open a PR");
  });

  it("shows a standing hint under the dial rather than a modal", () => {
    renderControls();
    expect(screen.getByText(/Nothing merges it/)).toBeTruthy();
  });

  it("changes that hint with the choice — the landing one says plainly that it writes to the checkout", () => {
    renderControls({ delivery: "land" });
    expect(screen.getByText(/fast-forward only/)).toBeTruthy();
    expect(screen.getByText(/branch your paired checkout is on/)).toBeTruthy();
  });

  it("reports the operator's pick back through the shared dials setter", () => {
    const { onChange, select } = renderControls();
    fireEvent.change(select, { target: { value: "land" } });
    expect(onChange).toHaveBeenCalledWith("delivery", "land");
  });

  it("DISABLES pr — with the reason on the option — when the deployment has no GitHub App", () => {
    const { select } = renderControls({}, false);
    const pr = [...select.options].find((o) => o.value === "pr");
    expect(pr?.disabled).toBe(true);
    expect(pr?.textContent).toContain("needs the GitHub App");
    // The other two are unaffected: an absent App says nothing about branches or landing.
    expect([...select.options].filter((o) => o.disabled).map((o) => o.value)).toEqual(["pr"]);
  });

  it("leaves pr selectable when a GitHub App is configured", () => {
    const { select } = renderControls();
    expect([...select.options].some((o) => o.disabled)).toBe(false);
  });
});
