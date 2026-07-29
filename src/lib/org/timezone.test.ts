// The canonical org time-zone policy (G4-07). These tests are the executable statement of the policy:
// there is ONE reference frame, it defaults to UTC, it is overridable per-deployment, calendar-day
// arithmetic survives DST, and a date-only column is read back as the literal day it was written as.
//
// Every assertion must hold in ANY runner timezone — that is the property the old, local-zone-based
// suites could not give us (they passed on a UTC CI box and meant something else on a CET laptop).

import { describe, it, expect, afterEach } from "vitest";
import {
  DEFAULT_ORG_TZ,
  addDaysInZone,
  dayKeyInZone,
  dayKeyOfDateColumn,
  daysBetweenDayKeys,
  knownTimeZone,
  orgTimeZone,
  parseDayKey,
  resolveOrgTimeZone,
  partsInZone,
  startOfDayInZone,
  startOfQuarterInZone,
  zonedMidnight,
  __resetOrgTimeZoneCache,
} from "./timezone";

afterEach(() => {
  delete process.env.ASCENT_ORG_TZ;
  __resetOrgTimeZoneCache();
});

describe("orgTimeZone — the policy default and its override", () => {
  it("defaults to UTC (a decision, not the host's accident)", () => {
    expect(DEFAULT_ORG_TZ).toBe("UTC");
    expect(orgTimeZone()).toBe("UTC");
  });

  it("honors a valid ASCENT_ORG_TZ override", () => {
    process.env.ASCENT_ORG_TZ = "America/New_York";
    __resetOrgTimeZoneCache();
    expect(orgTimeZone()).toBe("America/New_York");
  });

  it("degrades a bogus ASCENT_ORG_TZ to UTC instead of throwing inside a dashboard render", () => {
    process.env.ASCENT_ORG_TZ = "Mars/Olympus_Mons";
    __resetOrgTimeZoneCache();
    expect(orgTimeZone()).toBe("UTC");
  });
});

// PER-ORG ZONES (policy note 6). The column `Organization.timezone` is nullable and every existing org
// has NULL, so the whole point of these assertions is that the deployment default keeps applying
// unchanged until an org explicitly opts in — and that a bad stored value can never 500 a dashboard.
describe("resolveOrgTimeZone — the per-org column, layered over the deployment default", () => {
  it("uses the org's stored zone when it names a zone this runtime knows", () => {
    expect(resolveOrgTimeZone("America/New_York")).toBe("America/New_York");
  });

  it("falls back to the deployment default when the column is NULL — i.e. for every org today", () => {
    expect(resolveOrgTimeZone(null)).toBe("UTC");
    expect(resolveOrgTimeZone(undefined)).toBe("UTC");
    expect(resolveOrgTimeZone("   ")).toBe("UTC");
  });

  it("layers over ASCENT_ORG_TZ rather than replacing it: column → env → UTC", () => {
    process.env.ASCENT_ORG_TZ = "Europe/Prague";
    __resetOrgTimeZoneCache();
    expect(resolveOrgTimeZone(null)).toBe("Europe/Prague"); // no column → the deployment override wins
    expect(resolveOrgTimeZone("Asia/Tokyo")).toBe("Asia/Tokyo"); // the org's own zone beats the env
  });

  it("degrades a hand-edited / unknown stored zone to the default instead of throwing mid-render", () => {
    expect(resolveOrgTimeZone("Mars/Olympus_Mons")).toBe("UTC");
    expect(resolveOrgTimeZone("'; DROP TABLE")).toBe("UTC");
  });

  it("actually CHANGES the day bucketing it is passed into (the value is load-bearing, not decorative)", () => {
    // 23:30Z on the 18th is already the 19th in Tokyo. An org in Tokyo must see its own Monday.
    const at = new Date("2026-06-18T23:30:00.000Z");
    expect(dayKeyInZone(at, resolveOrgTimeZone(null))).toBe("2026-06-18");
    expect(dayKeyInZone(at, resolveOrgTimeZone("Asia/Tokyo"))).toBe("2026-06-19");
  });

  it("knownTimeZone is the shared validator (null for unusable input, the name for a real zone)", () => {
    expect(knownTimeZone("Asia/Tokyo")).toBe("Asia/Tokyo");
    expect(knownTimeZone(" UTC ")).toBe("UTC");
    expect(knownTimeZone("")).toBeNull();
    expect(knownTimeZone(null)).toBeNull();
    expect(knownTimeZone("Nowhere/Real")).toBeNull();
  });
});

