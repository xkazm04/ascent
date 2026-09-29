// @vitest-environment jsdom
//
// The scene is the page's second and third layer: a line, then one piece of evidence. Pins what the
// visitor can rely on at each level: the way back is always labelled, the crumbs say where they are, every
// invented artefact carries its tag, and the buttons move through the URL hash (the source of truth).

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DIMENSIONS } from "@/lib/maturity/model";
import { PrismScene } from "./PrismScene";
import { EVIDENCE } from "./prismEvidence";

const base = { arch: "org" as const, open: true, live: true, reduced: true, mobile: false };

function mount(over: Partial<React.ComponentProps<typeof PrismScene>> = {}) {
  const go = vi.fn();
  const up = vi.fn();
  const utils = render(<PrismScene index={3} ev={null} go={go} up={up} {...base} {...over} />);
  return { go, up, ...utils };
}

describe("PrismScene", () => {
  it("is an empty, hidden dialog until a line is chosen", () => {
    const { container } = mount({ index: null, open: false, live: false });
    const scene = container.querySelector("#scene") as HTMLElement;
    expect(scene.getAttribute("aria-hidden")).toBe("true");
    expect(scene.querySelector(".sc-name")).toBeNull();
  });

  it("shows the line: name, description, weights under each lens, evidence rows, next step", () => {
    const { container } = mount();
    const d = DIMENSIONS[3]!;
    expect(container.querySelector(".sc-name")?.textContent).toBe(d.name);
    expect(container.querySelector(".sc-desc")?.textContent).toBe(d.description);
    expect(container.querySelectorAll(".weights .wv")).toHaveLength(3);
    expect(container.querySelectorAll(".ev-row")).toHaveLength(EVIDENCE[3]!.length);
    expect(container.querySelector("#scene")?.className).toBe("open live");
    expect(container.querySelector(".sc-bar .back")?.textContent).toBe("All nine lines");
    // invented material is tagged wherever it appears
    expect(container.querySelectorAll(".tag-ill").length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector(".scalebox")?.textContent).toMatch(/Illustrative reading/);
  });

  it("walks the hash: pick evidence, step lines, go up", () => {
    const { go, up, container } = mount();
    fireEvent.click(container.querySelectorAll(".ev-row")[1]!);
    expect(go).toHaveBeenLastCalledWith("#/line/D4/2");
    fireEvent.click(screen.getByLabelText("Next line"));
    expect(go).toHaveBeenLastCalledWith("#/line/D5");
    fireEvent.click(screen.getByLabelText("Previous line"));
    expect(go).toHaveBeenLastCalledWith("#/line/D3");
    fireEvent.click(container.querySelector(".sc-bar .back")!);
    expect(up).toHaveBeenCalledTimes(1);
  });

  it("at the evidence level: labels the way back, adds a crumb, wraps 'next evidence'", () => {
    const n = EVIDENCE[3]!.length;
    const { go, container } = mount({ ev: n - 1 });
    expect(container.querySelector(".sc-bar .back")?.textContent).toBe("Back to D4");
    expect(container.querySelectorAll(".crumbs li")).toHaveLength(3);
    expect(container.querySelector(".sc-right")?.className).toBe("sc-right ev");
    const panel = container.querySelector("#prism-ev-panel") as HTMLElement;
    expect(within(panel).getByText(EVIDENCE[3]![n - 1]!.path)).toBeTruthy();
    expect(panel.textContent).toMatch(/cannot move the score outside the analyzer/);
    fireEvent.click(within(panel).getByText(/Next evidence/));
    expect(go).toHaveBeenLastCalledWith("#/line/D4/1");
    fireEvent.click(within(panel).getByText(/Back to D4/));
    expect(go).toHaveBeenLastCalledWith("#/line/D4");
  });

  it("ignores an evidence index the line does not have", () => {
    const { container } = mount({ ev: 99 });
    expect(container.querySelector(".sc-right")?.className).toBe("sc-right");
    expect(container.querySelectorAll(".crumbs li")).toHaveLength(2);
  });

  it("drops the motion paths from the line art when motion is reduced", () => {
    const calm = mount({ reduced: true, index: 2 });
    expect(calm.container.querySelector("animateMotion")).toBeNull();
    calm.unmount();
    const moving = mount({ reduced: false, index: 2 });
    expect(moving.container.querySelector("animateMotion")).not.toBeNull();
  });
});
