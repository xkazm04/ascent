// @vitest-environment jsdom
//
// The Observatory hero against the deterministic fixture: it names the active repos and their phase in
// words, accumulates a lane's activity across pulses (the pulse is a 6-event window), flares ONCE for
// a landing that arrives while open (never for history), renders end states under reduced motion,
// freezes on a stale pulse, and carries a text alternative for the aria-hidden sky.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DEMO_EPOCH, fixtureLane, fixturePulse, fixturePulseAt, type DemoScenario } from "../../theaterFixture";
import { ObservatoryHero } from "../ObservatoryHero";

const at = (s: number, scenario: DemoScenario = "running") => ({ pulse: fixturePulseAt(DEMO_EPOCH + s * 1000, scenario), now: DEMO_EPOCH + s * 1000 });
const hero = (s: number, reducedMotion = false, scenario: DemoScenario = "running") => <ObservatoryHero {...at(s, scenario)} reducedMotion={reducedMotion} />;
const line = (repo: string) => document.querySelector(`[data-sky-repo="${repo}"]`)?.textContent ?? "";
const particles = (repo: string) => document.querySelectorAll(`[data-comet="${repo}"] [data-particle]`).length;
const halos = (repo: string) => document.querySelectorAll(`[data-body="${repo}"] [data-halo]`).length;

