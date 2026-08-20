// The org dashboard window does double duty: it bounds the trend AND fixes the period-over-period
// baseline date. Pin that preset starts snap to a stable CANONICAL-ZONE MIDNIGHT day boundary (not a
// raw wall-clock ms offset that flickers within a day / drifts across DST) and the period cookie
// round-trips.
//
// G4-07: the canonical zone is UTC by default (src/lib/org/timezone.ts). These assertions are
// therefore written against explicit UTC instants and MUST hold in any runner timezone — that is the
// whole point of the policy. The old suite asserted "some local midnight", which passed on a UTC CI
// box and a CET laptop while meaning two different windows.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveWindow, parsePeriodCookie, serializePeriodCookie, inclusiveEnd, DEFAULT_RANGE } from "./window";
import { addDaysInZone, dayKeyInZone, orgTimeZone, partsInZone, zonedMidnight } from "./org/timezone";

// resolveOrgWindow (src/lib/org/period.ts) is server-only: it reads the period cookie via
// next/headers `cookies()`. Mock that boundary so we can drive the cookie value and assert the
// precedence chain. The real (pure) resolveWindow runs underneath — we don't model its date math.
let cookieValue: string | undefined; // the ascent_period cookie the mocked store returns
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (cookieValue === undefined ? undefined : { name, value: cookieValue }) }),
}));

const DAY = 86_400_000;

const NOW = new Date("2026-06-16T14:37:22.500Z"); // 2026-06-16 14:37:22.500 canonical (a mid-afternoon instant)

/** True when `d` is exactly midnight in the CANONICAL org zone (the only frame that matters now). */
const atZoneMidnight = (d: Date | null) => {
  if (d === null) return false;
  const p = partsInZone(d, orgTimeZone());
  return p.hour === 0 && p.minute === 0 && p.second === 0 && d.getTime() % 1000 === 0;
};

describe("resolveWindow — preset starts snap to canonical-zone midnight", () => {
  it("30d start is a canonical-midnight day boundary, not a raw ms offset from now", () => {
    const w = resolveWindow({ range: "30d" }, NOW);
    expect(w.key).toBe("30d");
    expect(atZoneMidnight(w.start)).toBe(true);
  });

  it("90d start is a canonical-midnight day boundary", () => {
    expect(atZoneMidnight(resolveWindow({ range: "90d" }, NOW).start)).toBe(true);
  });

  it("quarter + custom starts are canonical midnight too (ONE reference frame, G4-07)", () => {
    expect(atZoneMidnight(resolveWindow({ range: "quarter" }, NOW).start)).toBe(true);
    expect(atZoneMidnight(resolveWindow({ range: "custom", from: "2026-01-01" }, NOW).start)).toBe(true);
  });

  it("all-time has no baseline; an unknown range falls back to the 90d default", () => {
    expect(resolveWindow({ range: "all" }, NOW).start).toBeNull();
    expect(resolveWindow({ range: "bogus" }, NOW).key).toBe("90d");
  });
});

describe("period cookie round-trip", () => {
  it("round-trips a preset range", () => {
    expect(parsePeriodCookie(serializePeriodCookie({ range: "30d" }))?.range).toBe("30d");
  });

  it("round-trips a custom range with its from/to", () => {
    const parsed = parsePeriodCookie(serializePeriodCookie({ range: "custom", from: "2026-01-01", to: "2026-03-31" }));
    expect(parsed).toMatchObject({ range: "custom", from: "2026-01-01", to: "2026-03-31" });
  });

  it("rejects an empty / unknown cookie", () => {
    expect(parsePeriodCookie(undefined)).toBeNull();
    expect(parsePeriodCookie("nonsense")).toBeNull();
  });
});

// ── Deeper boundary-date pins (test-mastery-2026-06-18, org-overview-standing #2) ───────────────
// The above proves the start is *a* midnight; these pin which *exact* instant, the documented
// half-open `to`-inclusive boundary, render-hour independence, and the malformed-input fallthroughs
// — the precise regressions the module comments warn about (a reverted midnight snap, an off-by-one
// in the cookie validation that accepts an unknown range and silently widens every user's window).

