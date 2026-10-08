// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PUSH_RESCAN_DISCLOSURE, SCHEDULES, scheduleLabel } from "@/lib/org/repo-schedule";
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

  it("describes the push-rescan cost and the no-autoscan rule through its accessible description", () => {
    render(<ScheduleSelectV2 org="acme" fullName="acme/api" schedule="off" />);
    const select = screen.getByLabelText("Autoscan cadence for acme/api");
    const ids = (select.getAttribute("aria-describedby") ?? "").split(" ");
    const text = ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
    expect(text).toContain(PUSH_RESCAN_DISCLOSURE);
    expect(PUSH_RESCAN_DISCLOSURE).toMatch(/default branch is pushed/);
    expect(PUSH_RESCAN_DISCLOSURE).toMatch(/\"no autoscan\" stops push rescans too/);
  });
});
