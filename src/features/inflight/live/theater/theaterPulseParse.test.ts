// Defensive parsing of the pulse route, and arrival detection — the two things the transport trusts.

import { describe, expect, it } from "vitest";
import { diffArrivals, eventKey, parsePulseResponse } from "./theaterPulseParse";
import { DEMO_EPOCH, DEMO_CYCLE_S, fixturePulse, fixturePulseAt } from "./theaterFixture";
import type { PulseEvent } from "@/lib/local/runner-types";

describe("parsePulseResponse", () => {
  it("accepts a LoopPulse as-is", () => {
    const p = fixturePulse();
    expect(parsePulseResponse(JSON.parse(JSON.stringify(p)))).toEqual({ ok: true, pulse: p });
  });

  it("reads `{ pulse: null }`, a bare null and `{ pulse: <LoopPulse> }` as answers", () => {
    expect(parsePulseResponse({ pulse: null })).toEqual({ ok: true, pulse: null });
    expect(parsePulseResponse(null)).toEqual({ ok: true, pulse: null });
    const p = fixturePulse();
    expect(parsePulseResponse({ pulse: p })).toEqual({ ok: true, pulse: p });
  });

  it("an error body, a string or an array is a FAILED read, not 'nothing running'", () => {
    expect(parsePulseResponse({ error: "boom" })).toEqual({ ok: false });
    expect(parsePulseResponse("<html>")).toEqual({ ok: false });
    expect(parsePulseResponse([])).toEqual({ ok: false });
    expect(parsePulseResponse({ org: "acme" })).toEqual({ ok: false }); // no `at`
  });

  it("a release-behind server's partial pulse fills every gap with its zero instead of crashing", () => {
    const r = parsePulseResponse({ org: "acme", at: "2026-09-18T12:00:00Z", lanes: [{ laneId: "l1", repo: "acme/kp" }, { junk: true }], latest: [{ at: "x", repo: "r", kind: "nope", headline: "h" }] });
    expect(r.ok).toBe(true);
    if (!r.ok || !r.pulse) throw new Error("expected a pulse");
    expect(r.pulse.runner).toBeNull();
    expect(r.pulse.run).toBeNull();
    expect(r.pulse.lanes).toHaveLength(1);
    expect(r.pulse.lanes[0]).toMatchObject({ phase: "queued", tail: [], filesRead: [], filesEdited: [], diffStat: null, planStep: null });
    expect(r.pulse.latest).toEqual([]); // an unknown kind is dropped, never rendered as something it is not
    expect(r.pulse.needsYou).toEqual({ plans: 0, pausedRepos: 0, runnerPaused: false });
    expect(r.pulse.today).toEqual({ verifiedCloses: 0, landed: 0, liftPoints: null, spendMicros: 0 });
  });
});

describe("diffArrivals", () => {
  const e = (at: string, kind: PulseEvent["kind"] = "landed"): PulseEvent => ({ at, repo: "acme/kp", kind, headline: `h ${at}` });

  it("the first read is history: everything is seen, nothing arrives", () => {
    const d = diffArrivals(new Set(), [e("1"), e("2")], true);
    expect(d.arrivals).toEqual([]);
    expect([...d.seen]).toEqual([eventKey(e("1")), eventKey(e("2"))]);
  });

  it("later reads hand over only what is new, once", () => {
    const first = diffArrivals(new Set(), [e("1")], true);
    const second = diffArrivals(first.seen, [e("2"), e("1")], false);
    expect(second.arrivals).toEqual([e("2")]);
    expect(diffArrivals(second.seen, [e("2"), e("1")], false).arrivals).toEqual([]);
  });

  it("the fixture's script produces arrivals over simulated time (the demo has something to celebrate)", () => {
    const at0 = fixturePulseAt(DEMO_EPOCH).latest;
    const later = fixturePulseAt(DEMO_EPOCH + DEMO_CYCLE_S * 1000).latest;
    const d = diffArrivals(diffArrivals(new Set(), at0, true).seen, later, false);
    expect(d.arrivals.map((x) => x.kind)).toEqual(expect.arrayContaining(["landed", "verified-close"]));
    expect(fixturePulseAt(DEMO_EPOCH + 90_500)).toEqual(fixturePulseAt(DEMO_EPOCH + 90_500)); // deterministic
  });
});