describe("day keys and midnights are runner-timezone-proof", () => {
  it("dayKeyInZone reads the canonical (UTC) day, not the host's", () => {
    // 23:30Z is already the NEXT day in Tokyo and still the SAME day in New York. Under the policy
    // the answer is neither of those local opinions — it is the canonical day.
    expect(dayKeyInZone(new Date("2026-06-02T23:30:00Z"))).toBe("2026-06-02");
    expect(dayKeyInZone(new Date("2026-06-03T00:00:00Z"))).toBe("2026-06-03");
    expect(dayKeyInZone(new Date("2026-06-02T00:00:00Z"))).toBe("2026-06-02");
  });

  it("startOfDayInZone is idempotent and lands exactly on the day's first instant", () => {
    const mid = startOfDayInZone(new Date("2026-06-02T14:37:22.500Z"));
    expect(mid.toISOString()).toBe("2026-06-02T00:00:00.000Z");
    expect(startOfDayInZone(mid).getTime()).toBe(mid.getTime());
    // The instant one ms earlier belongs to the PREVIOUS day — the half-open boundary.
    expect(dayKeyInZone(new Date(mid.getTime() - 1))).toBe("2026-06-01");
  });

  it("zonedMidnight round-trips through partsInZone", () => {
    const d = zonedMidnight(2026, 3, 29);
    const p = partsInZone(d);
    expect([p.year, p.month, p.day, p.hour, p.minute, p.second]).toEqual([2026, 3, 29, 0, 0, 0]);
  });

  it("startOfQuarterInZone snaps to the calendar quarter", () => {
    expect(startOfQuarterInZone(new Date("2026-06-16T14:37:00Z")).toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(startOfQuarterInZone(new Date("2026-01-01T00:00:00Z")).toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(startOfQuarterInZone(new Date("2026-12-31T23:59:59Z")).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
});

describe("addDaysInZone — CALENDAR arithmetic, not n × 86.4M ms", () => {
  it("moves whole days and stays on midnight", () => {
    const d = addDaysInZone(new Date("2026-06-16T14:37:00Z"), -90);
    expect(d.toISOString()).toBe("2026-03-18T00:00:00.000Z");
    expect(addDaysInZone(d, 90).toISOString()).toBe("2026-06-16T00:00:00.000Z");
  });

  it("crosses a month/year boundary correctly", () => {
    expect(dayKeyInZone(addDaysInZone(new Date("2026-01-01T05:00:00Z"), -1))).toBe("2025-12-31");
    expect(dayKeyInZone(addDaysInZone(new Date("2026-02-28T05:00:00Z"), 1))).toBe("2026-03-01"); // 2026 is not a leap year
  });

  it("survives a DST transition under a NON-UTC canonical zone (the seam the old flat-ms math had)", () => {
    process.env.ASCENT_ORG_TZ = "America/New_York";
    __resetOrgTimeZoneCache();
    // 2026-03-08 is US spring-forward. Stepping one calendar day over it must land on midnight of the
    // 8th, not 01:00 of the 8th (which a flat +86.4M ms would give) — and every hour of the source day
    // must give the SAME answer.
    const fromNoon = addDaysInZone(new Date("2026-03-07T17:00:00Z"), 1); // 12:00 local Mar 7
    const fromLate = addDaysInZone(new Date("2026-03-08T04:30:00Z"), 0); // 23:30 local Mar 7
    expect(dayKeyInZone(fromNoon)).toBe("2026-03-08");
    expect(partsInZone(fromNoon).hour).toBe(0);
    expect(dayKeyInZone(fromLate)).toBe("2026-03-07");
    expect(partsInZone(fromLate).hour).toBe(0);
    // A flat-ms step would have produced a non-midnight instant; calendar arithmetic never does.
    expect(partsInZone(addDaysInZone(fromNoon, 1)).hour).toBe(0);
  });

  it("a non-UTC canonical zone genuinely shifts the day boundary (the override is real, not cosmetic)", () => {
    process.env.ASCENT_ORG_TZ = "America/New_York";
    __resetOrgTimeZoneCache();
    // 2026-06-03T02:00Z is 22:00 on Jun 2 in New York — still the previous org day.
    expect(dayKeyInZone(new Date("2026-06-03T02:00:00Z"))).toBe("2026-06-02");
  });
});

describe("parseDayKey — a date LITERAL, strictly validated", () => {
  it("parses a well-formed literal to its canonical midnight", () => {
    expect(parseDayKey("2026-01-01")!.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("returns null for blank, malformed, and out-of-range literals (no silent rollover)", () => {
    expect(parseDayKey(undefined)).toBeNull();
    expect(parseDayKey("")).toBeNull();
    expect(parseDayKey("not-a-date")).toBeNull();
    expect(parseDayKey("2026-1-1")).toBeNull(); // the date input never emits this shape
    expect(parseDayKey("2026-13-01")).toBeNull();
    expect(parseDayKey("2026-02-31")).toBeNull(); // would have rolled over to Mar 3
  });

  it("round-trips against dayKeyInZone under a non-UTC canonical zone", () => {
    process.env.ASCENT_ORG_TZ = "Asia/Tokyo";
    __resetOrgTimeZoneCache();
    expect(dayKeyInZone(parseDayKey("2026-06-02")!)).toBe("2026-06-02");
  });
});

describe("dayKeyOfDateColumn — date-only columns keep the day they were WRITTEN as", () => {
  it("reads midnight-UTC storage back as the literal picked day", () => {
    expect(dayKeyOfDateColumn(new Date("2026-06-02T00:00:00Z"))).toBe("2026-06-02");
  });

  it("does NOT re-truncate in the canonical zone — a westward zone would report the previous day", () => {
    process.env.ASCENT_ORG_TZ = "America/New_York";
    __resetOrgTimeZoneCache();
    // The instant IS the previous evening in New York…
    expect(dayKeyInZone(new Date("2026-06-02T00:00:00Z"))).toBe("2026-06-01");
    // …but the column still means the day the user picked. This asymmetry is policy note 5.
    expect(dayKeyOfDateColumn(new Date("2026-06-02T00:00:00Z"))).toBe("2026-06-02");
  });
});

describe("daysBetweenDayKeys — exact integer day math, no DST involvement", () => {
  it("counts forward, backward, and zero", () => {
    expect(daysBetweenDayKeys("2026-06-02", "2026-06-02")).toBe(0);
    expect(daysBetweenDayKeys("2026-06-02", "2026-06-09")).toBe(7);
    expect(daysBetweenDayKeys("2026-06-02", "2026-06-01")).toBe(-1);
    expect(daysBetweenDayKeys("2026-06-02", "2026-07-03")).toBe(31);
  });

  it("is unaffected by DST spans (a 23h day still counts as one day)", () => {
    expect(daysBetweenDayKeys("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetweenDayKeys("2025-12-31", "2026-01-01")).toBe(1);
  });
});
