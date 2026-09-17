// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Posture } from "@/lib/types";
import { MOCK_HOLLOW_FILL } from "@/components/report/chartEngine";
import { PostureQuadrant } from "./PostureQuadrant";

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

const POSTURE: Posture = { id: "ai-native", label: "AI-Native", blurb: "High adoption, high rigor." };

describe("PostureQuadrant mock-scored hollow mark", () => {
  it("a live-scored repo dot is filled, not hollow", () => {
    const { container } = render(
      <PostureQuadrant adoption={80} rigor={80} posture={POSTURE} engine="claude-cli" />,
    );
    expect(container.querySelector("[data-mock]")).toBeNull();
    expect(screen.queryByText(/demo scan/i)).not.toBeInTheDocument();
  });

  it("a mock-scored repo dot is hollow (surface fill, posture-colored stroke)", () => {
    const { container } = render(
      <PostureQuadrant adoption={80} rigor={80} posture={POSTURE} engine="mock" />,
    );
    const hollow = container.querySelector("circle[data-mock]")!;
    expect(hollow.getAttribute("fill")).toBe(MOCK_HOLLOW_FILL);
    expect(hollow.getAttribute("stroke")).toBeTruthy();
    expect(hollow.getAttribute("stroke")).not.toBe(hollow.getAttribute("fill"));
    expect(screen.getByLabelText(/demo scan: deterministic rubric, no model/i)).toBeInTheDocument();
  });
});
