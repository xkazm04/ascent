// @vitest-environment jsdom
//
// The Mission hero against the deterministic demo fixture: one band per active repo with its phase in
// words, the rest of the fleet as rows, the file trail ACCUMULATING across pulses (and saying it is
// "since this screen opened"), a landing's Landed state, and the text alternative.

import { render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { LanePulse, LoopPulse } from "@/lib/local/runner-types";
import { DEMO_EPOCH, fixturePulseAt } from "../../theaterFixture";
import { MissionHero } from "../MissionHero";

const at = (s: number) => DEMO_EPOCH + s * 1000;
const hero = (pulse: LoopPulse, now: number, reducedMotion = false) => <MissionHero pulse={pulse} now={now} reducedMotion={reducedMotion} />;
const band = (laneId: string) => document.querySelector<HTMLElement>(`[data-lane="${laneId}"]`)!;
const word = (laneId: string) => band(laneId).querySelector("[data-phase-word]")?.textContent;

/** Every file a lane's pulse names (window + tail), the way the accumulator reads it. */
function touched(l: LanePulse): string[] {
  const tail = l.tail.filter((e) => e.path && ["read", "edit", "write"].includes(e.kind)).map((e) => e.path!);
  return [...l.filesRead, ...l.filesEdited, ...tail];
}

describe("MissionHero — what it shows", () => {
  it("one band per active repo, the phase in words, the waiting repo as a row", () => {
    render(hero(fixturePulseAt(at(95)), at(95)));
    expect(word("lane-kp")).toBe("Editing");
    expect(word("lane-systedo")).toBe("Planning");
    expect(within(band("lane-kp")).getByText("kp")).toBeInTheDocument();
    const rows = screen.getByRole("list", { name: "The rest of the fleet" });
    expect(within(rows).getByText("web")).toBeInTheDocument();
    expect(within(rows).getByText("Waiting for a run slot")).toBeInTheDocument();
  });

  it("the current stop is lit on the stage track, and the ring is time used — labelled as time", () => {
    render(hero(fixturePulseAt(at(95)), at(95)));
    expect(band("lane-kp").querySelector("[data-now]")?.getAttribute("data-stop")).toBe("agent");
    expect(band("lane-systedo").querySelector("[data-now]")?.getAttribute("data-stop")).toBe("plan");
    const ring = within(band("lane-kp")).getByRole("meter", { hidden: true, name: "kp: time used of the lane's deadline" });
    expect(ring).toHaveAttribute("aria-valuetext", "1:35 of 4:00");
    expect(within(band("lane-kp")).getByText("time used")).toBeInTheDocument();
  });

  it("files are chips — reads cool, edits warm — and the diff is the engine's", () => {
    render(hero(fixturePulseAt(at(95)), at(95)));
    const kp = band("lane-kp");
    expect(kp.querySelector('[data-chip="src/scoring/claims.ts"]')).toHaveAttribute("data-kind", "edit");
    expect(kp.querySelectorAll('[data-kind="read"]').length).toBeGreaterThan(0);
    expect(within(kp).getByText(/files changed/)).toBeInTheDocument();
    expect(within(band("lane-systedo")).getByText("No file touched yet")).toBeInTheDocument();
  });
});

describe("MissionHero — accumulation", () => {
  it("keeps the trail across pulses beyond the bounded window, and says since when", async () => {
    const first = fixturePulseAt(at(40));
    const second = fixturePulseAt(at(58));
    const { rerender } = render(hero(first, at(40)));
    rerender(hero(second, at(58)));
    const kp = (p: LoopPulse) => p.lanes.find((l) => l.laneId === "lane-kp")!;
    const union = new Set([...touched(kp(first)), ...touched(kp(second))]);
    const windowOnly = new Set(touched(kp(second)));
    // The screen now knows more files than the newest pulse carries.
    expect(union.size).toBeGreaterThan(windowOnly.size);
    expect(within(band("lane-kp")).getByText(`${union.size} files · 0 edited — since this screen opened`)).toBeInTheDocument();
    // The strip still shows at most eight, newest first: the chips pushed past it fade out and leave.
    await waitFor(() => expect(band("lane-kp").querySelectorAll("[data-chip]").length).toBeLessThanOrEqual(8));
  });

  it("a session seen from its start says it has the whole session", () => {
    const { rerender } = render(hero(fixturePulseAt(at(8)), at(8)));
    rerender(hero(fixturePulseAt(at(30)), at(30)));
    expect(within(band("lane-kp")).getByText(/— this session$/)).toBeInTheDocument();
  });
});

describe("MissionHero — landing", () => {
  it("a landed event for the repo turns its band Landed, the whole track lit", () => {
    render(hero(fixturePulseAt(at(172)), at(172)));
    const kp = band("lane-kp");
    expect(kp).toHaveAttribute("data-tone", "landed");
    expect(word("lane-kp")).toBe("Landed");
    expect(within(kp).getByText("kp landed run #14")).toBeInTheDocument();
    expect(kp.querySelector("[data-now]")).toBeNull();
    expect(within(kp).getByText("time taken")).toBeInTheDocument();
  });

  it("the next session clears it back to work", () => {
    const { rerender } = render(hero(fixturePulseAt(at(172)), at(172)));
    rerender(hero(fixturePulseAt(at(184)), at(184)));
    expect(band("lane-kp")).toHaveAttribute("data-tone", "working");
    expect(word("lane-kp")).toBe("Planning");
  });
});

describe("MissionHero — text alternative", () => {
  it("summarises every lane and row in one list", () => {
    render(hero(fixturePulseAt(at(95)), at(95)));
    const summary = screen.getByRole("list", { name: "Summary" });
    expect(summary).toHaveClass("sr-only");
    expect(summary).toHaveTextContent(/kp: Editing \(for 35 s\); 1:35 of 4:00 used/);
    expect(summary).toHaveTextContent(/systedo: Planning/);
    expect(summary).toHaveTextContent("web: Waiting for a run slot");
  });
});
