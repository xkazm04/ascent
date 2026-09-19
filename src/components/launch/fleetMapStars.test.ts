// launch-fleet-map #3: star positions are memoized by (index, total, seed) so a live SSE frame — which
// changes a star's score but never its layout inputs — recomputes ZERO trig. These pin that the memo
// returns the SAME object for the same layout (a cache hit, so no recompute), a DISTINCT object when any
// layout input changes (a repo added/removed shifts `total`), and stays value-deterministic throughout.

import { describe, it, expect } from "vitest";
import { starPosition, CENTER } from "./fleetMapStars";

describe("starPosition memoization (#3)", () => {
  it("returns the identical cached object for the same (i, total, seed) — a hit, no recompute", () => {
    const first = starPosition(3, 20, "acme/web");
    const second = starPosition(3, 20, "acme/web");
    expect(second).toBe(first); // reference equality ⇒ the trig ran once, not per frame
  });

  it("recomputes (a distinct object) when any layout input changes", () => {
    const base = starPosition(3, 20, "acme/web");
    expect(starPosition(4, 20, "acme/web")).not.toBe(base); // index changed
    expect(starPosition(3, 21, "acme/web")).not.toBe(base); // total changed (a repo appeared/left)
    expect(starPosition(3, 20, "acme/api")).not.toBe(base); // seed changed
  });

  it("stays deterministic and inside the 120×120 field (cache never corrupts the value)", () => {
    const { cx, cy } = starPosition(5, 30, "globex/svc");
    expect(starPosition(5, 30, "globex/svc")).toEqual({ cx, cy });
    // radius ~13..55 around CENTER=60 ⇒ well within [0,120].
    expect(Math.hypot(cx - CENTER, cy - CENTER)).toBeGreaterThan(0);
    expect(cx).toBeGreaterThanOrEqual(0);
    expect(cx).toBeLessThanOrEqual(120);
    expect(cy).toBeGreaterThanOrEqual(0);
    expect(cy).toBeLessThanOrEqual(120);
  });
});
