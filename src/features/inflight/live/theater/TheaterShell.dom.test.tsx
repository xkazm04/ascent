// @vitest-environment jsdom
//
// The theater end to end on fake timers, for celebrations and sound: a landing that ARRIVES while the
// page is open plays the card once (the first load plays nothing), a plan-pending plays the attention
// card, and a tone plays only after a user gesture unlocked audio — `?sound=1` merely arms it and says so.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEATER_PULSE_MS, type PulseEvent } from "@/lib/local/runner-types";
import { CELEBRATION_MS } from "@/components/org/shared/liveWarRoomShared";
import { fixturePulse } from "./theaterFixture";

const sound = vi.hoisted(() => ({ playCue: vi.fn(), unlockAudio: vi.fn(() => true), lockAudio: vi.fn() }));
vi.mock("./theaterSound", () => sound);

const { TheaterShell } = await import("./TheaterShell");

let bodies: unknown[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-18T12:00:00Z"));
  sound.playCue.mockClear();
  sound.unlockAudio.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const body = bodies.length > 1 ? bodies.shift() : bodies[0];
      return { ok: true, status: 200, json: async () => body } as Response;
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
// A cue is shown from a 0 ms timer armed by the read that delivered it — one more millisecond lets it run.
const tickAndCue = async (ms: number) => {
  await advance(ms);
  await advance(1);
};
const base = fixturePulse();
const landed: PulseEvent = { at: "2026-09-18T12:00:03.000Z", repo: "acme/kp", kind: "landed", headline: "kp landed run #15" };
const pending: PulseEvent = { at: "2026-09-18T12:00:04.000Z", repo: "acme/web", kind: "plan-pending", headline: "web: a plan waits" };
const withEvents = (...e: PulseEvent[]) => ({ ...base, latest: [...e, ...base.latest] });

describe("TheaterShell — celebrations and cues", () => {
  it("the first load is history: nothing celebrates, however many landings it lists", async () => {
    bodies = [withEvents(landed)];
    render(<TheaterShell source={{ kind: "org", slug: "acme" }} />);
    await advance(THEATER_PULSE_MS * 4);
    expect(document.querySelector("[data-cue]")).toBeNull();
  });

  it("a landing that arrives while the page is open plays the card once, then it leaves", async () => {
    bodies = [base, withEvents(landed)];
    render(<TheaterShell source={{ kind: "org", slug: "acme" }} />);
    await advance(0);
    expect(document.querySelector("[data-cue]")).toBeNull();
    await tickAndCue(THEATER_PULSE_MS);
    expect(document.querySelectorAll('[data-cue="celebrate"]')).toHaveLength(1);
    expect(screen.getAllByText("kp landed run #15").length).toBeGreaterThan(0);
    await advance(CELEBRATION_MS + THEATER_PULSE_MS * 3);
    expect(document.querySelector("[data-cue]")).toBeNull(); // re-delivered, never replayed
    expect(sound.playCue).not.toHaveBeenCalled(); // sound was never turned on
  });

  it("a plan-pending arrival plays the distinct attention card", async () => {
    bodies = [base, withEvents(pending)];
    render(<TheaterShell source={{ kind: "org", slug: "acme" }} />);
    await tickAndCue(THEATER_PULSE_MS);
    expect(document.querySelector('[data-cue="attention"]')).toHaveTextContent("web: a plan waits");
  });

  it("?sound=1 only ARMS sound and says so; a click anywhere unlocks it; then cues are heard", async () => {
    bodies = [base, base, withEvents(landed)];
    render(<TheaterShell source={{ kind: "org", slug: "acme" }} soundPreselect />);
    expect(screen.getByRole("button", { name: "Sound: click anywhere to turn it on" })).toBeInTheDocument();
    expect(sound.unlockAudio).not.toHaveBeenCalled();
    await act(async () => fireEvent.pointerDown(document.body));
    expect(sound.unlockAudio).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Sound on" })).toBeInTheDocument();
    await tickAndCue(THEATER_PULSE_MS * 2);
    expect(sound.playCue).toHaveBeenCalledWith("celebrate");
  });

  it("without the unlock no tone plays, even with sound preselected", async () => {
    bodies = [base, withEvents(landed)];
    render(<TheaterShell source={{ kind: "org", slug: "acme" }} soundPreselect />);
    await tickAndCue(THEATER_PULSE_MS * 2);
    expect(document.querySelector('[data-cue="celebrate"]')).not.toBeNull();
    expect(sound.playCue).not.toHaveBeenCalled();
  });

  it("the sound toggle turns it on from a click on the toggle itself, and off again", async () => {
    bodies = [base];
    render(<TheaterShell source={{ kind: "org", slug: "acme" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Sound off" }));
    expect(screen.getByRole("button", { name: "Sound on" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sound on" }));
    expect(screen.getByRole("button", { name: "Sound off" })).toBeInTheDocument();
    expect(sound.lockAudio).toHaveBeenCalled();
  });
});