describe("resolveWindow — exact rolling-window start value", () => {
  it("90d start equals canonical midnight of the day 90 CALENDAR days back, not the 14:37 render instant", () => {
    const w = resolveWindow({ range: "90d" }, NOW);
    expect(w.start!.getTime()).toBe(addDaysInZone(NOW, -90).getTime());
    expect(dayKeyInZone(w.start!)).toBe("2026-03-18"); // 90 days before 2026-06-16
    expect(w.end).toBeNull(); // open-ended (now)
    expect(w.endExclusive).toBeNull();
  });

  it("30d start equals canonical midnight of the day 30 calendar days back", () => {
    expect(resolveWindow({ range: "30d" }, NOW).start!.getTime()).toBe(addDaysInZone(NOW, -30).getTime());
    expect(dayKeyInZone(resolveWindow({ range: "30d" }, NOW).start!)).toBe("2026-05-17");
  });

  it("quarter start is the first day of the calendar quarter (June ⇒ Apr 1) at canonical midnight", () => {
    expect(resolveWindow({ range: "quarter" }, NOW).start!.getTime()).toBe(zonedMidnight(2026, 4, 1).getTime());
  });

  it("every render hour of the same canonical day collapses to ONE baseline — including the DST seam", () => {
    // The old `startOfDay(now − 90×86.4M ms)` fixed intra-day flicker but left a DST seam: a flat 90
    // nominal days across a spring-forward boundary landed just before vs just after midnight depending
    // on the render hour, snapping to ADJACENT calendar days. `addDaysInZone` is calendar arithmetic, so
    // the gap is now always 0 — every hour of a given day yields the identical baseline. (G4-07)
    const at = (h: number, m = 0, s = 0) =>
      resolveWindow({ range: "90d" }, new Date(Date.UTC(2026, 5, 16, h, m, s))).start!.getTime();
    const early = at(0, 0, 1);
    const noon = at(12);
    const night = at(23, 59, 59);
    expect(Math.round((night - early) / DAY)).toBe(0);
    expect(noon).toBe(early);
    expect(atZoneMidnight(new Date(early))).toBe(true);
  });

  it("a spring-forward day inside the lookback does not shift the boundary (calendar, not nominal, days)", () => {
    // 2026-03-08 is the US spring-forward date and 2026-03-29 the EU one; both sit inside a 90d lookback
    // from mid-June. Under UTC (the default canonical zone) neither exists, and under an override the
    // calendar arithmetic absorbs them — so the assertion is the same either way: exactly 90 day-keys back.
    const start = resolveWindow({ range: "90d" }, NOW).start!;
    let cursor = start;
    let days = 0;
    while (dayKeyInZone(cursor) !== dayKeyInZone(NOW)) {
      cursor = addDaysInZone(cursor, 1);
      days++;
      if (days > 200) break; // guard against a non-terminating walk
    }
    expect(days).toBe(90);
  });

  it("unknown / missing range both fall back to DEFAULT_RANGE (90d)", () => {
    expect(resolveWindow({ range: "bogus" }, NOW).key).toBe(DEFAULT_RANGE);
    expect(resolveWindow({}, NOW).key).toBe(DEFAULT_RANGE);
  });

  it("reads the first value of an array-shaped param (Next searchParams)", () => {
    expect(resolveWindow({ range: ["quarter", "30d"] }, NOW).key).toBe("quarter");
  });
});

