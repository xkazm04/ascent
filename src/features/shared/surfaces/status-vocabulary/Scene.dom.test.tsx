// @vitest-environment jsdom
//
// The status-vocabulary scene under jsdom: it mounts inside the frame's MotionScope; every technique
// the body declares has a `[data-technique]` region; the reduced path renders the same regions with
// the ticker paused; every volume renders; the fiction line shows; and the mechanisms hold — the
// unknown token resolves and reports, the locale binds inside the primitives, the sub-cent guard and
// the placeholder differ, the future is clamped then abandoned, markup renders as text.

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { SURFACE_VOLUMES, surfaceRecord } from "@/lib/org/surface-catalog";
import { applySpotlight, regionSlugs } from "../surfaceSpotlight";
import { MotionScope } from "../surfaceMotionScope";
import { SKEW_ROW } from "./fixtures";
import { skewReports } from "./formatters";
import { body } from "./index";

const { Scene, techniques } = body;
const mount = (reduced: boolean, volume: (typeof SURFACE_VOLUMES)[number] = SURFACE_VOLUMES[0]) =>
  render(
    <MotionScope reduced={reduced}>
      <Scene technique={null} reduced={reduced} volume={volume} />
    </MotionScope>,
  );
const region = (c: HTMLElement, slug: string) => c.querySelector(`[data-technique="${slug}"]`) as HTMLElement;

