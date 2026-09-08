// @vitest-environment jsdom
//
// The fleet-evolution timetable's VOID — the /org redesign's §2.4 rule on the wall's one grid.
//
// A cell the repo has no scan for is an absence, not a low score, and the grid used to say so in two
// different hand-rolled ways at once: a "·" in a hand-picked slate for a body cell, an em dash for the
// fleet-average footer, and nothing anywhere explaining either. Prose could not have fixed that —
// nothing stops a reader taking a dash for a zero — so the encoding does: both draw the kit's
// `missing` mark (StateSwatch's broken rule), each carries STATE_HINT.missing as its caveat, and a
// legend row appears exactly when the grid actually contains one.
//
// These assert the ENCODING, not the markup: that a void never prints a numeral, that a real 0 does,
// and that a fully-scanned fleet is not taught an encoding it cannot see.

import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { STATE_HINT, STATE_LABEL } from "@/components/org/viz";
import { FleetTimetablePanel } from "@/features/inflight/live/LiveWarRoomTimetable";
import type { FleetTimetable } from "@/features/inflight/live/fleetTimetable";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

const table = (cells: (number | null)[]): FleetTimetable => ({
  columns: [
    { key: "2026-06-01", label: "Jun 1" },
    { key: "2026-06-08", label: "Jun 8" },
  ],
  rows: [
    {
      fullName: "acme/api",
      name: "api",
      cells,
      cellDeltas: [null, null],
      latest: cells[1] ?? null,
      latestLevel: null,
      latestPosture: null,
      first: cells[0] ?? null,
      delta: null,
    },
  ],
});

function panel(t: FleetTimetable) {
  return render(
    <FleetTimetablePanel data={t} slug="acme" selected={new Set()} onSetSelected={() => {}} onScanSelected={() => {}} scanning={false} />,
  );
}

const voidMarks = (c: HTMLElement) => [...c.querySelectorAll("svg")].filter((s) => s.getAttribute("aria-label")?.startsWith(STATE_LABEL.missing));

describe("fleet timetable — a day with no scan is a void, not a zero", () => {
  it("draws the kit's missing mark instead of a numeral, and carries its caveat", () => {
    const { container } = panel(table([null, 62]));
    // One body void + one footer void (the fleet average of a column with no readings is null too),
    // and the row's Δ column, which has no baseline in the window.
    expect(voidMarks(container).length).toBeGreaterThanOrEqual(3);
    const hinted = [...container.querySelectorAll("[title]")].filter((e) => e.getAttribute("title")?.includes(STATE_HINT.missing));
    expect(hinted.length).toBeGreaterThanOrEqual(3);
    // The void cell prints no number at all — not "0", not "·".
    const cell = container.querySelectorAll("tbody td")[1]!;
    expect(cell.textContent).toBe("");
  });

  it("legends the void once, and only when the grid holds one", () => {
    const withVoid = panel(table([null, 62]));
    expect(withVoid.container.textContent).toContain(STATE_LABEL.missing);
    withVoid.unmount();

    // A fully-scanned window teaches no encoding it does not use (the kit's Legend rule).
    const full = panel(table([58, 62]));
    expect(full.container.textContent).not.toContain(STATE_LABEL.missing);
    expect(voidMarks(full.container)).toHaveLength(1); // the Δ column only — one reading, no baseline
  });

  it("keeps a measured zero as a printed zero — a scan that scored 0 is a measurement", () => {
    const { container } = panel(table([0, 62]));
    const cell = container.querySelectorAll("tbody td")[1]!;
    expect(cell.textContent).toBe("0");
    expect(voidMarks(container)).toHaveLength(1); // the Δ column, not the score cell
  });
});
