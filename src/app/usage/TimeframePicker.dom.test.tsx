/** @vitest-environment jsdom */

// Direction 10 — /usage honoured `?days=` from the day it shipped and rendered no control for it, so
// every reader got the 30-day default and the trend chart's weekly-bucket path (120+ days) could not
// be reached from the product at all. These pin the two things a picker must not get wrong: the
// options must be the ones `boundUsageDays` will actually honour, and windows above the plan's
// retentionDays (or the public funnel's 90-day cap) must be dropped, not offered as a lie.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { boundUsageDays } from "@/lib/db/usage";
import { TIMEFRAME_OPTIONS, TimeframePicker } from "./TimeframePicker";

const priv = () => boundUsageDays("365", false); // 365 (no plan: query cap)
const pub = () => boundUsageDays("365", true); // 90
const free = () => boundUsageDays("365", false, "free"); // 30

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
    // Free: only the windows at or under 30 days survive the plan cap.
    for (const n of TIMEFRAME_OPTIONS.filter((n) => n <= free())) {
      expect(boundUsageDays(String(n), false, "free")).toBe(n);
    }
    expect(boundUsageDays("90", false, "free")).toBe(30);
    expect(boundUsageDays("365", false, "free")).toBe(30);
  });

  it("does not offer the year on the shared public funnel", () => {
    render(<TimeframePicker org="public" days={30} maxDays={pub()} />);
    expect(screen.queryByText("1y")).toBeNull();
    expect(screen.getByText("90d").getAttribute("href")).toBe("/usage?org=public&days=90");
  });

  it("drops windows above Free's 30-day retention so they cannot be selected", () => {
    render(<TimeframePicker org="acme" days={30} maxDays={free()} />);
    expect(screen.getByText("7d").getAttribute("href")).toBe("/usage?org=acme&days=7");
    expect(screen.getByText("30d").getAttribute("href")).toBe("/usage?org=acme&days=30");
    expect(screen.queryByText("90d")).toBeNull();
    expect(screen.queryByText("1y")).toBeNull();
  });

  it("drops the year on Starter (180-day retention) but still offers 90d", () => {
    render(<TimeframePicker org="acme" days={30} maxDays={boundUsageDays("365", false, "pro")} />);
    expect(screen.getByText("90d").getAttribute("href")).toBe("/usage?org=acme&days=90");
    expect(screen.queryByText("1y")).toBeNull();
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