describe("resolveWindow — custom HALF-OPEN boundary [start, endExclusive)", () => {
  it("endExclusive is canonical midnight of the day AFTER `to`; `end` is that minus 1ms", () => {
    const w = resolveWindow({ range: "custom", from: "2026-01-01", to: "2026-03-31" }, NOW);
    expect(w.start!.getTime()).toBe(zonedMidnight(2026, 1, 1).getTime());
    // The canonical bound: the whole of 2026-03-31 is in, 2026-04-01T00:00 is out. (G4-07)
    expect(w.endExclusive!.getTime()).toBe(zonedMidnight(2026, 4, 1).getTime());
    expect(w.end!.getTime()).toBe(w.endExclusive!.getTime() - 1);
    expect(w.from).toBe("2026-01-01");
    expect(w.to).toBe("2026-03-31");
  });

  it("a scan just INSIDE and just OUTSIDE the exclusive end lands on the right side", () => {
    const w = resolveWindow({ range: "custom", from: "2026-01-01", to: "2026-03-31" }, NOW);
    const lastInstantIn = new Date(w.endExclusive!.getTime() - 1);
    const firstInstantOut = w.endExclusive!;
    expect(lastInstantIn.getTime() < w.endExclusive!.getTime()).toBe(true);
    expect(dayKeyInZone(lastInstantIn)).toBe("2026-03-31");
    expect(firstInstantOut.getTime() < w.endExclusive!.getTime()).toBe(false);
    expect(dayKeyInZone(firstInstantOut)).toBe("2026-04-01");
    // …and the same instants against the `lte: end` compat bound must agree with `lt: endExclusive`.
    expect(lastInstantIn.getTime() <= w.end!.getTime()).toBe(true);
    expect(firstInstantOut.getTime() <= w.end!.getTime()).toBe(false);
  });

  it("the start bound is INCLUSIVE — a scan exactly at midnight of `from` is inside the window", () => {
    const w = resolveWindow({ range: "custom", from: "2026-01-01", to: "2026-03-31" }, NOW);
    const exactlyStart = zonedMidnight(2026, 1, 1);
    expect(exactlyStart.getTime() >= w.start!.getTime()).toBe(true);
    const oneMsBefore = new Date(w.start!.getTime() - 1);
    expect(oneMsBefore.getTime() >= w.start!.getTime()).toBe(false);
    expect(dayKeyInZone(oneMsBefore)).toBe("2025-12-31");
  });

  it("custom with no `to` is open-ended (end + endExclusive null); a blank/invalid `from` ⇒ null start, no comparison", () => {
    const open = resolveWindow({ range: "custom", from: "2026-01-01" }, NOW);
    expect(open.end).toBeNull();
    expect(open.endExclusive).toBeNull();
    expect(open.comparisonLabel).toBe("vs range start");

    const bad = resolveWindow({ range: "custom", from: "not-a-date" }, NOW);
    expect(bad.start).toBeNull();
    expect(bad.comparisonLabel).toBe("");
  });

  it("an out-of-range date literal is rejected rather than silently rolling over (2026-02-31)", () => {
    // `new Date("2026-02-31T00:00:00")` used to yield Mar 3 — a typo'd bound silently widened the window.
    expect(resolveWindow({ range: "custom", from: "2026-02-31" }, NOW).start).toBeNull();
    expect(resolveWindow({ range: "custom", from: "2026-13-01" }, NOW).start).toBeNull();
  });

  it("a reversed range (from > to) is SWAPPED into a coherent period, not start > end", () => {
    // Without the guard, start > end → the trend query matches nothing (blank dashboard) while the
    // baseline (lt: start) returns an incoherent pre-start snapshot. Swap keeps both dates, ordered.
    const w = resolveWindow({ range: "custom", from: "2026-03-31", to: "2026-01-01" }, NOW);
    expect(w.start!.getTime()).toBe(zonedMidnight(2026, 1, 1).getTime());
    expect(w.endExclusive!.getTime()).toBe(zonedMidnight(2026, 4, 1).getTime());
    expect(w.start!.getTime()).toBeLessThan(w.end!.getTime());
    expect(w.from).toBe("2026-01-01");
    expect(w.to).toBe("2026-03-31");
    // The swap is silent — the title must confirm the FINAL bounds so the correction is visible.
    expect(w.title).toBe("2026-01-01 → 2026-03-31");
  });

  it("a custom range's title echoes the resolved dates (never the opaque 'Custom range' literal)", () => {
    // A shared link / remembered cookie shows deltas scoped to a window the preset titles would name;
    // custom alone has parameters worth echoing back — an unknowable window invites wrong conclusions.
    const closed = resolveWindow({ range: "custom", from: "2026-01-01", to: "2026-03-31" }, NOW);
    expect(closed.title).toBe("2026-01-01 → 2026-03-31");
    expect(closed.reviewTitle).toBe("2026-01-01 → 2026-03-31 in review");

    const open = resolveWindow({ range: "custom", from: "2026-01-01" }, NOW);
    expect(open.title).toBe("2026-01-01 → now");

    // No parseable start = nothing to echo; the generic label is the honest fallback.
    const bad = resolveWindow({ range: "custom", from: "not-a-date" }, NOW);
    expect(bad.title).toBe("Custom range");
    expect(bad.reviewTitle).toBe("Range in review");
  });
});