describe("ObservatoryHero", () => {
  it("puts the lanes at work on the inner ring and says what each is doing, in words", () => {
    render(hero(95));
    expect(document.querySelector('[data-body="acme/kp"]')).toHaveAttribute("data-ring", "0");
    expect(document.querySelector('[data-body="acme/systedo"]')).toHaveAttribute("data-ring", "0");
    expect(document.querySelector('[data-body="acme/web"]')).toHaveAttribute("data-ring", "1");
    expect(line("acme/kp")).toMatch(/^kp — at work: Editing; for \d+ s; last (edited|read) src\//);
    expect(line("acme/systedo")).toMatch(/^systedo — at work: Planning/);
    expect(line("acme/web")).toBe("web — next up: waits for a slot");
    // The big labels in the sky carry the same words.
    const kpLabel = document.querySelector('[data-label="acme/kp"]')!;
    expect(kpLabel).toHaveAttribute("data-label-size", "big");
    expect(kpLabel.textContent).toContain("Editing");
    expect(document.querySelector("[data-narration]")!.textContent).toMatch(/kp is editing .*web waits for a slot/);
  });

  it("accumulates a lane's activity across pulses, beyond the pulse's six-event window", () => {
    const { rerender } = render(hero(70));
    const before = particles("acme/kp");
    expect(before).toBeLessThanOrEqual(6);
    for (let s = 72; s <= 100; s += 2) rerender(hero(s));
    expect(particles("acme/kp")).toBeGreaterThan(Math.max(before, 6));
    expect(line("acme/kp")).toMatch(/\d+ reads and \d+ edits seen since this screen opened/);
  });

  it("starts a new tail when the lane's session changes (a new cycle never inherits the last one's)", () => {
    const { rerender } = render(hero(110));
    expect(particles("acme/kp")).toBeGreaterThan(0);
    rerender(hero(182)); // kp's next cycle: planning, no activity yet
    expect(particles("acme/kp")).toBe(0);
    expect(line("acme/kp")).toMatch(/Planning/);
  });

  it("flares once for a landing that ARRIVES, and the halo grows for good", () => {
    const { rerender } = render(hero(164));
    const ringsBefore = halos("acme/kp");
    expect(document.querySelector("[data-flare]")).toBeNull();
    rerender(hero(170));
    expect(document.querySelector('[data-body="acme/kp"] [data-flare]')).not.toBeNull();
    expect(halos("acme/kp")).toBe(ringsBefore + 1);
    rerender(hero(174));
    expect(document.querySelector("[data-flare]")).toBeNull();
    expect(halos("acme/kp")).toBe(ringsBefore + 1);
    expect(document.querySelector("[data-narration]")!.textContent).toContain("kp just landed verified work");
  });

  it("treats a landing already in the first pulse as history: a halo, no flare", () => {
    render(hero(172));
    expect(document.querySelector("[data-flare]")).toBeNull();
    expect(halos("acme/kp")).toBeGreaterThan(0);
  });

  it("renders end states under reduced motion: halo yes, flare no, no transitions or entrances", () => {
    // Seed: with motion allowed the same sky DOES carry transitions, so the absence below means something.
    const moving = render(hero(95));
    expect(moving.container.innerHTML).toContain("transition:");
    moving.unmount();
    const { rerender, container } = render(hero(164, true));
    rerender(hero(170, true));
    expect(document.querySelector("[data-flare]")).toBeNull();
    expect(halos("acme/kp")).toBeGreaterThan(0);
    const html = container.innerHTML;
    expect(html).not.toContain("starting:");
    expect(html).not.toContain("transition:");
  });

  it("does not move on a stale pulse: the same pulse and a frozen clock render the same sky", () => {
    const frozen = at(95);
    const { rerender, container } = render(<ObservatoryHero {...frozen} reducedMotion={false} />);
    const first = container.innerHTML;
    rerender(<ObservatoryHero {...frozen} reducedMotion={false} />);
    expect(container.innerHTML).toBe(first);
  });

  it("glides a body between rings only when its runner state changes — and lands at once under reduced motion", () => {
    const waitingSky = fixturePulse({ lanes: [fixtureLane()], waiting: ["acme/web"] });
    const workingSky = fixturePulse({ lanes: [fixtureLane(), fixtureLane({ laneId: "lane-web", repo: "acme/web" })], waiting: [] });
    const where = () => document.querySelector('[data-body="acme/web"]')!.getAttribute("transform");
    for (const reduced of [false, true]) {
      const { rerender, unmount } = render(<ObservatoryHero pulse={waitingSky} now={DEMO_EPOCH} reducedMotion={reduced} />);
      const before = where();
      rerender(<ObservatoryHero pulse={waitingSky} now={DEMO_EPOCH + 1000} reducedMotion={reduced} />);
      expect(where()).toBe(before); // the clock alone moves nothing
      rerender(<ObservatoryHero pulse={workingSky} now={DEMO_EPOCH + 2000} reducedMotion={reduced} />);
      expect(document.querySelector('[data-body="acme/web"]')).toHaveAttribute("data-ring", "0");
      // Motion allowed: the first frame after the change is still the old seat (the glide starts there).
      if (reduced) expect(where()).not.toBe(before);
      else expect(where()).toBe(before);
      unmount();
    }
  });

  it("keys the legend to what is actually drawn: no comet, no tails line", () => {
    // A lane can be AT WORK with nothing to draw — it has just been dispatched and its window is
    // empty — and then "Tails · activity seen since…" and the particle colours decode nothing.
    const bare = fixturePulse({ lanes: [fixtureLane({ phase: "planning", tail: [] })] });
    const legend = () => document.querySelector("[data-legend]")!;
    const { rerender } = render(<ObservatoryHero pulse={bare} now={DEMO_EPOCH} reducedMotion={false} />);
    expect(document.querySelector('[data-body="acme/kp"]')).toHaveAttribute("data-ring", "0");
    expect(document.querySelectorAll("[data-particle]")).toHaveLength(0);
    expect(legend()).toHaveAttribute("data-legend", "halos");
    expect(legend().textContent).not.toMatch(/Tails|edits|reads/);
    expect(legend().textContent).toMatch(/landed today · seats carry no score/);
    // The same lane WITH activity earns the line back — so the absence above means something.
    rerender(<ObservatoryHero pulse={fixturePulse()} now={DEMO_EPOCH} reducedMotion={false} />);
    expect(document.querySelectorAll("[data-particle]").length).toBeGreaterThan(0);
    expect(legend()).toHaveAttribute("data-legend", "tails");
    expect(legend().textContent).toMatch(/Tails · activity seen since this screen opened at \d\d:\d\d/);
  });

  it("drops to the one claim it always has to disown when the sky carries no mark at all", () => {
    // A fresh mount, because the halo key is honest about MEMORY: a landing this screen has already
    // seen keeps its ring for the rest of the session, so only a new screen can have none.
    render(<ObservatoryHero pulse={fixturePulse({ lanes: [fixtureLane({ phase: "planning", tail: [] })], latest: [] })} now={DEMO_EPOCH} reducedMotion={false} />);
    expect(document.querySelector("[data-legend]")).toHaveAttribute("data-legend", "bare");
    expect(document.querySelector("[data-legend]")!.textContent).toBe("Seats carry no score");
  });

  it("hides the sky from assistive tech and says it in text instead", () => {
    render(hero(95));
    expect(screen.getByTestId("observatory-sky")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("region", { name: /Observatory/ })).toBeInTheDocument();
    const alt = screen.getByTestId("observatory-text");
    expect(alt).toHaveClass("sr-only");
    expect(alt.textContent).toMatch(/kp is editing/);
    expect(screen.getByRole("list", { name: "Repos in the sky" }).children.length).toBe(3);
  });

  it.each([
    ["idle", /Every repo is resting/, /^kp — resting: rests until \d\d:\d\d/],
    ["paused-session", /The runner is holding — session limit until \d\d:\d\d/, /^kp — resting:/],
    ["none", /No runner is reporting/, /^kp — resting:/],
  ] as const)("tells the %s sky in one sentence", (scenario, sentence, kp) => {
    render(hero(0, false, scenario));
    expect(screen.getByTestId("observatory-text").textContent).toMatch(sentence);
    expect(line("acme/kp")).toMatch(kp);
    expect(document.querySelectorAll("[data-comet]")).toHaveLength(0);
  });
});
