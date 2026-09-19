// @vitest-environment jsdom
//
// The observatory's two surfaces must behave as ONE control: the SVG field is aria-hidden decoration
// over a real button list, and both write to the same parent-owned selection.

import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ObservatoryField } from "./ObservatoryField";
import { ObservatoryList } from "./ObservatoryList";
import { layoutBodies, type ObservatorySeed } from "./observatoryModel";

const seed = (i: number, o: Partial<ObservatorySeed> = {}): ObservatorySeed => ({
  fullName: `acme/repo-${i}`,
  name: `repo-${i}`,
  overall: 60,
  adoption: 60,
  rigor: 60,
  level: "L4",
  posture: "ai-native",
  ...o,
});

/** jsdom has no matchMedia; default to "reduce" so nothing schedules rAF unless a test opts in. */
function stubMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((q: string) => ({
      matches: reduce && q.includes("prefers-reduced-motion"),
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function Harness({ bodies, ...rest }: { bodies: ReturnType<typeof layoutBodies>; clusterThreshold?: number }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  return (
    <>
      <ObservatoryField bodies={bodies} selected={selected} onSelect={setSelected} {...rest} />
      <ObservatoryList bodies={bodies} selected={selected} onSelect={setSelected} />
    </>
  );
}

describe("ObservatoryField", () => {
  it("plots one mark per scored repo and hides the SVG from assistive tech", () => {
    stubMotion(true);
    const bodies = layoutBodies([seed(1), seed(2), seed(3)]);
    const { container } = render(<Harness bodies={bodies} />);
    const svg = screen.getByTestId("observatory-field");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    // 3 bodies, each with a <title> naming the repo.
    expect([...container.querySelectorAll("svg title")].map((t) => t.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("acme/repo-1")]),
    );
    expect(container.querySelectorAll("svg title")).toHaveLength(3);
  });

  it("gives every SVG <title> exactly one text child (React 19 hydration)", () => {
    stubMotion(true);
    const { container } = render(<Harness bodies={layoutBodies([seed(1)])} />);
    for (const t of container.querySelectorAll("svg title")) expect(t.childNodes).toHaveLength(1);
  });

  it("does not plot a never-scanned repo but still lists it", () => {
    stubMotion(true);
    const bodies = layoutBodies([seed(1), seed(2, { adoption: null, rigor: null, overall: null, level: null })]);
    const { container } = render(<Harness bodies={bodies} />);
    expect(container.querySelectorAll("svg title")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /repo-2/ })).toBeTruthy();
    expect(screen.getByText("Never scanned")).toBeTruthy();
  });

  it("clicking a body toggles it, and the list row reflects the same selection", () => {
    stubMotion(true);
    const { container } = render(<Harness bodies={layoutBodies([seed(1), seed(2)])} />);
    const row = () => screen.getByRole("button", { name: /repo-1/ });
    expect(row()).toHaveAttribute("aria-pressed", "false");

    const mark = container.querySelector("svg title")!.parentElement!;
    fireEvent.click(mark);
    expect(row()).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(mark);
    expect(row()).toHaveAttribute("aria-pressed", "false");
  });

  it("selecting in the list is visible to the field's ring", () => {
    stubMotion(true);
    const { container } = render(<Harness bodies={layoutBodies([seed(1)])} />);
    const rings = () => container.querySelectorAll("svg circle.stroke-accent");
    expect(rings()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /repo-1/ }));
    expect(rings()).toHaveLength(1);
  });

  it("aggregates into clusters above the threshold, with a mono count", () => {
    stubMotion(true);
    const bodies = layoutBodies(Array.from({ length: 50 }, (_, i) => seed(i, { adoption: 80, rigor: 80 })));
    render(<Harness bodies={bodies} clusterThreshold={40} />);
    const count = screen.getByTestId("cluster-count");
    expect(count.textContent).toBe("50");
    expect(count.getAttribute("class")).toContain("tabular-nums");
  });

  it("renders the drift END STATE immediately under prefers-reduced-motion", () => {
    stubMotion(true);
    const before = layoutBodies([seed(1, { adoption: 10, rigor: 10 })]);
    const after = layoutBodies([seed(1, { adoption: 90, rigor: 90 })]);
    const { container } = render(
      <ObservatoryField
        bodies={after}
        selected={new Set()}
        onSelect={() => {}}
        drift={{ before, after, runId: "r1" }}
      />,
    );
    const circle = container.querySelector("svg title")!.parentElement!.querySelector("circle:last-of-type")!;
    // 90/90 in data space, not the 10/10 start — the tween never played.
    expect(Number(circle.getAttribute("cx"))).toBeGreaterThan(800);
  });

  it("pulses only the bodies that are scanning", () => {
    stubMotion(true);
    const { container } = render(
      <ObservatoryField
        bodies={layoutBodies([seed(1), seed(2)])}
        selected={new Set()}
        onSelect={() => {}}
        scanning={new Set(["acme/repo-1"])}
      />,
    );
    expect(container.querySelectorAll("svg .live-dot")).toHaveLength(1);
  });
});
