// @vitest-environment jsdom
//
// `telemetry.invokesBySkill` is computed on the view and had zero consumers. The instrument column
// ranks those registry skill names beside the 30d registry readout, never summed with the direct
// sink, and hatches the slot when the usage lane has not been read.

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { HATCH_ID } from "@/components/org/viz";
import { fixtureRegistryView } from "@/lib/org/registry-view.fixture";
import type { RegistryView } from "@/lib/org/registry-view";
import { RegistryInstrumentPanel } from "./RegistryInstrumentPanel";

function instrumentView(over: {
  invokesBySkill?: Record<string, number>;
  invokesDirect30d?: number | null;
  lastIndexedAt?: string | null;
} = {}): RegistryView {
  const base = fixtureRegistryView("acme", "indexed")!;
  return {
    ...base,
    registry: {
      ...base.registry!,
      lastIndexedAt: over.lastIndexedAt === undefined ? base.registry!.lastIndexedAt : over.lastIndexedAt,
    },
    telemetry: {
      ...base.telemetry,
      ...(over.invokesBySkill !== undefined ? { invokesBySkill: over.invokesBySkill } : {}),
      ...(over.invokesDirect30d !== undefined ? { invokesDirect30d: over.invokesDirect30d } : {}),
    },
  };
}

const skillRows = (container: HTMLElement) =>
  [...container.querySelectorAll("[data-invokes-by-skill] [data-skill]")].map((n) => n.getAttribute("data-skill"));

describe("RegistryInstrumentPanel — invokesBySkill", () => {
  it("a fixture with two bySkill keys renders two named rows, ranked, not summed with direct", () => {
    const { container } = render(
      <RegistryInstrumentPanel
        view={instrumentView({
          invokesBySkill: { "pr-review-rigor": 12, "test-first-loop": 40 },
          invokesDirect30d: 900,
        })}
      />,
    );
    expect(skillRows(container)).toEqual(["test-first-loop", "pr-review-rigor"]);
    expect(container.querySelector('[data-skill="test-first-loop"] [data-count]')?.textContent).toBe("40");
    expect(container.querySelector('[data-skill="pr-review-rigor"] [data-count]')?.textContent).toBe("12");
    const list = container.querySelector("[data-invokes-by-skill]")!;
    expect(list.getAttribute("data-state")).toBe("measured");
    expect(list.textContent).not.toContain("900");
    expect(list.textContent).not.toContain("940");
    expect(list.textContent).not.toContain("912");
  });

  it("hatches when the usage lane is unread and prints no named rows or numerals", () => {
    const { container } = render(
      <RegistryInstrumentPanel
        view={instrumentView({
          lastIndexedAt: null,
          invokesBySkill: { "test-first-loop": 40, "pr-review-rigor": 12 },
          invokesDirect30d: 900,
        })}
      />,
    );
    const list = container.querySelector("[data-invokes-by-skill]")!;
    expect(list.getAttribute("data-state")).toBe("not-judged");
    expect(skillRows(container)).toEqual([]);
    expect(list.querySelector("[data-count]")).toBeNull();
    expect(list.querySelector("[data-mark]")?.getAttribute("fill")).toBe(`url(#${HATCH_ID})`);
    expect(list.textContent).not.toContain("test-first-loop");
    expect(list.textContent).not.toContain("pr-review-rigor");
    expect(list.textContent).not.toContain("40");
    expect(list.textContent).not.toContain("12");
  });

  it("does not invent fleet-sync zeros when the lane was read but no bySkill map arrived", () => {
    const { container } = render(<RegistryInstrumentPanel view={instrumentView()} />);
    expect(container.querySelector("[data-invokes-by-skill]")?.getAttribute("data-state")).toBe("measured");
    expect(skillRows(container)).toEqual([]);
    expect(container.querySelector("[data-invokes-by-skill] [data-count]")).toBeNull();
  });
});
