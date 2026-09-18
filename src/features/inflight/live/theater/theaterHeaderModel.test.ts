// The four answers, per runner state — the part of the theater everyone reads from three metres, so
// every state is pinned here without a renderer: running / paused on spend / paused on session limit /
// idle / no runner / stale / not yet connected, and the needs-you amber rule.

import { describe, expect, it } from "vitest";
import { DEMO_EPOCH, fixtureLane, fixturePulse, fixturePulseAt, fixtureRunner } from "./theaterFixture";
import { busiestLane, headerModel, lastTouched, type HeaderInput } from "./theaterHeaderModel";
import { fmtClock } from "./theaterFormat";
import { lanePhaseLabel } from "@/lib/local/lane-phase";

const base = (o: Partial<HeaderInput> = {}): HeaderInput => ({
  pulse: fixturePulse(),
  loaded: true,
  stale: false,
  clock: DEMO_EPOCH,
  heardAgoMs: 1_000,
  error: null,
  ledgerHref: "/org/acme?tab=live&view=ledger",
  ...o,
});

describe("RUNNING?", () => {
  it("running: one word, the live-dot, uptime, run #seq and cycle c/m", () => {
    const m = headerModel(base());
    expect(m.running).toMatchObject({ headline: "Running", live: true, tone: "live" });
    expect(m.running.sub).toBe("up 3 h 12 m · run #14 · cycle 2/3");
  });

  it("paused on the spend ceiling names the breaker and when it lifts (local midnight)", () => {
    const m = headerModel(base({ pulse: fixturePulseAt(DEMO_EPOCH, "paused-spend") }));
    expect(m.running.headline).toBe("Paused — spend ceiling until 00:00");
    expect(m.running.live).toBe(false);
    expect(m.running.tone).toBe("warn");
  });

  it("paused on the session limit says until when", () => {
    const until = new Date(DEMO_EPOCH + 2 * 3_600_000).toISOString();
    const m = headerModel(base({ pulse: fixturePulseAt(DEMO_EPOCH, "paused-session") }));
    expect(m.running.headline).toBe(`Paused — session limit until ${fmtClock(until)}`);
  });

  it("idle names the next repo's wake-up time, and says so honestly when none is due", () => {
    const wake = fmtClock(new Date(DEMO_EPOCH + 40 * 60_000).toISOString());
    expect(headerModel(base({ pulse: fixturePulseAt(DEMO_EPOCH, "idle") })).running.headline).toBe(`Idle — next repo wakes at ${wake}`);
    const noneDue = fixturePulse({ runner: fixtureRunner({ phase: "idle", repos: [] }), run: null, lanes: [] });
    expect(headerModel(base({ pulse: noneDue })).running.headline).toBe("Idle — every repo is resting");
  });

  it("no runner (a null pulse or a pulse without one) is plainly 'No runner'", () => {
    expect(headerModel(base({ pulse: null })).running).toMatchObject({ headline: "No runner", live: false });
    expect(headerModel(base({ pulse: fixturePulseAt(DEMO_EPOCH, "none") })).running.headline).toBe("No runner");
  });

  it("stopped and errored runners are not dressed up as live", () => {
    expect(headerModel(base({ pulse: fixturePulse({ runner: fixtureRunner({ phase: "stopped" }) }) })).running).toMatchObject({ headline: "Stopped", live: false });
    expect(headerModel(base({ pulse: fixturePulse({ runner: fixtureRunner({ phase: "error" }) }) })).running.tone).toBe("danger");
  });
});

