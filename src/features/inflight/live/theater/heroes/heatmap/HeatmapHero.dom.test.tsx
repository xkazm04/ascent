// @vitest-environment jsdom
//
// The heat map hero against the deterministic demo fixture: the active repos and their phase in
// words, cells cool for reads and warm for edits, the map ACCUMULATING across pulses (a file that
// scrolled out of the bounded window stays), the planning frame, a landing's stamp and its resting
// badge, the reduced-motion / frozen-clock end states, and the text alternative.

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoopPulse } from "@/lib/local/runner-types";
import { DEMO_EPOCH, fixturePulseAt } from "../../theaterFixture";
import { HeatmapHero } from "../HeatmapHero";
import { STAMP_HOLD_MS } from "./heatStyle";

// jsdom has no layout: the map is measured by a ResizeObserver, so hand it a 1200×700 box.
class FakeResizeObserver {
  constructor(private cb: ResizeObserverCallback) {}
  observe() {
    this.cb([{ contentRect: { width: 1200, height: 700 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}
beforeEach(() => vi.stubGlobal("ResizeObserver", FakeResizeObserver));
afterEach(() => vi.unstubAllGlobals());

const at = (s: number) => DEMO_EPOCH + s * 1000;
const hero = (pulse: LoopPulse, now: number, reducedMotion = false) => <HeatmapHero pulse={pulse} now={now} reducedMotion={reducedMotion} />;
const cell = (path: string) => document.querySelector<HTMLElement>(`[data-file="${path}"]`);
const mentions = (p: LoopPulse, path: string) => JSON.stringify(p.lanes).includes(path);

describe("HeatmapHero — what it shows", () => {
  it("names the active repos and says their phase in words", () => {
    render(hero(fixturePulseAt(at(95)), at(95)));
    expect(screen.getByRole("heading", { name: "kp" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "systedo" })).toBeInTheDocument();
    expect(screen.getAllByTestId("heat-phase").map((n) => n.textContent)).toEqual(["Editing", "Planning"]);
  });

  it("draws touched files as cells: warm where it edited, cool where it read", () => {
    render(hero(fixturePulseAt(at(95)), at(95)));
    expect(cell("src/scoring/claims.ts")?.dataset.tone).toBe("edit");
    expect(cell("src/analyze/signals.ts")?.dataset.tone).toBe("read");
    expect(document.querySelector('[data-module="src/scoring/"]')).not.toBeNull();
  });

  it("a planning lane that opened nothing shows the surveyed frame, not an empty box", () => {
    render(hero(fixturePulseAt(at(95)), at(95)));
    expect(screen.getByText("Planning — reading nothing yet")).toBeInTheDocument();
  });

  it("with no runner there is no map and no fleet, and it says so", () => {
    render(hero(fixturePulseAt(at(0), "none"), at(0)));
    expect(screen.getByText("No agent is in the code")).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Fleet" })).toBeNull();
  });

  it("shows the fleet at the edge: working lanes and the repo waiting for a slot", () => {
    render(hero(fixturePulseAt(at(95)), at(95)));
    expect(document.querySelector('[data-star="acme/web"]')?.getAttribute("data-state")).toBe("waiting");
    expect(document.querySelector('[data-star="acme/kp"]')?.getAttribute("data-state")).toBe("working");
  });
});

describe("HeatmapHero — accumulation, stamps and honesty", () => {
  it("accumulates across pulses: a file that left the bounded window stays on the map", () => {
    const first = fixturePulseAt(at(30));
    const later = fixturePulseAt(at(62));
    expect(mentions(first, "src/scoring/engine.ts")).toBe(true);
    expect(mentions(later, "src/scoring/engine.ts")).toBe(false);
    const { rerender } = render(hero(first, at(30)));
    rerender(hero(later, at(62)));
    expect(cell("src/scoring/engine.ts")).not.toBeNull();
    expect(screen.getAllByText(/seen by this screen since/).length).toBeGreaterThan(0);
  });

  it("a landing that arrives stamps the modules the session edited, then rests as a badge", () => {
    const { rerender } = render(hero(fixturePulseAt(at(160)), at(160)));
    expect(document.querySelector("[data-stamp]")).toBeNull();
    rerender(hero(fixturePulseAt(at(170)), at(170)));
    const held = document.querySelector('[data-module="src/scoring/"] [data-stamp="held"]');
    expect(held).not.toBeNull();
    const later = at(170) + STAMP_HOLD_MS + 1000;
    rerender(hero(fixturePulseAt(later), later));
    expect(document.querySelector('[data-module="src/scoring/"] [data-stamp="badge"]')).not.toBeNull();
    expect(document.querySelector('[data-stamp="held"]')).toBeNull();
  });

  it("the first load is history: a landing already listed gets its badge, never the big stamp", () => {
    render(hero(fixturePulseAt(at(172)), at(172)));
    expect(document.querySelector('[data-stamp="held"]')).toBeNull();
    expect(document.querySelector('[data-module="src/scoring/"] [data-stamp="badge"]')).not.toBeNull();
  });

  it("a new session over an earlier map says so, dims it, and points at no file", () => {
    const { rerender } = render(hero(fixturePulseAt(at(160)), at(160)));
    rerender(hero(fixturePulseAt(at(186)), at(186)));
    const kp = document.querySelector('[data-repo="acme/kp"]')!;
    expect(kp.querySelector("[data-earlier]")).not.toBeNull();
    expect(kp.querySelector('[data-testid="heat-earlier"]')).not.toBeNull();
    expect(kp.querySelector("[data-cursor]")).toBeNull();
    expect(kp.querySelector('[data-file="src/scoring/claims.ts"]')).not.toBeNull();
  });

  it("with no lane working, the maps this screen drew stay up — cooling, named as such", () => {
    const { rerender } = render(hero(fixturePulseAt(at(95)), at(95)));
    rerender(hero(fixturePulseAt(at(100), "idle"), at(100)));
    expect(screen.getByRole("heading", { name: "kp" })).toBeInTheDocument();
    expect(screen.getAllByTestId("heat-phase").map((n) => n.textContent)).toContain("No lane running");
    expect(cell("src/scoring/claims.ts")).not.toBeNull();
  });

  it("a lane that has left the files claims no place: no cursor and no trail head while it is verifying", () => {
    render(hero(fixturePulseAt(at(140)), at(140)));
    const kp = document.querySelector('[data-repo="acme/kp"]')!; // checking the build
    const systedo = document.querySelector('[data-repo="acme/systedo"]')!; // reading the code
    expect(kp.querySelector('[data-testid="heat-phase"]')?.textContent).toBe("Checking the build");
    expect(kp.querySelector("[data-cursor]")).toBeNull();
    expect(kp.querySelector("[data-head]")).toBeNull();
    expect(kp.querySelector("[data-trail]")).not.toBeNull(); // where it walked is still true — it only cools
    expect(systedo.querySelector("[data-cursor]")).not.toBeNull();
    expect(systedo.querySelector("[data-trail][data-live]")).not.toBeNull();
  });

  it("heat is time since the touch against `now`: a frozen clock changes nothing, a later one cools", () => {
    const p = fixturePulseAt(at(95));
    const { rerender } = render(hero(p, at(95)));
    const hot = Number(cell("src/scoring/claims.test.ts")?.dataset.heat);
    rerender(hero(p, at(95)));
    expect(Number(cell("src/scoring/claims.test.ts")?.dataset.heat)).toBe(hot);
    rerender(hero(p, at(155)));
    expect(Number(cell("src/scoring/claims.test.ts")?.dataset.heat)).toBeLessThan(hot / 4);
  });

  it("reduced motion renders end states: no transitions, no burn rings, a still stamp", () => {
    const p = fixturePulseAt(at(95));
    const { rerender } = render(hero(p, at(95), true));
    expect(cell("src/scoring/claims.test.ts")!.style.transition).toBe("");
    expect(document.querySelector("[data-burn]")).toBeNull();
    rerender(hero(p, at(95), false)); // the same fresh edit, motion allowed: it rings
    expect(cell("src/scoring/claims.test.ts")!.style.transition).not.toBe("");
    expect(document.querySelector("[data-burn]")).not.toBeNull();
    rerender(hero(fixturePulseAt(at(160)), at(160), true));
    rerender(hero(fixturePulseAt(at(170)), at(170), true));
    expect(document.querySelector('[data-module="src/scoring/"] [data-stamp="held"]')).not.toBeNull();
  });

  it("exposes a text alternative: phases, the map's extent, where the heat is, and the fleet", () => {
    render(hero(fixturePulseAt(at(95)), at(95)));
    const text = screen.getByTestId("heat-summary").textContent ?? "";
    expect(text).toMatch(/kp: Editing for \d+ s\. Map: \d+ files · \d+ folders/);
    expect(text).toMatch(/Hot: edited /);
    expect(text).toContain("web waiting for a slot");
    expect(screen.getByRole("region", { name: /^Code heat map: kp: Editing/ })).toBeInTheDocument();
  });
});
