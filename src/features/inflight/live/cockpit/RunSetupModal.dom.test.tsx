// @vitest-environment jsdom
//
// THE RUN SETUP DIALOG — the dials that left the rail on 2026-09-17.
//
// THE DELIVERY DIAL's three load-bearing claims are inherited verbatim from the retired
// CockpitRunControls test, because each of them cost somebody something and none of them was what was
// wrong with that panel:
//
//   1. all three modes are offered, and `branch` is what the dial sits on — the default has to be the
//      one that writes nothing outside the loop's own branches;
//   2. the labels say what the mode does to the OPERATOR'S MACHINE. "Land in my current branch" is the
//      one that merges into a real working copy, and a picker that called it "land" would be naming an
//      implementation rather than a consequence;
//   3. `pr` is DISABLED, with its reason on the control, when the deployment has no GitHub App — the
//      mode is honestly unavailable rather than offered and then refused on submit.
//
// And two claims about the move itself: the CONSEQUENCE of a chosen mode stays on the page (it is not
// one of the paragraphs that went into a tooltip), and the dialog reports what is armed.

import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach } from "vitest";
import { RunSetupModal, dialsSummary } from "./RunSetupModal";
import { INITIAL_DIALS, type RunDials } from "./useRunDials";

afterEach(cleanup);

const open = (over: Partial<RunDials> = {}, prAvailable = true) => {
  const onChange = vi.fn();
  render(
    <RunSetupModal
      open
      onClose={vi.fn()}
      dials={{ ...INITIAL_DIALS, ...over }}
      onChange={onChange}
      dims={[{ id: "D9", label: "Security" }]}
      prAvailable={prAvailable}
    />,
  );
  return { onChange, delivery: screen.getByTestId("setup-delivery") };
};

describe("the delivery dial", () => {
  it("offers all three modes and starts on the branch default", () => {
    const { delivery } = open();
    const modes = within(delivery).getAllByRole("radio");
    expect(modes).toHaveLength(3);
    expect(modes.map((m) => m.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
  });

  it("labels each mode by what it does to the operator's machine", () => {
    const { delivery } = open();
    const text = within(delivery)
      .getAllByRole("radio")
      .map((m) => m.textContent ?? "");
    expect(text[0]).toContain("Leave on a branch");
    expect(text[1]).toContain("my current branch");
    expect(text[2]).toContain("Open a PR");
  });

  it("keeps the CONSEQUENCE of the current choice on the page, not in a tooltip", () => {
    open();
    expect(screen.getByText(/Nothing merges it/)).toBeTruthy();
    cleanup();
    open({ delivery: "land" });
    expect(screen.getByText(/fast-forward only/)).toBeTruthy();
    expect(screen.getByText(/branch your paired checkout is on/)).toBeTruthy();
  });

  it("reports the operator's pick back through the shared dials setter", () => {
    const { onChange, delivery } = open();
    fireEvent.click(within(delivery).getAllByRole("radio")[1]!);
    expect(onChange).toHaveBeenCalledWith("delivery", "land");
  });

  it("DISABLES pr — with the reason on the control — when the deployment has no GitHub App", () => {
    const { delivery } = open({}, false);
    const modes = within(delivery).getAllByRole("radio") as HTMLButtonElement[];
    expect(modes[2]!.disabled).toBe(true);
    expect(modes[2]!.title).toContain("GitHub App");
    // The other two are unaffected: an absent App says nothing about branches or landing.
    expect(modes.filter((m) => m.disabled)).toHaveLength(1);
  });

  it("leaves pr selectable when a GitHub App is configured", () => {
    const { delivery } = open();
    expect((within(delivery).getAllByRole("radio") as HTMLButtonElement[]).some((m) => m.disabled)).toBe(false);
  });
});

describe("the guard", () => {
  it("says plainly what is not happening when it is switched off", () => {
    open({ verifyMode: "off" });
    expect(screen.getByText(/Nothing will check the agent's work/)).toBeTruthy();
    // …and the budget it would have spent is not offered while nothing is being checked.
    expect((screen.getByTestId("setup-verify-minutes") as HTMLSelectElement).disabled).toBe(true);
  });
});

describe("dialsSummary", () => {
  it("names the armed configuration — the gear's tooltip and the dialog's footer read the same line", () => {
    expect(dialsSummary(INITIAL_DIALS)).toContain("all dimensions");
    expect(dialsSummary(INITIAL_DIALS)).toContain("verified");
    expect(dialsSummary(INITIAL_DIALS)).toContain("branch");
    expect(dialsSummary({ ...INITIAL_DIALS, verifyMode: "off", dimFocus: "D9" })).toContain("unverified");
    expect(dialsSummary({ ...INITIAL_DIALS, verifyMode: "off", dimFocus: "D9" })).toContain("focus D9");
  });
});