describe("NOW", () => {
  it("the busiest lane: repo · phase words + the file it last touched", () => {
    const m = headerModel(base());
    // The words come from the ONE phase vocabulary (lane-phase.ts), whatever it says today.
    expect(m.now.headline).toBe(`kp · ${lanePhaseLabel("agent-editing", null)}`);
    expect(m.now.path).toBe("src/scoring/claims.ts");
    expect(m.now.sub).toBe("step 2 of 4 · for 1 m");
  });

  it("between runs / waiting for a slot / holding — as the pulse says, never an invented activity", () => {
    const waiting = fixturePulse({ lanes: [], waiting: ["acme/web", "acme/kp"] });
    expect(headerModel(base({ pulse: waiting })).now).toMatchObject({ headline: "Waiting for a run slot", sub: "web, kp" });
    const between = fixturePulse({ run: null, lanes: [] });
    expect(headerModel(base({ pulse: between })).now).toMatchObject({ headline: "Between runs", sub: "Preparing the next run" });
    expect(headerModel(base({ pulse: fixturePulseAt(DEMO_EPOCH, "paused-spend") })).now.headline).toBe("Holding");
  });

  it("picks the working lane with the newest evidence; queued/done/held lanes are never 'now'", () => {
    const old = fixtureLane({ laneId: "a", repo: "acme/a", heartbeatAt: new Date(DEMO_EPOCH - 60_000).toISOString(), tail: [] });
    const fresh = fixtureLane({ laneId: "b", repo: "acme/b", heartbeatAt: new Date(DEMO_EPOCH).toISOString(), tail: [] });
    const done = fixtureLane({ laneId: "c", phase: "done", heartbeatAt: new Date(DEMO_EPOCH + 5_000).toISOString() });
    expect(busiestLane([old, fresh, done])?.laneId).toBe("b");
    expect(busiestLane([done, fixtureLane({ phase: "queued" })])).toBeNull();
    expect(lastTouched(fixtureLane({ tail: [], filesEdited: ["x.ts"] }))).toBe("x.ts");
  });
});

describe("TODAY", () => {
  it("counts, spend of ceiling as a ratio, no 'as of' while fresh", () => {
    expect(headerModel(base()).today).toEqual({ verified: "9", landed: "4", spend: "$12.40", ceiling: "$100.00", ratio: 0.124, asOf: null });
  });

  it("no ceiling reads as none, not as a full meter", () => {
    const m = headerModel(base({ pulse: fixturePulse({ runner: fixtureRunner({ spendCeilingMicros: null }) }) }));
    expect(m.today.ceiling).toBeNull();
    expect(m.today.ratio).toBeNull();
  });
});

describe("NEEDS YOU", () => {
  it("neutral when nothing waits", () => {
    expect(headerModel(base()).needs).toMatchObject({ headline: "Nothing waiting", amber: false, href: null });
  });

  it("amber with the count and the ledger link when plans or paused repos wait", () => {
    const p = fixturePulse({ needsYou: { plans: 2, pausedRepos: 1, runnerPaused: false } });
    expect(headerModel(base({ pulse: p })).needs).toMatchObject({ amber: true, count: 3, headline: "2 plans wait · 1 repo paused", href: "/org/acme?tab=live&view=ledger" });
  });

  it("a paused runner alone turns it amber; the kiosk gets no link", () => {
    const m = headerModel(base({ pulse: fixturePulseAt(DEMO_EPOCH, "paused-spend"), ledgerHref: null }));
    expect(m.needs).toMatchObject({ amber: true, count: 1, headline: "Runner paused", href: null });
  });
});

describe("staleness honesty", () => {
  it("EVERY liveness claim switches: Reconnecting…, Last heard, no dot, history labelled 'as of'", () => {
    const m = headerModel(base({ stale: true, heardAgoMs: 42_000 }));
    expect(m.running).toMatchObject({ headline: "Reconnecting…", live: false, sub: "Last heard 42 s ago · was Running" });
    expect(m.now.headline).toBe("Last heard 42 s ago");
    expect(m.now.path).toBeNull();
    expect(m.today.asOf).toBe("as of 42 s ago");
  });

  it("before the first answer: Connecting…, then Reconnecting… with the reason", () => {
    expect(headerModel(base({ loaded: false, pulse: null })).running.headline).toBe("Connecting…");
    const m = headerModel(base({ loaded: false, pulse: null, stale: true, error: "No access to this organization" }));
    expect(m.running).toMatchObject({ headline: "Reconnecting…", sub: "No access to this organization", live: false });
  });
});
