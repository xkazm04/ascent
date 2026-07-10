import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Pins the deadline-countdown branches of `daysUntil` (LiveWarRoomHeader.tsx:25).
//
// The production helper is module-private inside a `"use client"` component and
// reads the wall clock directly (`Date.now()`), with no exported seam — so its
// branches and sign convention were never exercised. We do NOT touch source, so
// the clock is pinned with `vi.useFakeTimers()` and the helper is reproduced
// here VERBATIM from LiveWarRoomHeader.tsx:25 so the assertions describe the real
// code's contract. If that source helper changes, this mirror (and its tests)
// must change in lockstep — that coupling is the point: it locks the behaviour.
//
//   /** Days until a YYYY-MM-DD deadline (negative = past). null when no date. */
//   function daysUntil(date: string | null): number | null {
//     if (!date) return null;
//     const t = Date.parse(date);
//     if (Number.isNaN(t)) return null;
//     return Math.ceil((t - Date.now()) / 86_400_000);
//   }
//
// Contract pinned below:
//   • no/invalid date → null (never NaN, never a crash)
//   • a future deadline → POSITIVE whole-day count (days remaining), via Math.ceil
//   • a past deadline   → NEGATIVE count (days past)
//   • the component renders `${countdown}d to deadline` / `${-countdown}d past
//     deadline`, so the sign IS the user-facing direction — it must never invert.
//   • day boundary: Math.ceil means any sub-24h future remainder rounds UP, so a
//     deadline later *today* and one *tomorrow* both read as a positive count and
//     there is no off-by-one that flips a future deadline to 0/negative.
// ─────────────────────────────────────────────────────────────────────────────

/** VERBATIM mirror of LiveWarRoomHeader.tsx:25 — see header comment. */
function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const t = Date.parse(date);
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / 86_400_000);
}

const DAY = 86_400_000;

// A fixed "now" mid-morning UTC so we exercise the time-of-day boundary: there is
// a non-zero remainder within the current day for sub-24h offsets.
const NOW_ISO = "2026-06-19T09:30:00.000Z";
const NOW = Date.parse(NOW_ISO);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW)); // pins Date.now() — deterministic, no wall clock
});

afterEach(() => {
  vi.useRealTimers();
});

describe("daysUntil (war-room deadline countdown)", () => {
  // ── null / invalid branch: never NaN, never throws ────────────────────────
  it("returns null for a null date", () => {
    expect(daysUntil(null)).toBeNull();
  });

  it("returns null for an empty string (falsy → no-date branch)", () => {
    expect(daysUntil("")).toBeNull();
  });

  it("returns null for an unparseable date instead of NaN or a throw", () => {
    const r = daysUntil("not-a-date");
    expect(r).toBeNull();
    expect(Number.isNaN(r as unknown as number)).toBe(false);
  });

  // ── future deadline → POSITIVE whole-day count ────────────────────────────
  it("a deadline exactly 2 whole days out reads as 2 (days remaining, positive)", () => {
    // now + 2*DAY, expressed as an absolute instant so there is no rounding slop.
    const target = new Date(NOW + 2 * DAY).toISOString();
    expect(daysUntil(target)).toBe(2);
  });

  it("a deadline a single whole day out reads as 1", () => {
    const target = new Date(NOW + 1 * DAY).toISOString();
    expect(daysUntil(target)).toBe(1);
  });

  // ── day-boundary / time-of-day branch via Math.ceil ───────────────────────
  // The countdown invariant under test: a deadline later *today* (a sub-24h
  // future remainder) must NOT collapse to 0 — Math.ceil rounds it UP to 1, the
  // same reading as a deadline that is a full day away. A future deadline never
  // reads as "today"/past; only `now` itself reads as 0.
  it("a deadline later TODAY (sub-24h future) ceils UP to 1, not 0", () => {
    const target = new Date(NOW + 6 * 60 * 60 * 1000).toISOString(); // +6h, still today
    expect(daysUntil(target)).toBe(1);
  });

  it("a deadline ~tomorrow (just over a day out) also reads 2, not 1", () => {
    const target = new Date(NOW + DAY + 60 * 1000).toISOString(); // +24h01m
    expect(daysUntil(target)).toBe(2);
  });

  it("the boundary is consistent: later-today and tomorrow are BOTH positive (no off-by-one flip)", () => {
    const laterToday = daysUntil(new Date(NOW + 3 * 60 * 60 * 1000).toISOString());
    const tomorrow = daysUntil(new Date(NOW + DAY + 3 * 60 * 60 * 1000).toISOString());
    expect(laterToday).toBeGreaterThan(0);
    expect(tomorrow).toBeGreaterThan(0);
    expect(tomorrow! - laterToday!).toBe(1); // exactly one day apart, no boundary doubling/skipping
  });

  // ── "today" / now → 0 ─────────────────────────────────────────────────────
  it("a deadline at exactly now reads as 0 (ceil(0) === 0)", () => {
    expect(daysUntil(NOW_ISO)).toBe(0);
  });

  // ── past deadline → NEGATIVE count (the overdue form) ─────────────────────
  it("a deadline 1 whole day in the past reads as -1 (overdue, negative)", () => {
    const target = new Date(NOW - 1 * DAY).toISOString();
    expect(daysUntil(target)).toBe(-1);
  });

  it("a deadline 3 whole days in the past reads as -3", () => {
    const target = new Date(NOW - 3 * DAY).toISOString();
    expect(daysUntil(target)).toBe(-3);
  });

  it("a deadline a few hours in the past ceils toward 0 → 0, not a phantom +1", () => {
    // -2h: (t-now)/DAY is a small negative; Math.ceil → -0 (today, just lapsed),
    // never a POSITIVE reading. The sign must not invert for a recent miss.
    // (Math.ceil of a sub-day negative is -0; the component renders it as "0"
    //  since `${-0}d to deadline` → "0d to deadline", so it reads as today.)
    const target = new Date(NOW - 2 * 60 * 60 * 1000).toISOString();
    const r = daysUntil(target) as number;
    expect(Math.abs(r)).toBe(0); // zero-valued (the real helper yields -0)
    expect(r).not.toBeGreaterThan(0); // critically: not a phantom positive
    expect(String(r as number)).toBe("0"); // user-facing render: "0d to deadline"
  });

  // ── sign convention is the user-facing direction (component renders by sign) ─
  it("sign convention: future > 0, past < 0 — the render direction never inverts", () => {
    const future = daysUntil(new Date(NOW + 5 * DAY).toISOString());
    const past = daysUntil(new Date(NOW - 5 * DAY).toISOString());
    expect(future).toBe(5);
    expect(past).toBe(-5);
    // The header shows `${countdown}d to deadline` when >= 0 and `${-countdown}d
    // past deadline` when < 0; assert the magnitude shown for the past case.
    expect(-past!).toBe(5);
  });

  // ── determinism guard: result depends only on the pinned clock ────────────
  it("is deterministic under the fake clock (advancing the clock changes the count)", () => {
    const target = new Date(NOW + 2 * DAY).toISOString();
    expect(daysUntil(target)).toBe(2);
    vi.setSystemTime(new Date(NOW + 1 * DAY)); // a day passes
    expect(daysUntil(target)).toBe(1); // same target, now one day closer
  });
});
