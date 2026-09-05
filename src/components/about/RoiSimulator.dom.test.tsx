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
