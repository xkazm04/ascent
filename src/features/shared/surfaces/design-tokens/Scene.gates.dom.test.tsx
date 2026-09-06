// @vitest-environment jsdom
//
// The design-tokens scene under jsdom: the behaviour half. Each region's mechanism is exercised
// through its controls: the three-state resolve and the unbound-role defect, the parity gate's three
// failures, the severity decision, the axes rebinding disjoint slices, and the admission desk.

import { describe, expect, it } from "vitest";
import { fireEvent, render, within } from "@testing-library/react";
import { SURFACE_VOLUMES } from "@/lib/org/surface-catalog";
import { MotionScope } from "../surfaceMotionScope";
import { body } from "./index";
import { judgeName } from "./TaxonomyPanel";

const { Scene } = body;
const mount = () => {
  const r = render(
    <MotionScope reduced={false}>
      <Scene technique={null} reduced={false} volume={SURFACE_VOLUMES[0]} />
    </MotionScope>,
  );
  const region = (slug: string) => r.container.querySelector(`[data-technique="${slug}"]`) as HTMLElement;
  const root = r.container.querySelector("[data-scene]") as HTMLElement;
  return { ...r, region, root };
};
const press = (scope: HTMLElement, name: RegExp | string) => fireEvent.click(within(scope).getByRole("button", { name }));
const group = (scope: HTMLElement, label: string) => within(scope).getByRole("group", { name: label });

describe("theme-architecture", () => {
  it("resolves the three-state preference and stamps the root", () => {
    const { region, root } = mount();
    const t = region("theme-architecture");
    expect(t.querySelector("[data-resolved]")?.getAttribute("data-resolved")).toBe("dark");
    press(group(t, "platform says"), /^light$/); // system follows the platform
    expect(root.getAttribute("data-theme")).toBe("light");
    expect(root.style.getPropertyValue("--sx-surface")).toBe("#ffffff");
    press(group(t, "preference"), /^dark$/); // an explicit choice wins over the platform
    expect(root.getAttribute("data-theme")).toBe("dark");
  });

  it("an unbound role fails the completeness gate and vanishes from the light scope", () => {
    const { region, root } = mount();
    const t = region("theme-architecture");
    expect(t.querySelector("[data-completeness]")?.getAttribute("data-completeness")).toBe("pass");
    press(t, /drop foreground-muted/);
    expect(t.querySelector('[data-cell="light:foreground-muted"]')?.getAttribute("data-bound")).toBe("false");
    expect(t.querySelector("[data-completeness]")?.getAttribute("data-completeness")).toBe("fail");
    expect(root.style.getPropertyValue("--sx-foreground-muted")).toBe("#94a3b8"); // dark still binds it
    press(group(t, "preference"), /^light$/);
    expect(root.style.getPropertyValue("--sx-foreground-muted")).toBe(""); // light does not
  });
});

describe("cross-language-token-parity", () => {
  it("reports parity, then drift on a retune and a phantom, and a broken instrument on an empty read", () => {
    const { region } = mount();
    const p = region("cross-language-token-parity");
    const status = () => p.querySelector("[data-parity]")?.getAttribute("data-parity");
    expect(status()).toBe("parity");
    press(p, /retune base/);
    expect(status()).toBe("drift");
    expect(p.querySelector('[data-parity-row="base"]')?.getAttribute("data-parity-bad")).toBe("true");
    press(p, /retune base/);
    press(p, /phantom step/);
    expect(status()).toBe("drift");
    expect(within(p).getByText(/tooltip: phantom/)).toBeTruthy();
    press(p, /phantom step/);
    press(p, /empty file/);
    expect(status()).toBe("broken");
  });
});

describe("token-enforcement", () => {
  it("warn passes with findings, error fails, ratchet passes at baseline and fails on increase", () => {
    const { region } = mount();
    const e = region("token-enforcement");
    const build = () => e.querySelector("[data-build]")?.getAttribute("data-build");
    const open = Number(e.querySelector("[data-open]")?.getAttribute("data-open"));
    expect(open).toBeGreaterThan(0);
    expect(build()).toBe("pass");
    press(e, /^error$/);
    expect(build()).toBe("fail");
    press(e, /^ratchet$/);
    expect(build()).toBe("pass");
    press(e, /inline a raw value/);
    expect(build()).toBe("fail");
    press(e, /suppress one inline/);
    expect(build()).toBe("pass");
    expect(Number(e.querySelector("[data-suppressions]")?.getAttribute("data-suppressions"))).toBeGreaterThanOrEqual(1);
  });
});

describe("density-and-scale-axes", () => {
  it("compact rebinds spacing only; 1.3x rebinds type only and clips the fixed box", () => {
    const { region, root } = mount();
    const a = region("density-and-scale-axes");
    expect(root.style.getPropertyValue("--sx-row-h")).toBe("36px");
    press(a, /^compact$/);
    expect(root.style.getPropertyValue("--sx-row-h")).toBe("24px");
    expect(root.style.getPropertyValue("--sx-type-body")).toBe("15px");
    expect(a.querySelector("[data-clipped]")?.getAttribute("data-clipped")).toBe("false");
    press(a, /^1\.3x$/);
    expect(root.style.getPropertyValue("--sx-type-body")).toBe("20px");
    expect(root.style.getPropertyValue("--sx-row-h")).toBe("24px");
    expect(a.querySelector("[data-clipped]")?.getAttribute("data-clipped")).toBe("true");
    expect(root.querySelector("[data-row-h]")?.getAttribute("data-row-h")).toBe("24"); // the chart read the same authority
  });
});

describe("motion-tokens", () => {
  it("counts answers on the ladder and binds the chip to the chosen step", () => {
    const { region } = mount();
    const m = region("motion-tokens");
    expect(m.querySelector("[data-ladder-right]")?.getAttribute("data-ladder-right")).toBe("1");
    fireEvent.change(within(m).getByLabelText(/Step for hover tint/), { target: { value: "instant" } });
    fireEvent.change(within(m).getByLabelText(/Step for a modal/), { target: { value: "slow" } });
    expect(m.querySelector("[data-ladder-right]")?.getAttribute("data-ladder-right")).toBe("3");
    fireEvent.change(within(m).getByLabelText("Chip duration step"), { target: { value: "slow" } });
    expect(m.querySelector("[data-chip-step]")?.getAttribute("data-chip-step")).toBe("slow");
  });
});

describe("token-taxonomy", () => {
  it("refuses value-named and address-named candidates and mints only on three passes", () => {
    expect(judgeName("gray-700-text").ok).toBe(false);
    expect(judgeName("settings-page-header-border").ok).toBe(false);
    expect(judgeName("Border Subtle").ok).toBe(false);
    expect(judgeName("border-subtle").ok).toBe(true);
    const { region } = mount();
    const t = region("token-taxonomy");
    expect(t.querySelector("[data-admission]")?.getAttribute("data-admission")).toBe("nearest-role");
    press(t, /owner-answerable/);
    expect(t.querySelector("[data-admission]")?.getAttribute("data-admission")).toBe("minted");
    press(t, /try gray-700-text/);
    expect(t.querySelector("[data-admission]")?.getAttribute("data-admission")).toBe("nearest-role");
  });
});
