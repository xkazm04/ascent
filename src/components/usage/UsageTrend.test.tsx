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
