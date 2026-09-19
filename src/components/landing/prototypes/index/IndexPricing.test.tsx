// @vitest-environment jsdom
//
// G8/G11 gate: the Index deck's pricing snap is numeric, anonymous, and one-click. Amounts must
// equal planPriceLabel() (never typed literals), the section must be a DeckSection#pricing the nav
// can target, and Starter/Team must not grow a "talk to sales" path.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { IndexPricing } from "./IndexPricing";
import { PLAN_FEATURES, PLAN_ORDER, planPriceLabel } from "@/lib/plans";

const PRICED: Array<(typeof PLAN_ORDER)[number]> = ["free", "pro", "team"];
const SRC_DIR = join(process.cwd(), "src/components/landing/prototypes");

describe("IndexPricing — numeric anonymous snap", () => {
  it("is a deck section with the `pricing` snap anchor the nav targets", () => {
    const { container } = render(<IndexPricing />);
    expect(container.querySelector("section#pricing")).not.toBeNull();
  });

  it("prints Free/Starter/Team amounts from planPriceLabel(), not typed literals", () => {
    const { container } = render(<IndexPricing />);
    for (const id of PRICED) {
      const card = container.querySelector(`[data-plan="${id}"]`);
      expect(card).not.toBeNull();
      expect(card!.textContent).toContain(PLAN_FEATURES[id].label);
      expect(card!.textContent).toContain(planPriceLabel(id).amount);
      expect(card!.textContent).toContain(planPriceLabel(id).cadence);
    }
  });

  it("renders Custom as Flexible plus enquiry, never talk-to-sales on Starter/Team", () => {
    const { container } = render(<IndexPricing />);
    const custom = container.querySelector(`[data-plan="enterprise"]`);
    expect(custom?.textContent).toContain(planPriceLabel("enterprise").amount);
    expect(custom?.textContent).toMatch(/tell us what you need/i);

    for (const id of PRICED) {
      const card = container.querySelector(`[data-plan="${id}"]`)!;
      expect(card.textContent).not.toMatch(/talk to sales/i);
      expect(card.querySelector("button")).toBeNull();
    }
    expect(container.querySelector(`[data-plan="pro"] a`)?.getAttribute("href")).toBe("/onboarding");
    expect(container.querySelector(`[data-plan="team"] a`)?.getAttribute("href")).toBe("/onboarding");
    expect(container.querySelector(`[data-plan="free"] a`)?.getAttribute("href")).toBe("/");
  });

  it("puts the self-host band (IndexLocal's /pricing#self-host anchor) above the plan grid", () => {
    const { container } = render(<IndexPricing />);
    const html = container.innerHTML;
    const band = html.indexOf("/pricing#self-host");
    const grid = html.indexOf('data-plan="free"');
    expect(band).toBeGreaterThan(-1);
    expect(grid).toBeGreaterThan(-1);
    expect(band).toBeLessThan(grid);
  });
});

describe("IndexPricing is actually composed onto the landing page", () => {
  it("IndexVariant renders <IndexPricing />", () => {
    const src = readFileSync(join(SRC_DIR, "index/IndexVariant.tsx"), "utf8");
    expect(src).toMatch(/<IndexPricing\s*\/>/);
    expect(src).toMatch(/from "\.\/IndexPricing"/);
  });

  it("IndexLanding lists the `pricing` deck stop", () => {
    const src = readFileSync(join(SRC_DIR, "IndexLanding.tsx"), "utf8");
    expect(src).toMatch(/id: "pricing"/);
  });

  it("does not type dollar amounts as string literals", () => {
    const src = readFileSync(join(SRC_DIR, "index/IndexPricing.tsx"), "utf8");
    expect(src).not.toMatch(/\$\d/);
    expect(src).toMatch(/planPriceLabel/);
    expect(src).toMatch(/PLAN_FEATURES/);
  });
});
