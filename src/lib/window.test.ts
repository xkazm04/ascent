// The org dashboard window does double duty: it bounds the trend AND fixes the period-over-period
// baseline date. Pin that preset starts snap to a stable LOCAL-MIDNIGHT day boundary (not a raw
// wall-clock ms offset that flickers within a day / drifts across DST) and the period cookie round-trips.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveWindow, parsePeriodCookie, serializePeriodCookie, DEFAULT_RANGE } from "./window";

// resolveOrgWindow (src/lib/org/period.ts) is server-only: it reads the period cookie via
// next/headers `cookies()`. Mock that boundary so we can drive the cookie value and assert the
// precedence chain. The real (pure) resolveWindow runs underneath — we don't model its date math.
let cookieValue: string | undefined; // the ascent_period cookie the mocked store returns
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (cookieValue === undefined ? undefined : { name, value: cookieValue }) }),
}));

const DAY = 86_400_000;

const NOW = new Date(2026, 5, 16, 14, 37, 22, 500); // local 2026-06-16 14:37:22.500 (a mid-afternoon instant)
const atLocalMidnight = (d: Date | null) =>
  d !== null && d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0;

describe("resolveWindow — preset starts snap to local midnight", () => {
  it("30d start is a local-midnight day boundary, not a raw ms offset from now", () => {
    const w = resolveWindow({ range: "30d" }, NOW);
    expect(w.key).toBe("30d");
    expect(atLocalMidnight(w.start)).toBe(true);
  });

  it("90d start is a local-midnight day boundary", () => {
    expect(atLocalMidnight(resolveWindow({ range: "90d" }, NOW).start)).toBe(true);
  });

  it("quarter + custom starts are local midnight too (consistent reference frame)", () => {
    expect(atLocalMidnight(resolveWindow({ range: "quarter" }, NOW).start)).toBe(true);
    expect(atLocalMidnight(resolveWindow({ range: "custom", from: "2026-01-01" }, NOW).start)).toBe(true);
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
  it("90d start equals local midnight of (now − 90d), not the 14:37 render instant", () => {
    const w = resolveWindow({ range: "90d" }, NOW);
    const raw = new Date(NOW.getTime() - 90 * DAY);
    const expected = new Date(raw.getFullYear(), raw.getMonth(), raw.getDate());
    expect(w.start!.getTime()).toBe(expected.getTime());
    expect(w.end).toBeNull(); // open-ended (now)
  });

  it("30d start equals local midnight of (now − 30d)", () => {
    const raw = new Date(NOW.getTime() - 30 * DAY);
    const expected = new Date(raw.getFullYear(), raw.getMonth(), raw.getDate());
    expect(resolveWindow({ range: "30d" }, NOW).start!.getTime()).toBe(expected.getTime());
  });

  it("quarter start is the first day of the calendar quarter (June ⇒ Apr 1) at local midnight", () => {
    expect(resolveWindow({ range: "quarter" }, NOW).start!.getTime()).toBe(new Date(2026, 3, 1).getTime());
  });

  it("most same-day renders collapse to one baseline (noon == night), and the start is always a midnight", () => {
    // The midnight snap removes the WITHIN-day flicker a raw ms-instant baseline had: a noon render and
    // a one-second-before-midnight render on the same calendar day resolve to the identical start.
    const noon = resolveWindow({ range: "90d" }, new Date(2026, 5, 16, 12, 0, 0));
    const night = resolveWindow({ range: "90d" }, new Date(2026, 5, 16, 23, 59, 59));
    expect(noon.start!.getTime()).toBe(night.start!.getTime());
    expect(atLocalMidnight(noon.start)).toBe(true);
  });

  it("KNOWN DST EDGE: when the 90d lookback straddles a DST transition, a very-early render can still shift the baseline one calendar day — pinned as current behavior", () => {
    // The snap fixes intra-day flicker but NOT the residual DST seam: `startOfDay(now − 90*DAY)` subtracts
    // a flat 90×86.4M ms, so when the lookback crosses a spring-forward boundary the resulting wall-clock
    // can land just before vs just after local midnight depending on the render hour, snapping to adjacent
    // days. This asserts the actual behavior (so it is a deliberate, test-breaking change to "fix"), and is
    // tz-dependent — only meaningful where the lookback crosses a transition; elsewhere both renders agree.
    const early = resolveWindow({ range: "90d" }, new Date(2026, 5, 16, 0, 0, 1)).start!.getTime();
    const night = resolveWindow({ range: "90d" }, new Date(2026, 5, 16, 23, 59, 59)).start!.getTime();
    const gapDays = Math.round((night - early) / DAY);
    // 0 in a no-DST tz (e.g. UTC runner); 1 across a spring-forward seam (e.g. CET→CEST). Never > 1.
    expect([0, 1]).toContain(gapDays);
    // Whatever the seam does, BOTH ends remain clean local midnights — the snap invariant holds.
    expect(atLocalMidnight(new Date(early))).toBe(true);
    expect(atLocalMidnight(new Date(night))).toBe(true);
  });

  it("unknown / missing range both fall back to DEFAULT_RANGE (90d)", () => {
    expect(resolveWindow({ range: "bogus" }, NOW).key).toBe(DEFAULT_RANGE);
    expect(resolveWindow({}, NOW).key).toBe(DEFAULT_RANGE);
  });

  it("reads the first value of an array-shaped param (Next searchParams)", () => {
    expect(resolveWindow({ range: ["quarter", "30d"] }, NOW).key).toBe("quarter");
  });
});

describe("resolveWindow — custom half-open boundary (to is inclusive of its whole day)", () => {
  it("`to` end is local-midnight(to) + DAY − 1ms, so a scan anywhere on the to-day counts", () => {
    const w = resolveWindow({ range: "custom", from: "2026-01-01", to: "2026-03-31" }, NOW);
    expect(w.start!.getTime()).toBe(new Date("2026-01-01T00:00:00").getTime());
    const toMidnight = new Date("2026-03-31T00:00:00").getTime();
    expect(w.end!.getTime()).toBe(toMidnight + DAY - 1); // 23:59:59.999, half-open boundary pinned
    expect(w.from).toBe("2026-01-01");
    expect(w.to).toBe("2026-03-31");
  });

  it("custom with no `to` is open-ended (end null); a blank/invalid `from` ⇒ null start, no comparison", () => {
    const open = resolveWindow({ range: "custom", from: "2026-01-01" }, NOW);
    expect(open.end).toBeNull();
    expect(open.comparisonLabel).toBe("vs range start");

    const bad = resolveWindow({ range: "custom", from: "not-a-date" }, NOW);
    expect(bad.start).toBeNull();
    expect(bad.comparisonLabel).toBe("");
  });

  it("a reversed range (from > to) is SWAPPED into a coherent period, not start > end", () => {
    // Without the guard, start > end → the trend query matches nothing (blank dashboard) while the
    // baseline (lt: start) returns an incoherent pre-start snapshot. Swap keeps both dates, ordered.
    const w = resolveWindow({ range: "custom", from: "2026-03-31", to: "2026-01-01" }, NOW);
    expect(w.start!.getTime()).toBe(new Date("2026-01-01T00:00:00").getTime());
    expect(w.end!.getTime()).toBe(new Date("2026-03-31T00:00:00").getTime() + DAY - 1);
    expect(w.start!.getTime()).toBeLessThan(w.end!.getTime());
    expect(w.from).toBe("2026-01-01");
    expect(w.to).toBe("2026-03-31");
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

  it("custom round-trip drives resolveWindow to the same inclusive-to window", () => {
    const cookie = serializePeriodCookie({ range: "custom", from: "2026-01-01", to: "2026-03-31" });
    const w = resolveWindow(parsePeriodCookie(cookie)!, NOW);
    expect(w.key).toBe("custom");
    expect(w.end!.getTime()).toBe(new Date("2026-03-31T00:00:00").getTime() + DAY - 1);
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
