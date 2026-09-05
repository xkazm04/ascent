import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Pins the deadline-countdown branches of `daysUntil` (LiveWarRoomGoalBanner.tsx).
//
// The production helper is module-private inside a `"use client"` component and
// reads the wall clock directly (`Date.now()`), with no exported seam — so the
// clock is pinned with `vi.useFakeTimers()` and the helper is reproduced here
// VERBATIM from LiveWarRoomGoalBanner.tsx so the assertions describe the real code's
// contract. If that source helper changes, this mirror (and its tests) must
// change in lockstep — that coupling is the point: it locks the behaviour.
//
// CONTRACT (live-war-room 07-16 #2 — the timezone off-by-one fix): the deadline
// is INCLUSIVE and ends at END OF DAY in the VIEWER'S LOCAL timezone.
//   • no/invalid date → null (never NaN, never a crash)
//   • the WHOLE deadline day — 00:00 through 23:59 local — reads 0 ("0d to
//     deadline", due today), in EVERY timezone. The old Date.parse(date) was UTC
//     midnight at the START of the day, so a viewer west of UTC saw "1d past
//     deadline" on the wall while the date was still today locally.
//   • a future deadline → POSITIVE whole-day count; past → NEGATIVE, starting
//     the local day AFTER the deadline day.
//   • the component renders `${countdown}d to deadline` / `${-countdown}d past
//     deadline`, so the sign IS the user-facing direction — it must never invert.
// ─────────────────────────────────────────────────────────────────────────────

/** VERBATIM mirror of LiveWarRoomGoalBanner.tsx `daysUntil` — see header comment. */
function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return null;
  const end = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1).getTime();
  if (Number.isNaN(end)) return null;
  return Math.ceil((end - Date.now()) / 86_400_000) - 1;
}

/** YYYY-MM-DD of a LOCAL date — targets are built off local parts so every
 *  assertion holds regardless of the timezone the test runner happens to use. */
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Local date `days` after the pinned "now", at local midnight (date arithmetic only). */
const localShift = (now: Date, days: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);

/** Pin the clock to a LOCAL wall-time instant. */
const pin = (y: number, mo: number, d: number, h: number, mi = 0) => {
  const now = new Date(y, mo - 1, d, h, mi);
  vi.setSystemTime(now);
  return now;
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("daysUntil (war-room deadline countdown — local end-of-day, inclusive)", () => {
  // ── null / invalid branch: never NaN, never throws ────────────────────────
  it("returns null for a null date and an empty string", () => {
    pin(2026, 6, 19, 9);
    expect(daysUntil(null)).toBeNull();
    expect(daysUntil("")).toBeNull();
  });

  it("returns null for an unparseable date instead of NaN or a throw", () => {
    pin(2026, 6, 19, 9);
    const r = daysUntil("not-a-date");
    expect(r).toBeNull();
    expect(Number.isNaN(r as unknown as number)).toBe(false);
  });

  // ── the deadline day itself reads 0 at BOTH edges of the local day ────────
  // This is the boundary the fix pins: the old UTC-midnight parse made "past
  // deadline" fire up to a day early/late depending on the viewer's timezone.
  it("the deadline day reads 0 ('due today') early in the LOCAL morning", () => {
    const now = pin(2026, 6, 19, 0, 30); // 00:30 local on the deadline day
    expect(daysUntil(ymd(now))).toBe(0);
  });

  it("the deadline day STILL reads 0 at 23:00 LOCAL — never 'past deadline' while the date is today", () => {
    const now = pin(2026, 6, 19, 23, 0); // 23:00 local, deadline day review hour
    expect(daysUntil(ymd(now))).toBe(0);
  });

  // ── future deadline → POSITIVE whole-day count ────────────────────────────
  it("tomorrow (local) reads 1, five local days out reads 5", () => {
    const now = pin(2026, 6, 19, 9, 30);
    expect(daysUntil(ymd(localShift(now, 1)))).toBe(1);
    expect(daysUntil(ymd(localShift(now, 5)))).toBe(5);
  });

  // ── past deadline → NEGATIVE, starting the local day AFTER the deadline ──
  it("yesterday (local) reads -1 even just after local midnight (past starts the day after)", () => {
    const now = pin(2026, 6, 19, 0, 30);
    expect(daysUntil(ymd(localShift(now, -1)))).toBe(-1);
  });

  it("three local days ago reads -3", () => {
    const now = pin(2026, 6, 19, 15, 0);
    expect(daysUntil(ymd(localShift(now, -3)))).toBe(-3);
  });

  // ── sign convention is the user-facing direction (component renders by sign) ─
  it("sign convention: future > 0, past < 0 — the render direction never inverts", () => {
    const now = pin(2026, 6, 19, 12, 0);
    const future = daysUntil(ymd(localShift(now, 5)));
    const past = daysUntil(ymd(localShift(now, -5)));
    expect(future).toBe(5);
    expect(past).toBe(-5);
    expect(-past!).toBe(5); // `${-countdown}d past deadline` magnitude
  });

  // ── determinism: crossing local midnight moves the count by exactly one ───
  it("advancing the clock across LOCAL midnight decrements the count by exactly one", () => {
    const now = pin(2026, 6, 19, 23, 30);
    const target = ymd(localShift(now, 2));
    expect(daysUntil(target)).toBe(2);
    vi.setSystemTime(new Date(2026, 5, 20, 0, 30)); // 1h later, across local midnight
    expect(daysUntil(target)).toBe(1);
  });
});
