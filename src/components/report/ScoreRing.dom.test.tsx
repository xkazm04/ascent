// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LEVELS } from "@/lib/maturity/model";
import { MOCK_RING_DASH } from "@/components/report/chartEngine";
import { ScoreRing } from "./ScoreRing";

// usePrefersReducedMotion reads window.matchMedia, which jsdom does not implement.
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query.includes("reduce"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
});

const L3 = LEVELS.find((l) => l.id === "L3")!;

describe("ScoreRing mock-scored hollow arc", () => {
  it("a live-scored ring is a solid arc — no hollow mark, no demo caveat", () => {
    const { container } = render(<ScoreRing score={72} level={L3} engine="claude-cli" />);
    expect(container.querySelector("[data-mock]")).toBeNull();
    expect(screen.queryByText(/demo scan/i)).not.toBeInTheDocument();
  });

  it("an omitted engine is live, not mock — absence is not a demo scan", () => {
    const { container } = render(<ScoreRing score={72} level={L3} />);
    expect(container.querySelector("[data-mock]")).toBeNull();
  });

  it("a mock-scored ring is hollow: dashed stroke, masked to the score, caveat in the desc", () => {
    const { container } = render(<ScoreRing score={72} level={L3} engine="mock" />);
    const hollow = container.querySelector("circle[data-mock]")!;
    expect(hollow.getAttribute("stroke-dasharray")).toBe(MOCK_RING_DASH);
    expect(hollow.getAttribute("mask")).toMatch(/^url\(#.+\)$/);
    expect(hollow.getAttribute("fill")).toBe("none");
    expect(screen.getByText(/demo scan: deterministic rubric, no model/i)).toBeInTheDocument();
  });
});
