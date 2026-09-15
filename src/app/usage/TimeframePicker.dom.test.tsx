/** @vitest-environment jsdom */

// Direction 10 — /usage honoured `?days=` from the day it shipped and rendered no control for it, so
// every reader got the 30-day default and the trend chart's weekly-bucket path (120+ days) could not
// be reached from the product at all. These pin the two things a picker must not get wrong: the
// options must be the ones `boundUsageDays` will actually honour, and the public funnel's tighter cap
// must be visible as a withheld option rather than as a shorter menu.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { boundUsageDays } from "@/lib/db/usage";
import { TIMEFRAME_OPTIONS, TimeframePicker } from "./TimeframePicker";

const priv = () => boundUsageDays("365", false); // 365
const pub = () => boundUsageDays("365", true); // 90

describe("the /usage timeframe picker", () => {
  it("offers every window and links each to its own ?days=, keeping the org", () => {
    render(<TimeframePicker org="acme" days={30} maxDays={priv()} />);
    for (const n of TIMEFRAME_OPTIONS) {
      const el = screen.getByText(n === 365 ? "1y" : `${n}d`);
      expect(el.getAttribute("href")).toBe(`/usage?org=acme&days=${n}`);
    }
  });

  it("marks the window in force, and only that one", () => {
    render(<TimeframePicker org="acme" days={90} maxDays={priv()} />);
    expect(screen.getByText("90d").getAttribute("aria-current")).toBe("true");
    for (const label of ["7d", "30d", "1y"]) {
      expect(screen.getByText(label).getAttribute("aria-current")).toBeNull();
    }
  });

  it("every offered window survives boundUsageDays unchanged — no button lies about where it goes", () => {
    for (const n of TIMEFRAME_OPTIONS) expect(boundUsageDays(String(n), false)).toBe(n);
    // …and on the public funnel every option the picker still LINKS is honoured too.
    for (const n of TIMEFRAME_OPTIONS.filter((n) => n <= pub())) {
      expect(boundUsageDays(String(n), true)).toBe(n);
    }
  });

  it("disables — rather than hides — the year on the shared public funnel, and says why", () => {
    render(<TimeframePicker org="public" days={30} maxDays={pub()} />);
    const year = screen.getByText("1y");
    expect(year.getAttribute("aria-disabled")).toBe("true");
    expect(year.getAttribute("href")).toBeNull(); // not a link: it would be clamped to 90 anyway
    expect(year.getAttribute("title")).toContain("90 days");
    // The three it CAN reach are still real links.
    expect(screen.getByText("90d").getAttribute("href")).toBe("/usage?org=public&days=90");
  });

  it("escapes the org slug into the href rather than concatenating it raw", () => {
    render(<TimeframePicker org="a c&me" days={30} maxDays={priv()} />);
    expect(screen.getByText("7d").getAttribute("href")).toBe("/usage?org=a%20c%26me&days=7");
  });

  it("highlights nothing when the URL carries a window that is not on the menu", () => {
    // `?days=45` is legal and honoured; the control reflects the URL, it does not overrule it.
    render(<TimeframePicker org="acme" days={45} maxDays={priv()} />);
    for (const n of TIMEFRAME_OPTIONS) {
      expect(screen.getByText(n === 365 ? "1y" : `${n}d`).getAttribute("aria-current")).toBeNull();
    }
  });
});
