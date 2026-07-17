// Pins the corner treatment of the usage trend bars (src/components/usage/UsageTrend.tsx): the TOP
// segment of every day's stacked bar is rounded, so a free-only day (no billable cap above it) reads
// with the same rounded crown as a billable-topped day instead of a square top. UsageTrend owns no
// hooks, so we invoke it directly and walk the returned tree for the bar segments' classNames.

import { describe, it, expect } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { UsageTrend } from "./UsageTrend";
import type { UsageDay } from "@/lib/db";

type El = ReactElement<{ className?: string; style?: { backgroundColor?: string; height?: string }; children?: ReactNode }>;

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
const FREE = "#94a3b8";

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
    const cells = flatten(table!.props.children)
      .map((el) => el.props.children)
      .filter((c) => typeof c === "string" || typeof c === "number");
    expect(cells).toContain("2026-01-01");
    expect(cells).toContain("2026-01-02");
  });

  it("hides the redundant visual axis labels from AT (the table carries the dates)", () => {
    const hidden = els().filter((el) => el.props["aria-hidden"] === "true" || el.props["aria-hidden"] === true);
    expect(hidden.length).toBeGreaterThan(0);
  });
});
