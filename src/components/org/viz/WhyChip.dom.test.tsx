// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WhyChip } from "./WhyChip";
import { STATE_HINT } from "./states";

const CAVEAT = "Scan- and probe-sourced rows carry no actor: nobody performed those in a way we observed.";

describe("WhyChip is a real, keyboard-reachable disclosure", () => {
  it("starts collapsed and wires aria-expanded / aria-controls to the popover", () => {
    render(<WhyChip hint={CAVEAT} label="actor column" />);
    const btn = screen.getByRole("button", { name: "Why: actor column" });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(CAVEAT)).not.toBeInTheDocument();

    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    const note = screen.getByText(CAVEAT);
    expect(note).toBeInTheDocument();
    // aria-controls must point at the element that actually appeared.
    expect(btn.getAttribute("aria-controls")).toBe(note.getAttribute("id"));
  });

  it("closes on Escape", () => {
    render(<WhyChip hint={CAVEAT} />);
    const btn = screen.getByRole("button", { name: /^Why:/ });
    fireEvent.click(btn);
    expect(screen.getByText(CAVEAT)).toBeInTheDocument();
    fireEvent.keyDown(btn, { key: "Escape" });
    expect(screen.queryByText(CAVEAT)).not.toBeInTheDocument();
    expect(btn).toHaveAttribute("aria-expanded", "false");
  });

  it("closes when focus leaves the chip entirely", () => {
    render(<WhyChip hint={CAVEAT} />);
    const btn = screen.getByRole("button", { name: /^Why:/ });
    fireEvent.click(btn);
    fireEvent.blur(btn, { relatedTarget: document.body });
    expect(screen.queryByText(CAVEAT)).not.toBeInTheDocument();
  });

  it("carries the shared .focus-ring rather than a hand-rolled outline", () => {
    render(<WhyChip hint={CAVEAT} />);
    expect(screen.getByRole("button", { name: /^Why:/ })).toHaveClass("focus-ring");
  });

  it("pulls the sentence from the shared vocabulary when given a state", () => {
    render(<WhyChip state="declared" label="stance band" />);
    fireEvent.click(screen.getByRole("button", { name: "Why: stance band" }));
    expect(screen.getByText(STATE_HINT.declared)).toBeInTheDocument();
  });

  it("renders nothing when there is no caveat to disclose", () => {
    const { container } = render(<WhyChip />);
    expect(container).toBeEmptyDOMElement();
  });
});