describe("parsePeriodCookie — malformed-input fallthrough and round-trip into resolveWindow", () => {
  it("preset round-trip yields explicit undefined from/to", () => {
    expect(parsePeriodCookie(serializePeriodCookie({ range: "30d" }))).toEqual({
      range: "30d",
      from: undefined,
      to: undefined,
    });
  });

  it("custom round-trip drives resolveWindow to the same half-open window", () => {
    const cookie = serializePeriodCookie({ range: "custom", from: "2026-01-01", to: "2026-03-31" });
    const w = resolveWindow(parsePeriodCookie(cookie)!, NOW);
    expect(w.key).toBe("custom");
    expect(w.endExclusive!.getTime()).toBe(zonedMidnight(2026, 4, 1).getTime());
    expect(w.end!.getTime()).toBe(w.endExclusive!.getTime() - 1);
  });

  it("empty custom parts normalize to undefined (not empty strings)", () => {
    expect(parsePeriodCookie("custom||")).toEqual({ range: "custom", from: undefined, to: undefined });
  });

  it("an unknown range key — even with extra pipe parts — returns null (no silent widen/reset)", () => {
    expect(parsePeriodCookie("180d|foo|bar")).toBeNull();
    expect(parsePeriodCookie("|2026-01-01|2026-03-31")).toBeNull(); // missing range key
    expect(parsePeriodCookie("")).toBeNull();
  });
});

// ── resolveOrgWindow precedence chain (test-mastery-2026-06-18, org-overview-standing) ───────────
// Lock the canonical org-window precedence so a refactor can't silently swap "?range over cookie"
// for "cookie over ?range" (which would make a shared link's range silently reset to the viewer's
// remembered period). period.ts pins: an explicit ?range is authoritative; with NO ?range the
// remembered cookie wins; with neither, the default. The function short-circuits the cookie read
// whenever sp.range is truthy — so the cookie is only ever consulted when ?range is ABSENT.
describe("resolveOrgWindow — precedence: ?range > cookie > default", () => {
  // Imported lazily AFTER the next/headers mock is registered.
  let resolveOrgWindow: typeof import("./org/period").resolveOrgWindow;

  beforeEach(async () => {
    cookieValue = undefined; // each test sets the remembered-period cookie it needs
    ({ resolveOrgWindow } = await import("./org/period"));
  });

  // 1. ?range present and valid ⇒ wins over the cookie (shared URLs stay authoritative).
  it("a valid ?range WINS over a conflicting cookie", async () => {
    cookieValue = "90d"; // remembered period says 90d…
    const w = await resolveOrgWindow({ range: "30d" }); // …but the URL says 30d
    expect(w.key).toBe("30d"); // the URL wins
  });

  it("a valid ?range wins even when there is NO cookie at all", async () => {
    cookieValue = undefined;
    expect((await resolveOrgWindow({ range: "quarter" })).key).toBe("quarter");
  });

  it("the ?range carries its own custom from/to through (cookie not consulted)", async () => {
    cookieValue = "30d"; // would resolve to 30d if it leaked through — it must NOT
    const w = await resolveOrgWindow({ range: "custom", from: "2026-01-01", to: "2026-03-31" });
    expect(w.key).toBe("custom");
    expect(w.from).toBe("2026-01-01");
    expect(w.to).toBe("2026-03-31");
  });

  // 2. NO ?range + a valid cookie ⇒ the cookie wins over the default.
  it("with NO ?range, a valid cookie WINS over the default", async () => {
    cookieValue = "30d";
    expect((await resolveOrgWindow({})).key).toBe("30d"); // not the 90d default
  });

  it("with NO ?range, a custom cookie round-trips its from/to into the window", async () => {
    cookieValue = serializePeriodCookie({ range: "custom", from: "2026-01-01", to: "2026-03-31" });
    const w = await resolveOrgWindow({});
    expect(w.key).toBe("custom");
    expect(w.from).toBe("2026-01-01");
    expect(w.to).toBe("2026-03-31");
  });

  // 3. Neither ?range nor a usable cookie ⇒ the default range.
  it("with neither ?range nor cookie, falls back to the DEFAULT_RANGE", async () => {
    cookieValue = undefined;
    expect((await resolveOrgWindow({})).key).toBe(DEFAULT_RANGE);
  });

  it("an unparseable cookie (no ?range) is ignored ⇒ default, not a crash", async () => {
    cookieValue = "totally-bogus-cookie"; // parsePeriodCookie → null
    expect((await resolveOrgWindow({})).key).toBe(DEFAULT_RANGE);
  });

  // 4. An INVALID ?range short-circuits the cookie (sp.range is truthy) and falls to the DEFAULT —
  //    it does NOT fall through to the cookie. Pinning the ACTUAL code: the cookie is read only when
  //    sp.range is falsy, so a present-but-invalid range never consults the remembered period.
  it("an INVALID ?range falls to the default, NOT the cookie (truthy sp.range skips the cookie read)", async () => {
    cookieValue = "30d"; // a valid remembered period that must NOT be picked up here
    const w = await resolveOrgWindow({ range: "bogus" });
    expect(w.key).toBe(DEFAULT_RANGE); // default, not 30d
    expect(w.key).not.toBe("30d"); // the cookie was bypassed by the truthy ?range
  });

  it("an array-shaped ?range (Next searchParams) is still treated as present ⇒ cookie bypassed", async () => {
    cookieValue = "30d";
    // sp.range is a non-empty array (truthy) ⇒ cookie skipped; resolveWindow reads its first element.
    const w = await resolveOrgWindow({ range: ["quarter", "90d"] });
    expect(w.key).toBe("quarter");
  });
});

