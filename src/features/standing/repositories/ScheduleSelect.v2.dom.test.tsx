// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SCHEDULES, scheduleLabel } from "@/lib/org/repo-schedule";
import { ScheduleSelectV2 } from "./ScheduleSelect.v2";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function options(schedule = "off") {
  const { container } = render(<ScheduleSelectV2 org="acme" fullName="acme/api" schedule={schedule} />);
  return Array.from(container.querySelectorAll("option")).map((o) => ({
    value: o.getAttribute("value"),
    text: o.textContent,
  }));
}

describe("ScheduleSelectV2", () => {
  it("renders every cadence through scheduleLabel", () => {
    expect(options().map((o) => o.text)).toEqual(SCHEDULES.map((s) => scheduleLabel(s)));
    expect(options().map((o) => o.value)).toEqual([...SCHEDULES]);
  });

  it("keeps the accessible name and stays focusable when scheduling is unavailable", () => {
    render(
      <ScheduleSelectV2
        org="acme"
        fullName="acme/api"
        schedule="weekly"
        disabled
        disabledHint="Autoscan scheduling requires the GitHub App."
      />,
    );
    const select = screen.getByLabelText("Autoscan cadence for acme/api");
    expect(select).toHaveAttribute("aria-disabled", "true");
    expect(select).not.toHaveAttribute("disabled");
    expect(select).toHaveValue("weekly");
    expect(screen.getByText("Cadence")).toBeInTheDocument();
    expect(screen.getByText("Autoscan scheduling requires the GitHub App.")).toBeInTheDocument();
    expect(document.querySelector("[data-tour='watch-schedule']")).not.toBeNull();
  });
});
