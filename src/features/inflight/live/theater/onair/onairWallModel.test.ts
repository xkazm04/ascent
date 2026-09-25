// The wall's words beyond the lanes: why a slot is empty, the CALL corner's detail, the small
// monitors' states, the wire's rows, and the slates the cue budget allows.

import { describe, expect, it } from "vitest";
import type { PulseEvent } from "@/lib/local/runner-types";
import type { TheaterCue } from "../theaterCues";
import { eventKey } from "../theaterPulseParse";
import { DEMO_EPOCH, fixturePulse, fixturePulseAt, fixtureRunner } from "../theaterFixture";
import { blankCard, needsDetail } from "./onairBlank";
import { smallItems } from "./onairSmallsModel";
import { slatesFrom, verifiedLine, wireRows } from "./onairWireModel";

const iso = (s: number) => new Date(DEMO_EPOCH + s * 1000).toISOString();
const clock = DEMO_EPOCH;

describe("blankCard", () => {
  it("says HELD, why and until when on a paused runner", () => {
    const b = blankCard(fixturePulseAt(clock, "paused-session"), clock, "program");
    expect(b).toMatchObject({ tone: "amber", big: "HELD", src: "program · no lane dispatched" });
    expect(b.lines[0]).toBe("Runner paused · session limit");
    expect(b.lines[1]).toMatch(/^until \d\d:\d\d · resumes in 2 h$/);
  });

  it("says IDLE with the next wake, NO RUNNER without one, STANDBY with how many lanes fly", () => {
    expect(blankCard(fixturePulseAt(clock, "idle"), clock, "preview 1")).toMatchObject({
      big: "IDLE",
      lines: ["Every repo is resting", expect.stringMatching(/in 40 m$/)],
    });
    expect(blankCard(fixturePulse({ runner: null }), clock, "program").big).toBe("NO RUNNER");
    expect(blankCard(fixturePulse(), clock, "preview 2")).toMatchObject({ big: "STANDBY", lines: ["No lane in this slot", "run #14 flies 1 lane"] });
    expect(blankCard(fixturePulse({ runner: fixtureRunner({ phase: "stopped" }) }), clock, "p").big).toBe("STOPPED");
  });
});

describe("needsDetail", () => {
  it("names the newest pending plan while plans wait, else when the pause lifts", () => {
    const p = fixturePulseAt(DEMO_EPOCH + 320_000);
    expect(needsDetail(p, clock, true)).toBe("web: a plan splits the api module · decide it in the ledger");
    expect(needsDetail(p, clock, false)).toMatch(/decided in the ledger$/);
    expect(needsDetail(fixturePulseAt(clock, "paused-session"), clock, true)).toMatch(/^until \d\d:\d\d · resumes in 2 h$/);
  });
});

describe("smallItems", () => {
  it("lists every repo not on a monitor, with its most urgent true state", () => {
    const p = fixturePulseAt(DEMO_EPOCH + 320_000);
    const { items, cols } = smallItems(p, new Set(["acme/kp", "acme/systedo"]));
    expect(items.map((i) => [i.name, i.state, i.tone])).toEqual([["web", "PLAN NEEDS YOU", "amber"]]);
    expect(items[0]!.sub).toBe("a plan splits the api module");
    expect(cols).toBe(4);
  });

  it("holds every repo on a paused runner, and marks a repo resting on its own breaker", () => {
    expect(smallItems(fixturePulseAt(clock, "paused-spend"), new Set()).items.every((i) => i.state === "HELD")).toBe(true);
    const idle = smallItems(fixturePulseAt(clock, "idle"), new Set()).items;
    expect(idle.find((i) => i.name === "kp")).toMatchObject({ state: "HELD", sub: expect.stringMatching(/^dry backoff · until/) });
    expect(idle.find((i) => i.name === "systedo")?.state).toBe("RESTING");
  });

  it("a working lane the big monitors had no room for shows its phase", () => {
    const p = fixturePulseAt(DEMO_EPOCH + 40_000);
    expect(smallItems(p, new Set(["acme/systedo"])).items.find((i) => i.name === "kp")?.state).toBe("READING");
  });
});

describe("wire and slates", () => {
  const landed: PulseEvent = { at: iso(170), repo: "acme/kp", kind: "landed", headline: "kp landed run #14" };
  const close: PulseEvent = { at: iso(170), repo: "acme/kp", kind: "verified-close", headline: "kp closed D4 · cited claims" };
  const pulse = fixturePulse({ at: iso(172), latest: [landed, close, { at: iso(-3600), repo: "acme/web", kind: "failed", headline: "web failed" }] });
  const cue = (kind: TheaterCue["kind"], events: PulseEvent[]): TheaterCue => ({ id: "cue-1", kind, headline: "x", detail: null, events });

  it("rows carry the kind word, tone, freshness (arrived while open) and age", () => {
    const rows = wireRows(pulse, new Set([eventKey(landed)]));
    expect(rows.map((r) => [r.word, r.tone, r.fresh, r.old])).toEqual([
      ["LANDED", "good", true, false],
      ["VERIFIED", "good", false, false],
      ["FAILED", "bad", false, true],
    ]);
  });

  it("a slate comes only from a celebrate cue, labelled with the close that landed with it", () => {
    const slates = slatesFrom([cue("celebrate", [landed])], pulse);
    expect(slates.get("acme/kp")).toMatchObject({ headline: "kp landed run #14", label: "D4 · cited claims" });
    expect(verifiedLine(slates)).toBe("+1 verified · kp · D4 · cited claims");
    // A cue that speaks as attention (a person is needed) never becomes a landing slate.
    expect(slatesFrom([cue("attention", [landed])], pulse).size).toBe(0);
  });
});
