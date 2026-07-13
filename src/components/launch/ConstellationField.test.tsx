// @vitest-environment jsdom
//
// FLEET-MAP #4 (mobile tap targets): each star link's invisible touch circle was `max(look.r + 1.4, 3)`
// — ~3 units, which at the map's ~2.1–2.9 px/unit mobile scale is only ~13–17px, below the WCAG 2.2
// 24px target-size minimum. The fix grows the HIT circle to `max(look.r + 3, 6)` (≥6 units ⇒ ≥24px on a
// 320px phone) without touching the painted star (`look.r`). These pin: every hit circle ≥6 units, and
// the visible star radius is left small (paint not grown).

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ConstellationField } from "./ConstellationField";
import type { Constellation } from "./fleetMapStars";

function doneConstellation(): Constellation {
  return {
    id: 1,
    login: "acme",
    status: "done",
    repos: [
      { fullName: "acme/high", overall: 92, level: "L5", dOverall: 3, watched: true },
      { fullName: "acme/low", overall: 8, level: "L1", dOverall: null, watched: false },
      { fullName: "acme/unscanned", overall: null, level: null, dOverall: null, watched: false },
    ],
  };
}

describe("ConstellationField star touch targets", () => {
  it("gives every star link an invisible hit circle of at least 6 units (≥24px on a phone)", () => {
    const { container } = render(<ConstellationField c={doneConstellation()} />);
    const hitCircles = Array.from(container.querySelectorAll('circle[fill="transparent"]'));
    // One transparent hit circle per repo star (scanned + unscanned alike).
    expect(hitCircles.length).toBe(3);
    for (const circle of hitCircles) {
      const r = Number(circle.getAttribute("r"));
      expect(r).toBeGreaterThanOrEqual(6);
    }
  });

  it("does not grow the painted star — the visible star stays smaller than its hit area", () => {
    const { container } = render(<ConstellationField c={doneConstellation()} />);
    const paintedRadii = Array.from(container.querySelectorAll("circle.launch-star")).map((c) =>
      Number(c.getAttribute("r")),
    );
    expect(paintedRadii.length).toBe(3);
    // starLook caps the visible radius at ~3.4 units; the paint must stay well under the 6-unit hit area.
    for (const r of paintedRadii) {
      expect(r).toBeLessThan(6);
    }
  });
});