describe("status-vocabulary scene", () => {
  it("declares every technique of its catalog record as a region, once", () => {
    const { container } = mount(false);
    const record = surfaceRecord("status-vocabulary");
    expect(record).toBeTruthy();
    const regions = regionSlugs(container);
    for (const t of techniques) expect(regions.filter((s) => s === t.slug), `region for ${t.slug}`).toHaveLength(1);
    expect(techniques.map((t) => t.slug).sort()).toEqual([...(record?.techniqueSlugs ?? [])].sort());
    expect(screen.getByText(/fixture data/i)).toBeTruthy();
  });

  it("renders at every volume and under reduced motion with the ticker paused", () => {
    for (const v of SURFACE_VOLUMES) {
      const { container, unmount } = mount(false, v);
      expect(container.querySelectorAll("[data-technique]")).toHaveLength(techniques.length);
      unmount();
    }
    const { container } = mount(true);
    expect(container.querySelector("[data-scene]")?.getAttribute("data-reduced")).toBe("true");
    expect(container.querySelector("[data-ticker]")?.getAttribute("data-ticker")).toBe("paused");
    expect(container.querySelectorAll("[data-row]").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByLabelText("Resume the ticker"));
    expect(container.querySelector("[data-ticker]")?.getAttribute("data-ticker")).toBe("running");
  });

  it("is spotlit by the frame's helper", () => {
    const { container } = mount(false);
    applySpotlight(container, "number-formatting");
    expect(region(container, "number-formatting").getAttribute("data-spotlit")).toBe("true");
    expect(region(container, "timestamp-display").classList.contains("opacity-40")).toBe(true);
  });

  it("chain: an unknown token resolves totally, reports the miss, and sorts by the decided rank", () => {
    const { container } = mount(false);
    const chain = region(container, "vocabulary-chain-integrity");
    expect(chain.querySelector("[data-misses]")?.getAttribute("data-misses")).toBe("0");
    fireEvent.click(within(chain).getByText(/deliver "dead_letter"/));
    const row = container.querySelector(`[data-row="${SKEW_ROW.id}"]`) as HTMLElement;
    const status = row.querySelector('[data-token="dead_letter"]') as HTMLElement;
    expect(status.getAttribute("data-known")).toBe("false");
    expect(status.textContent).toContain("Unknown status"); // never the raw token
    expect(row.querySelector('[data-token="p0"]')?.getAttribute("data-role")).toBe("danger"); // severity → most severe
    expect(chain.querySelector("[data-misses]")?.getAttribute("data-misses")).toBe("2");
    fireEvent.click(within(chain).getByText("sort worst-first"));
    expect(container.querySelector("[data-row]")?.getAttribute("data-row")).toBe(SKEW_ROW.id);
  });

  it("numbers: the locale binds inside the primitive and the three facts stay distinct", () => {
    const { container } = mount(false);
    const num = region(container, "number-formatting");
    const cell = (fact: string) => num.querySelector(`[data-fact="${fact}"] [data-unit="usd"]`)?.textContent;
    expect(cell("money")).toBe("$1,234.50");
    expect(cell("exact zero")).toBe("$0.00");
    expect(cell("absent")).toBe("—");
    expect(cell("sub-cent")).toBe("<$0.01");
    expect(num.querySelector('[data-fact="sub-cent"] [data-hand-rolled]')?.textContent).toBe("$0.00"); // the lie beside it
    fireEvent.click(within(num).getByText("de-DE"));
    expect(cell("money")).toMatch(/^1\.234,50\s\$$/); // ICU places the symbol last, after a no-break space
    // The ledger followed without any cell being told.
    expect(container.querySelector('[data-ledger] [data-unit="usd"]')?.textContent).toMatch(/\$$/);
    expect(container.querySelector('[data-token="passed"], [data-token="failed"], [data-token="queued"]')?.textContent).not.toMatch(/Passed|Failed|Queued/);
  });

  it("time: small skew clamps to now, large skew abandons relative and reports once", () => {
    const before = skewReports(); // one breadcrumb per instant per session: earlier mounts already reported theirs
    const { container } = mount(false);
    const time = region(container, "timestamp-display");
    const cells = time.querySelectorAll("time");
    expect(cells[0].textContent).toMatch(/second|now/); // 12s fresh
    expect(cells[1].textContent).toBe("yesterday"); // the platform's vocabulary
    expect(cells[2].getAttribute("data-skewed")).toBe("false");
    expect(cells[2].textContent).toBe("now"); // +40s: clamped
    expect(cells[3].getAttribute("data-skewed")).toBe("true"); // +3h: absolute
    expect(cells[3].textContent).not.toMatch(/ago|in /);
    expect(Number(time.querySelector("[data-skew-reports]")?.getAttribute("data-skew-reports"))).toBe(before + 1);
    expect(cells[0].getAttribute("title")?.length ?? 0).toBeGreaterThan(0); // absolute one hover away
  });

  it("labels: markup renders as text, long names truncate, and a token-shaped name never keys a pill", () => {
    const { container } = mount(false);
    const label = region(container, "untrusted-label-rendering");
    fireEvent.click(within(label).getByText("markup"));
    const first = container.querySelector("[data-row]") as HTMLElement;
    expect(first.querySelector("img")).toBeNull();
    expect(first.textContent).toContain("<img");
    fireEvent.click(within(label).getByText("no spaces"));
    expect(first.querySelector("[data-truncated]")?.getAttribute("data-truncated")).toBe("true");
    fireEvent.click(within(label).getByText("looks like a token"));
    expect(first.querySelector('[data-token="critical"]')).toBeNull();
  });

  it("evolution: three of four layers shows the degraded pill; all four shows the member", () => {
    const { container } = mount(false);
    const evo = region(container, "vocabulary-evolution-checklist");
    const boxes = evo.querySelectorAll('input[type="checkbox"]');
    [1, 2, 3, 5, 6].forEach((i) => fireEvent.click(boxes[i])); // everything but the catalog
    expect(evo.querySelector("[data-preview]")?.getAttribute("data-preview")).toBe("retrying");
    fireEvent.click(boxes[4]);
    expect(evo.querySelector("[data-preview]")?.getAttribute("data-preview")).toBe("◔ Retrying");
  });

  it("carries a real source excerpt and prose for every technique", () => {
    for (const t of techniques) {
      expect(t.mechanism.split(/[.!?]\s/).length).toBeGreaterThanOrEqual(3);
      expect(t.source.trim().length).toBeGreaterThan(40);
    }
  });
});
