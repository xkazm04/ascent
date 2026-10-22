// @vitest-environment jsdom
//
// MC-B6 (UAT TOMAS-L1-04, recurrence 2 — executive-reporting/provenance-caveats). /about's ROI
// simulator is the section a prospective buyer reads as proof, and it computes over eight INVENTED
// repos at a weighting its own source calls "deliberately NOT the production weighting". Both facts
// were stated honestly in comments and nowhere in the render, so the disclosure existed only for
// people reading the repository. This pins the RENDERED label: a caveat a visitor cannot see is not
// a caveat.

import { describe, it, expect, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { RoiSimulator } from "./RoiSimulator";
import { fleetFrom, projectFleet } from "./aboutFleetModel";
import { liveGallery } from "./aboutFleet.fixture";

// framer-motion needs window.matchMedia (useReducedMotion) — jsdom doesn't implement it.
beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

describe("RoiSimulator provenance caveat", () => {
  it("renders an illustrative label naming the sample data and the demo weighting", () => {
    render(<RoiSimulator />);
    const label = screen.getByText(/illustrative/i);
    expect(label).toBeTruthy();
    expect(label.textContent).toMatch(/sample repos/i);
    expect(label.textContent).toMatch(/demo weighting/i);
    // The strongest half for this Character: the numbers are explicitly not anyone's real result.
    expect(label.textContent).toMatch(/not customer data/i);
  });

  it("states the real row count, so adding or removing a repo can't leave the caption lying", () => {
    render(<RoiSimulator />);
    // Every rendered repo row is one of the invented fleet; the caption counts the same array.
    const label = screen.getByText(/illustrative/i);
    const claimed = Number(label.textContent?.match(/(\d+) sample repos/)?.[1]);
    expect(Number.isFinite(claimed)).toBe(true);
    expect(screen.getAllByText(/^(web-app|api-gateway|mobile-client|design-system|billing|data-pipeline|auth-service|docs-site)$/)).toHaveLength(claimed);
  });
});

// Card about-1: on the live corpus the sliders recompute real public repos with the engine's weighting.
describe("RoiSimulator over the live public fleet", () => {
  const fleet = fleetFrom(liveGallery(12));

  it("lists real repos, captions them live, and prints engine-true baselines", () => {
    render(<RoiSimulator fleet={fleet} />);
    const cap = screen.getByText(/^Live · /);
    expect(cap.textContent).toMatch(/public repos scanned by Ascent/);
    expect(cap.textContent).not.toMatch(/demo weighting|not customer data/i);
    const n = Number(cap.textContent?.match(/(\d+) public repos/)?.[1]);
    expect(n).toBeGreaterThan(0);
    const rows = fleet.repos.slice(0, n);
    const initial = projectFleet(rows, { D2: 45, D3: 30, D1: 30 });
    for (const r of initial.rows) {
      expect(screen.getByText(r.name)).toBeTruthy();
      expect(screen.getAllByText(String(r.next)).length).toBeGreaterThan(0);
    }
  });
});