// ── The inclusive bound has exactly ONE producer (G4-07 / inclusive-end-alias) ─────────────────────
//
// A window value carries ONE closure convention: half-open `[start, endExclusive)`. The inclusive last
// instant used to be an `endExclusive − 1ms` alias every consumer re-derived, so two surfaces reading
// the same window could disagree about a boundary row depending on which field their query builder
// happened to reach for. It is now produced by one adapter at the edge that needs it, and these pin
// that the adapter is the ONLY conversion: `end` must be exactly `inclusiveEnd(endExclusive)`, never a
// second, independently-computed bound.
describe("inclusiveEnd — the single edge adapter between half-open and `lte`", () => {
  it("the window's compat `end` IS the adapter's output — no second derivation", () => {
    const w = resolveWindow({ range: "custom", from: "2026-01-01", to: "2026-03-31" }, NOW);
    expect(w.end!.getTime()).toBe(inclusiveEnd(w.endExclusive)!.getTime());
  });

  it("every preset agrees: `end` is the adapter applied to that preset's `endExclusive`", () => {
    for (const range of ["30d", "90d", "quarter", "all", "custom"] as const) {
      const w = resolveWindow({ range, from: "2026-01-01", to: "2026-03-31" }, NOW);
      expect(w.end).toEqual(inclusiveEnd(w.endExclusive));
    }
  });

  it("an open-ended window converts to null, not to an epoch instant", () => {
    // The failure this guards: `new Date(null - 1)` is 1969-12-31, which as an `lte` bound matches
    // nothing — an open window would silently render as an empty period rather than "up to now".
    expect(inclusiveEnd(null)).toBeNull();
    expect(resolveWindow({ range: "custom", from: "2026-01-01" }, NOW).end).toBeNull();
  });

  it("the 1ms gap is real and confined to the adapter — a sub-millisecond row is why `lt` is preferred", () => {
    const w = resolveWindow({ range: "custom", from: "2026-01-01", to: "2026-03-31" }, NOW);
    const end = inclusiveEnd(w.endExclusive)!;
    // The store keeps MICROSECOND timestamps; JS Date cannot represent one, so model it as the
    // fractional instant 0.5ms before the exclusive bound. `lt: endExclusive` keeps it; `lte: end`
    // drops it. That divergence is the whole reason the inclusive dialect lives behind one adapter.
    const subMs = w.endExclusive!.getTime() - 0.5;
    expect(subMs < w.endExclusive!.getTime()).toBe(true);
    expect(subMs <= end.getTime()).toBe(false);
    expect(w.endExclusive!.getTime() - end.getTime()).toBe(1);
  });
});

// ── orgWindowBounds — the half-open shape handed to the db layer ───────────────────────────────────
// Every org tab hand-wrote `{ start: period.start, end: period.end }`, which is how the inclusive
// dialect spread from one deprecated field into a dozen query builders. This is the named migration
// target: it must carry the half-open bound and must NOT carry an inclusive one.
describe("orgWindowBounds — one closure convention crosses into the db layer", () => {
  let orgWindowBounds: typeof import("./org/period").orgWindowBounds;

  beforeEach(async () => {
    ({ orgWindowBounds } = await import("./org/period"));
  });

  it("carries start + endExclusive and NO inclusive `end` key at all", () => {
    const w = resolveWindow({ range: "custom", from: "2026-01-01", to: "2026-03-31" }, NOW);
    const bounds = orgWindowBounds(w);
    expect(bounds).toEqual({ start: w.start, endExclusive: w.endExclusive });
    expect(Object.keys(bounds).sort()).toEqual(["endExclusive", "start"]);
    expect("end" in bounds).toBe(false);
  });

  it("passes an open-ended window through as nulls (no bound invented)", () => {
    const bounds = orgWindowBounds(resolveWindow({ range: "all" }, NOW));
    expect(bounds).toEqual({ start: null, endExclusive: null });
  });
});
