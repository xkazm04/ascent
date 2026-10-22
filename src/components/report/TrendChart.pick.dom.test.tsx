// @vitest-environment jsdom
// Pins TrendChart's two-point pick mode (trends-1): with `onPick` set, a click on the hovered point
// picks it and never navigates; without `onPick`, the click-to-report path is unchanged.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { TrendChart, type TrendPoint } from "./TrendChart";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

beforeAll(() => {
  // jsdom lays nothing out: give the chart svg the viewBox's own width so clientX maps 1:1.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, width: 640, height: 220, right: 640, bottom: 220, toJSON: () => ({}),
  } as DOMRect);
});
beforeEach(() => push.mockClear());

const POINTS: TrendPoint[] = [
  { id: "s1", score: 60, at: "2026-07-01T09:00:00.000Z", href: "/report/acme/app/aaa" },
  { id: "s2", score: 66, at: "2026-07-02T09:00:00.000Z", href: "/report/acme/app/bbb" },
];

function clickPoint(container: HTMLElement, clientX: number) {
  const svg = container.querySelector('svg[role="img"]')!;
  fireEvent.pointerMove(svg, { clientX, clientY: 100 });
  fireEvent.click(svg, { clientX, clientY: 100 });
}

describe("TrendChart pick mode", () => {
  it("with onPick: clicking the hovered point picks its id and does not navigate", () => {
    const onPick = vi.fn();
    const { container } = render(<TrendChart points={POINTS} onPick={onPick} />);
    clickPoint(container, 640);
    expect(onPick).toHaveBeenCalledWith("s2");
    expect(push).not.toHaveBeenCalled();
  });

  it("marks picked points on the plot", () => {
    const { container } = render(<TrendChart points={POINTS} onPick={vi.fn()} picked={["s1"]} />);
    expect(container.querySelectorAll("[data-picked]")).toHaveLength(1);
  });

  it("without onPick: the click still opens the point's report", () => {
    const { container } = render(<TrendChart points={POINTS} />);
    clickPoint(container, 0);
    expect(push).toHaveBeenCalledWith("/report/acme/app/aaa");
  });
});
