// @vitest-environment jsdom
//
// The Adoption and Contributors tabs are the two org tabs the period control does NOT govern (their
// inputs are latest-scan snapshots with no dated history — see SnapshotScopeNotice's header). The
// contract chosen for that is DISCLOSURE, and these are its teeth: the selected range must be named
// on screen, must be rendered as visibly inert, and the panel must never imply the numbers are
// period-scoped. A regression here is silent in the UI, which is exactly why it is pinned.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SnapshotScopeNotice, windowLabel } from "./SnapshotScopeNotice";

const win = (key: "30d" | "90d" | "quarter" | "all" | "custom", start: Date | null = null, end: Date | null = null) =>
  ({ key, start, end }) as const;

describe("windowLabel", () => {
  it("uses the same preset text the period control prints on its buttons", () => {
    expect(windowLabel(win("30d"))).toBe("30 days");
    expect(windowLabel(win("90d"))).toBe("90 days");
    expect(windowLabel(win("quarter"))).toBe("Quarter");
    expect(windowLabel(win("all"))).toBe("All time");
  });

  it("spells a custom range out as its dates — 'Custom' alone would not identify what was picked", () => {
    expect(windowLabel(win("custom", new Date("2026-01-01T00:00:00Z"), new Date("2026-03-31T00:00:00Z")))).toBe(
      "2026-01-01 → 2026-03-31",
    );
  });

  it("degrades an open-ended custom bound to an ellipsis rather than printing null/NaN", () => {
    expect(windowLabel(win("custom", new Date("2026-01-01T00:00:00Z"), null))).toBe("2026-01-01 → …");
  });
});

describe("SnapshotScopeNotice", () => {
  const renderNotice = (key: Parameters<typeof win>[0] = "90d") =>
    render(
      <SnapshotScopeNotice
        period={win(key)}
        subject="adoption"
        scopedHref="/org/acme?tab=delivery"
        scopedLabel="Delivery"
      />,
    );

  it("names the period the user actually selected, so the notice can't read as boilerplate", () => {
    renderNotice("quarter");
    expect(screen.getByTestId("snapshot-scope-notice")).toHaveTextContent("Quarter");
  });

  it("renders the selected range as an INERT chip — aria-disabled, never an active-looking control", () => {
    renderNotice("30d");
    const chip = screen.getByText("30 days");
    expect(chip).toHaveAttribute("aria-disabled", "true");
    expect(chip.tagName).toBe("SPAN"); // not a button: nothing here is clickable
    expect(chip.className).toContain("line-through");
  });

  it("is announced as a note whose label states the period is not applied", () => {
    renderNotice("90d");
    const note = screen.getByRole("note");
    expect(note).toHaveAttribute("aria-label", "Selected period 90 days is not applied to this tab");
  });

  it("says the numbers are a scan-time snapshot in words, not just by omission", () => {
    const { container } = renderNotice();
    const text = container.textContent ?? "";
    expect(text).toContain("Period · not applied");
    expect(text).toContain("scan-time snapshot");
    expect(text).toContain("most recent scans");
  });

  it("points at a tab that DOES honour the period rather than dead-ending the user", () => {
    renderNotice();
    const link = screen.getByRole("link", { name: "Delivery" });
    expect(link).toHaveAttribute("href", "/org/acme?tab=delivery");
  });
});

// Delivery is the MIXED case: its trend (and the W3a/W4 panels) are period-scoped while PR signals,
// governance and activity are latest-scan snapshots. Saying "not applied" there would be its own
// false claim, so the notice grew a `partial` scope — and a struck-through chip must not follow it.
describe("SnapshotScopeNotice — partial scope (Delivery)", () => {
  const renderPartial = () =>
    render(
      <SnapshotScopeNotice
        period={win("30d")}
        subject="delivery"
        scope="partial"
        detail={<>Trend is period-scoped; PR signals are a scan-time snapshot.</>}
      />,
    );

  it("says the period is PARTLY applied rather than not applied", () => {
    const { container } = renderPartial();
    expect(container.textContent).toContain("Period · partly applied");
    expect(container.textContent).not.toContain("not applied");
  });

  it("leaves the chip live-looking: the range genuinely is applied elsewhere on the tab", () => {
    renderPartial();
    const chip = screen.getByText("30 days");
    expect(chip.className).not.toContain("line-through");
    expect(chip).not.toHaveAttribute("aria-disabled");
  });

  it("is announced as covering only part of the tab", () => {
    renderPartial();
    expect(screen.getByRole("note")).toHaveAttribute(
      "aria-label",
      "Selected period 30 days is applied to only part of this tab",
    );
  });

  it("renders the caller's detail instead of the generic snapshot sentence", () => {
    const { container } = renderPartial();
    expect(container.textContent).toContain("Trend is period-scoped");
    expect(container.textContent).not.toContain("Contributor commit totals");
  });

  it("omits the cross-tab link entirely when no scoped tab is named", () => {
    renderPartial();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
