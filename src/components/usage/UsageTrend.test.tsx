// Pins the corner treatment of the usage trend bars (src/components/usage/UsageTrend.tsx): the TOP
// segment of every day's stacked bar is rounded, so a free-only day (no billable cap above it) reads
// with the same rounded crown as a billable-topped day instead of a square top. UsageTrend owns no
// hooks, so we invoke it directly and walk the returned tree for the bar segments' classNames.

import { describe, it, expect } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { bucketUsageDays, partialNote, UsageTrend } from "./UsageTrend";
import type { UsageDay } from "@/lib/db";

type El = ReactElement<{ className?: string; href?: string; style?: { backgroundColor?: string; height?: string }; children?: ReactNode }>;

function flatten(node: ReactNode, out: El[] = []): El[] {
  if (Array.isArray(node)) {
    for (const n of node) flatten(n, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  const el = node as El;
  out.push(el);
  flatten(el.props?.children, out);
  return out;
}

const BILLABLE = "var(--color-accent)";
const FREE = "var(--color-tone-flat)"; // matches UsageTrend's FREE constant (G6-04: token, not the literal #94a3b8)

/** Bar-segment divs of a given fill colour — the ones with an inline height (excludes the fixed-size
 *  legend swatch, which shares the fill but carries no height). */
function segments(daily: UsageDay[], color: string): El[] {
  const els = flatten(UsageTrend({ daily, org: "acme", days: daily.length }));
  return els.filter((el) => el.props.style?.backgroundColor === color && el.props.style?.height != null);
}

describe("UsageTrend — bar corner treatment", () => {
  it("rounds the top of a free-only day's bar (it is the crown, no billable above)", () => {
    const free = segments([{ date: "2026-01-01", billable: 0, free: 5 }], FREE);
    expect(free).toHaveLength(1);
    expect(free[0].props.className).toContain("rounded-t-sm");
  });

  it("does NOT round the free segment when a billable cap sits above it", () => {
    const day: UsageDay[] = [{ date: "2026-01-02", billable: 3, free: 5 }];
    const free = segments(day, FREE);
    const billable = segments(day, BILLABLE);
    expect(free).toHaveLength(1);
    expect(billable).toHaveLength(1);
    // The billable cap is the rounded crown…
    expect(billable[0].props.className).toContain("rounded-t-sm");
    // …and the free segment beneath it is square-topped so the two meet flush.
    expect(free[0].props.className ?? "").not.toContain("rounded-t-sm");
  });
});

describe("UsageTrend — non-visual access to the billing data (usage-metering 2026-07-16 #2)", () => {
  type A11yEl = ReactElement<{ role?: string; "aria-label"?: string; "aria-hidden"?: string | boolean; children?: ReactNode }>;
  const daily: UsageDay[] = [
    { date: "2026-01-01", billable: 3, free: 5 },
    { date: "2026-01-02", billable: 1, free: 0 },
  ];
  const els = () => flatten(UsageTrend({ daily, org: "acme", days: 2 })) as unknown as A11yEl[];

  it("exposes the bar strip as one labeled image with the period totals", () => {
    const img = els().find((el) => el.props.role === "img");
    expect(img).toBeDefined();
    expect(img!.props["aria-label"]).toContain("4 billable");
    expect(img!.props["aria-label"]).toContain("5 free");
  });

  it("renders a visually-hidden per-day table as the text alternative (dates + both series)", () => {
    const table = els().find((el) => el.type === "table");
    expect(table).toBeDefined();
    // A row header is now `[date, partialSuffix]` (the newest row is marked "today, partial"), so
    // flatten each cell's children to text rather than expecting a single string child.
    const cells = flatten(table!.props.children)
      .map((el) =>
        (Array.isArray(el.props.children) ? el.props.children : [el.props.children])
          .filter((c) => typeof c === "string" || typeof c === "number")
          .join(""),
      )
      .filter((c) => c !== "");
    expect(cells).toContain("2026-01-01");
    expect(cells.some((c) => c.startsWith("2026-01-02"))).toBe(true);
    // The newest row carries its incompleteness in the TEXT alternative too, not only on hover.
    expect(cells.at(-3)).toContain("today, partial");
  });

  it("hides the redundant visual axis labels from AT (the table carries the dates)", () => {
    const hidden = els().filter((el) => el.props["aria-hidden"] === "true" || el.props["aria-hidden"] === true);
    expect(hidden.length).toBeGreaterThan(0);
  });
});

describe("bucketUsageDays — long windows aggregate to weeks (usage-metering 2026-07-16 #3)", () => {
  const mkDays = (n: number): UsageDay[] =>
    Array.from({ length: n }, (_, i) => ({
      date: new Date(Date.UTC(2025, 6, 15) + i * 86_400_000).toISOString().slice(0, 10),
      billable: i % 3,
      free: i % 2,
    }));

  it("passes short/medium windows through untouched (30 and the 120 threshold itself)", () => {
    for (const n of [30, 90, 120]) {
      const { series, bucketed } = bucketUsageDays(mkDays(n));
      expect(bucketed).toBe(false);
      expect(series).toHaveLength(n);
    }
  });

  it("buckets a 365-day window into 7-day sums, preserving totals exactly", () => {
    const days = mkDays(365);
    const { series, bucketed } = bucketUsageDays(days);
    expect(bucketed).toBe(true);
    expect(series).toHaveLength(Math.ceil(365 / 7)); // 53 — readable, not a sub-pixel smear
    expect(series.reduce((a, d) => a + d.billable, 0)).toBe(days.reduce((a, d) => a + d.billable, 0));
    expect(series.reduce((a, d) => a + d.free, 0)).toBe(days.reduce((a, d) => a + d.free, 0));
    // Each bucket is keyed by its first day, so titles/labels stay anchored to real dates.
    expect(series[0].date).toBe(days[0].date);
    expect(series[1].date).toBe(days[7].date);
  });

  it("renders ~53 bars (not 365) and year-bearing axis labels for a 365-day window", () => {
    const days = mkDays(365);
    const els = flatten(UsageTrend({ daily: days, org: "acme", days: 365 }));
    const bars = els.filter((el) => (el.props.className ?? "").includes("cursor-help"));
    expect(bars).toHaveLength(53);
    // The MM-DD axis repeats itself across a year; bucketed labels must carry the year.
    const labels = els.map((el) => el.props.children).filter((c) => typeof c === "string" && /'2[0-9]/.test(c));
    expect(labels.length).toBeGreaterThan(0);
  });
});

// MC-B19 (VICTOR-L1-02): the showback CSV — cost allocation by lane and by code-owning team — was
// built, correct, and reachable only by hand-typing `?view=showback`. A finance reader who cannot see
// the link has, from their side, no artifact at all.
describe("export links", () => {
  const hrefs = (): string[] =>
    flatten(UsageTrend({ daily: [{ date: "2026-08-01", billable: 2, free: 1 }], org: "acme", days: 30 }))
      .map((el) => el.props.href)
      .filter((h): h is string => typeof h === "string");

  it("offers per-day CSV, JSON and the showback CSV over the same org + window", () => {
    const base = "/api/usage?org=acme&days=30";
    expect(hrefs()).toEqual([`${base}&format=csv`, `${base}&format=json`, `${base}&view=showback`]);
  });
});

// Direction 9 (c)+(d): the chart says WHEN it is talking about. Every bucket is a UTC calendar day,
// and the newest one is always incomplete — the window's upper bound is midnight UTC of tomorrow, so
// the last bar is today, still accruing. Drawn at full weight beside finished bars it reads as a
// collapse in volume; in a 365-day window the trailing 7-day chunk can hold a single day.
describe("UsageTrend — the newest bucket is marked partial, and the days are named UTC", () => {
  const mkDays = (n: number): UsageDay[] =>
    Array.from({ length: n }, (_, i) => ({
      date: new Date(Date.UTC(2025, 6, 15) + i * 86_400_000).toISOString().slice(0, 10),
      billable: 1,
      free: 1,
    }));

  /** Every string rendered anywhere in the tree, joined — copy assertions read over the whole page. */
  function textOf(node: ReactNode): string {
    if (node == null || typeof node === "boolean") return "";
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(textOf).join("");
    if (isValidElement(node)) return textOf((node as El).props?.children);
    return "";
  }
  const render = (daily: UsageDay[], props: Partial<{ days: number; shortened: boolean }> = {}) =>
    UsageTrend({ daily, org: "acme", days: props.days ?? daily.length, shortened: props.shortened });

  it("names the trailing chunk's real length rather than drawing 1 day as a week", () => {
    // 365 = 52 weeks + 1 day: the last bucket is ONE day wide and was drawn like the 52 beside it.
    expect(bucketUsageDays(mkDays(365)).trailingDays).toBe(1);
    expect(partialNote(true, 1)).toBe("partial: 1 of 7 days");
    expect(partialNote(true, 7)).toBe("partial: week to date");
    expect(partialNote(false, 1)).toBe("today, partial");
  });

  it("marks the newest per-day bar as today and partial — in the title, the axis and the sr table", () => {
    const els = flatten(render(mkDays(30)));
    const bars = els.filter((el) => (el.props.className ?? "").includes("cursor-help"));
    const titles = bars.map((el) => (el.props as { title?: string }).title ?? "");
    expect(titles.at(-1)).toContain("today, partial");
    // …and ONLY the newest one: a mark on every bar marks nothing.
    expect(titles.filter((t) => t.includes("partial"))).toHaveLength(1);
    // Visually distinguished too, not by tooltip alone.
    expect(bars.at(-1)!.props.className).toContain("opacity-60");
    const text = textOf(render(mkDays(30)));
    expect(text).toContain("today, partial");
    expect(text).toContain("Days are UTC.");
  });

  it("marks the trailing WEEK bucket, and says how many days it actually covers", () => {
    const text = textOf(render(mkDays(365), { days: 365 }));
    expect(text).toContain("partial: 1 of 7 days");
    const bars = flatten(render(mkDays(365), { days: 365 })).filter((el) =>
      (el.props.className ?? "").includes("cursor-help"),
    );
    expect(bars.at(-1)!.props.className).toContain("opacity-60");
  });

  it("states UTC on the caption rather than leaving a bare MM-DD axis to imply a locale", () => {
    expect(textOf(render(mkDays(30)))).toContain("(UTC)");
  });

  it("reports the days actually covered, and says when the window was clamped at the first scan", () => {
    // The page asked for 365 days; the org is 5 days old, so the series is 5 rows (Direction 9e).
    const text = textOf(render(mkDays(5), { days: 365, shortened: true }));
    expect(text).toContain("Last 5 days (UTC)");
    expect(text).toContain("window shortened to first scan");
    // …but the exports still carry the REQUESTED window, so the link is not silently narrowed.
    const hrefs = flatten(render(mkDays(5), { days: 365, shortened: true }))
      .map((el) => el.props.href)
      .filter((h): h is string => typeof h === "string");
    expect(hrefs[0]).toContain("days=365");
  });

  it("says nothing about shortening when the window was not shortened", () => {
    expect(textOf(render(mkDays(30)))).not.toContain("shortened");
  });
});
