// @vitest-environment jsdom
//
// `scheduleLabel` exists because RepoRow and the connect BulkActionsBar once rendered the same cadence
// id two ways ("no autoscan" vs a raw "off"), and its own doc comment claims the matter is settled:
// "every schedule select renders options through this". This select — the org repositories
// leaderboard's, added after that helper — imported SCHEDULES from the same module and rendered the
// raw id, so the identical setting read as two different words depending on which page you were on.
//
// Pinned as a COMPOSITION, not a string list: every option's text must be `scheduleLabel(value)` for
// the whole vocabulary, so a new cadence (or a relabelled one) cannot reintroduce the divergence.

import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { SCHEDULES, scheduleLabel } from "@/lib/org/repo-schedule";
import { ScheduleSelect } from "./ScheduleSelect";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function options(schedule = "off") {
  const { container } = render(<ScheduleSelect org="acme" fullName="acme/api" schedule={schedule} />);
  return Array.from(container.querySelectorAll("option")).map((o) => ({
    value: o.getAttribute("value"),
    text: o.textContent,
  }));
}

describe("ScheduleSelect cadence labels", () => {
  it("renders every cadence through scheduleLabel, never the raw id", () => {
    expect(options().map((o) => o.text)).toEqual(SCHEDULES.map((s) => scheduleLabel(s)));
  });

  it("offers the whole vocabulary, with the ids as the option VALUES", () => {
    expect(options().map((o) => o.value)).toEqual([...SCHEDULES]);
  });

  it("names the off cadence the way both connect selects do", () => {
    const off = options().find((o) => o.value === "off");
    expect(off?.text).toBe("no autoscan");
    expect(off?.text).not.toBe("off");
  });
});
